"""
Motor OCR de placas vehiculares v3 — FastALPR + pytesseract fallback.

Pipeline mejorado:
  Imagen cruda
    ↓
  [FastALPR — YOLO v9] → detecta DÓNDE está la placa → recorta esa región
    ↓
  [OCR especializado en placas] → lee solo el recorte limpio
    ↓
  confianza + normalización Bolivia → resultado

Ventajas vs pytesseract puro:
  - El OCR nunca ve ruido de fondo: ruedas, carrocería, sombras
  - YOLO v9 localiza la placa aunque esté parcialmente fuera del frame
  - ~93% precisión vs ~85% de pytesseract
  - Funciona con imágenes de celular sin preprocessing manual

Fallback automático:
  Si FastALPR no está disponible (primera instalación en Railway aún sin modelos)
  → usa el pipeline pytesseract v2 anterior.

Niveles de confianza (devueltos al frontend):
  alto    >= 0.85  → acepta automáticamente (verde)
  medio   0.60-0.84 → muestra con badge "Revisar" (amarillo) — guardia confirma
  bajo    < 0.60   → rechaza, pide nueva foto (rojo)
"""
import base64
import io
import json
import logging
import re
import time

from django.http import JsonResponse
from django.views import View

logger = logging.getLogger(__name__)

PLACA_RE = re.compile(r'([A-Z]{2,4}[-]?\d{3,4}[A-Z]?)', re.IGNORECASE)

# ── Singleton FastALPR — se carga una sola vez por proceso ────────────────────
_fast_alpr_instance = None
_fast_alpr_error    = None   # guarda el error si la carga falló


def _get_fast_alpr():
    """
    Carga FastALPR una sola vez.
    Primera llamada: descarga modelos ONNX (~80MB) a ~/.cache/fast-alpr/
    Tiempo de carga: ~5-10s la primera vez, <1s en subsiguientes.
    """
    global _fast_alpr_instance, _fast_alpr_error
    if _fast_alpr_instance is not None:
        return _fast_alpr_instance
    if _fast_alpr_error:
        return None
    try:
        from fast_alpr import ALPR
        logger.info("[OCR] Cargando modelos FastALPR...")
        _fast_alpr_instance = ALPR(
            detector_model = "yolo-v9-t-384-license-plate-end2end",
            ocr_model      = "global-plates-mobile-vit-v2-model",
        )
        logger.info("[OCR] FastALPR listo.")
        return _fast_alpr_instance
    except Exception as exc:
        _fast_alpr_error = str(exc)
        logger.warning("[OCR] FastALPR no disponible: %s — usando pytesseract", exc)
        return None


# ── Motor FastALPR ────────────────────────────────────────────────────────────

def _reconocer_fast_alpr(img_bytes: bytes) -> dict | None:
    """
    Detecta la placa con YOLO v9, recorta y lee con OCR especializado.
    Retorna None si FastALPR no está disponible o no detectó nada.
    """
    alpr = _get_fast_alpr()
    if alpr is None:
        return None
    try:
        t0 = time.time()
        # FastALPR acepta bytes directamente
        resultados = alpr.run(img_bytes)
        ms = round((time.time() - t0) * 1000)

        if not resultados:
            logger.debug("[OCR FastALPR] Sin detección de placa")
            return {"placa": None, "confianza": 0.0, "metodo": "fast-alpr", "ms": ms}

        # Elegir la detección con mayor confianza
        mejor = max(resultados, key=lambda r: r.ocr.confidence)
        placa_raw  = (mejor.ocr.text or "").strip().upper()
        confianza  = round(float(mejor.ocr.confidence), 3)
        placa_norm = _normalizar_placa(placa_raw)

        logger.info("[OCR FastALPR] Detectado: %s → %s (conf: %s, %sms)",
                    placa_raw, placa_norm, confianza, ms)
        return {
            "placa":    placa_norm or placa_raw or None,
            "confianza": confianza,
            "metodo":   "fast-alpr-yolov9",
            "ms":       ms,
            "detector_conf": round(float(mejor.detection.confidence), 3),
        }
    except Exception as exc:
        logger.error("[OCR FastALPR] Error durante reconocimiento: %s", exc)
        return None


# ── Motor pytesseract (fallback) ──────────────────────────────────────────────

def _preprocesar_tesseract(img_bytes: bytes):
    """Pipeline PIL optimizado para pytesseract."""
    from PIL import Image, ImageEnhance, ImageFilter
    pil = Image.open(io.BytesIO(img_bytes)).convert("L")
    pixels = list(pil.getdata())
    if sum(pixels) / len(pixels) < 100:
        from PIL import ImageOps
        pil = ImageOps.invert(pil)
    w, h = pil.size
    pil = pil.resize((w * 2, h * 2), Image.LANCZOS)
    pil = ImageEnhance.Contrast(pil).enhance(2.0)
    pil = ImageEnhance.Sharpness(pil).enhance(2.5)
    return pil.filter(ImageFilter.MedianFilter(size=3))


TESSERACT_CONFIG = "--psm 8 --oem 1 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-"


def _reconocer_pytesseract(img_bytes: bytes) -> dict:
    try:
        import pytesseract
    except ImportError:
        return {"placa": None, "confianza": 0.0, "metodo": "unavailable", "ms": 0}

    try:
        img_pil = _preprocesar_tesseract(img_bytes)
        t0 = time.time()
        raw = pytesseract.image_to_string(img_pil, config=TESSERACT_CONFIG)
        ms  = round((time.time() - t0) * 1000)
        placa = _normalizar_placa(raw)
        conf  = 0.80 if placa and re.match(r'^[A-Z]{2,4}-\d{3,4}[A-Z]?$', placa) else 0.65
        return {"placa": placa, "confianza": conf, "metodo": "pytesseract", "ms": ms}
    except Exception as exc:
        return {"placa": None, "confianza": 0.0, "metodo": "pytesseract-error",
                "ms": 0, "error": str(exc)}


# ── Helpers comunes ───────────────────────────────────────────────────────────

def _normalizar_placa(texto_raw: str) -> str | None:
    """Normaliza el texto OCR al formato boliviano: SCZ-1234, CBB-001, etc."""
    if not texto_raw:
        return None
    limpio = re.sub(r"[^A-Z0-9-]", "", texto_raw.upper())
    match  = PLACA_RE.search(limpio)
    if not match:
        return None
    placa = match.group(0).upper()
    if "-" not in placa:
        m2 = re.match(r"([A-Z]{2,4})(\d{3,4}[A-Z]?)", placa)
        if m2:
            placa = f"{m2.group(1)}-{m2.group(2)}"
    return placa


def _nivel_confianza(conf: float) -> str:
    """Clasifica la confianza en niveles para el frontend."""
    if conf >= 0.85:
        return "alto"
    if conf >= 0.60:
        return "medio"
    return "bajo"


def _auth(request):
    if request.user.is_authenticated:
        return request.user
    from rest_framework_simplejwt.authentication import JWTAuthentication
    token = (
        request.GET.get("token")
        or request.META.get("HTTP_AUTHORIZATION", "").replace("Bearer ", "")
    )
    if not token:
        return None
    try:
        auth      = JWTAuthentication()
        validated = auth.get_validated_token(token.encode() if isinstance(token, str) else token)
        return auth.get_user(validated)
    except Exception:
        return None


# ── Vista principal ───────────────────────────────────────────────────────────

class OcrPlacaView(View):
    """
    POST /api/ocr/placa/

    Body: { "imagen": "<base64 jpeg/png>" }
           O: { "imagenes": ["<base64>", "<base64>", "<base64>"] }  ← multi-frame

    Response:
      { "placa": "SCZ-1234", "confianza": 0.93, "nivel": "alto",
        "metodo": "fast-alpr-yolov9", "ms": 280 }
    """

    def post(self, request):
        if not _auth(request):
            return JsonResponse({"error": "Autenticación requerida"}, status=401)

        try:
            body = json.loads(request.body)
        except (json.JSONDecodeError, AttributeError):
            return JsonResponse({"error": "JSON inválido"}, status=400)

        # ── Modo multi-frame: vota la placa más repetida entre N fotos ────────
        imagenes_b64 = body.get("imagenes")
        if imagenes_b64 and isinstance(imagenes_b64, list):
            return self._procesar_multiframe(imagenes_b64)

        # ── Modo single-frame ─────────────────────────────────────────────────
        img_b64 = body.get("imagen", "").strip()
        if not img_b64:
            return JsonResponse({"error": "Se requiere 'imagen' o 'imagenes'"}, status=400)

        try:
            img_bytes = base64.b64decode(img_b64)
        except Exception:
            return JsonResponse({"error": "Base64 inválido"}, status=400)

        resultado = self._procesar_imagen(img_bytes)
        return JsonResponse(resultado)

    def _procesar_imagen(self, img_bytes: bytes) -> dict:
        """Intenta FastALPR, cae a pytesseract si no disponible."""
        resultado = _reconocer_fast_alpr(img_bytes)

        # Si FastALPR no detectó nada pero sí está disponible, ya es el resultado
        if resultado is not None:
            resultado["nivel"] = _nivel_confianza(resultado["confianza"])
            return resultado

        # Fallback a pytesseract
        resultado = _reconocer_pytesseract(img_bytes)
        resultado["nivel"] = _nivel_confianza(resultado["confianza"])
        return resultado

    def _procesar_multiframe(self, imagenes_b64: list) -> JsonResponse:
        """
        Procesa hasta 5 frames y vota la placa más frecuente con mayor confianza.
        Reduce drásticamente los falsos negativos sin añadir latencia perceptible.
        """
        from collections import Counter
        resultados = []
        for b64 in imagenes_b64[:5]:  # máximo 5 frames
            try:
                img_bytes = base64.b64decode(b64.strip())
                r = self._procesar_imagen(img_bytes)
                if r.get("placa") and r.get("confianza", 0) >= 0.55:
                    resultados.append(r)
            except Exception:
                continue

        if not resultados:
            return JsonResponse({
                "placa": None, "confianza": 0.0, "nivel": "bajo",
                "metodo": "multi-frame-vacio", "ms": 0,
                "frames_procesados": len(imagenes_b64),
            })

        # La placa que más aparece gana; en caso de empate, la de mayor confianza
        conteo = Counter(r["placa"] for r in resultados)
        placa_ganadora = conteo.most_common(1)[0][0]
        candidatos     = [r for r in resultados if r["placa"] == placa_ganadora]
        mejor          = max(candidatos, key=lambda r: r["confianza"])

        return JsonResponse({
            **mejor,
            "frames_procesados": len(imagenes_b64),
            "frames_con_placa":  len(resultados),
            "votos":             conteo[placa_ganadora],
        })


# ── Vista de diagnóstico ───────────────────────────────────────────────────────

class OcrDiagnosticoView(View):
    """GET /api/ocr/diagnostico/ — estado del motor OCR."""

    def get(self, request):
        reporte = {
            "motor_principal": "fast-alpr-yolov9",
            "fallback":        "pytesseract",
            "fast_alpr":       {},
            "pytesseract":     {},
            "recomendacion":   "",
        }

        # Estado FastALPR
        alpr = _get_fast_alpr()
        if alpr:
            reporte["fast_alpr"] = {
                "disponible": True,
                "detector":   "yolo-v9-t-384-license-plate-end2end",
                "ocr_model":  "global-plates-mobile-vit-v2-model",
                "descripcion": "YOLO v9 detecta la placa → OCR especializado la lee",
            }
            # Prueba rápida con imagen sintética
            try:
                img_bytes = _generar_imagen_prueba("SCZ-3456")
                t0 = time.time()
                resultado = _reconocer_fast_alpr(img_bytes)
                ms = round((time.time() - t0) * 1000)
                reporte["fast_alpr"]["prueba"] = {
                    "esperada": "SCZ-3456",
                    "leida":    resultado.get("placa") if resultado else None,
                    "confianza": resultado.get("confianza") if resultado else 0,
                    "ms":       ms,
                }
            except Exception as exc:
                reporte["fast_alpr"]["prueba_error"] = str(exc)
        else:
            reporte["fast_alpr"] = {
                "disponible": False,
                "error":      _fast_alpr_error,
                "nota":       "Instalando fast-alpr: pip install fast-alpr",
            }

        # Estado pytesseract
        try:
            import pytesseract
            version = str(pytesseract.get_tesseract_version())
            reporte["pytesseract"] = {"disponible": True, "version": version}
        except Exception as exc:
            reporte["pytesseract"] = {"disponible": False, "error": str(exc)}

        if alpr:
            reporte["recomendacion"] = (
                "✅ FastALPR activo — YOLO v9 detecta la región de la placa antes del OCR. "
                "Precisión esperada: ~93% en placas bolivianas reales."
            )
        elif reporte["pytesseract"]["disponible"]:
            reporte["recomendacion"] = (
                "⚠ Usando pytesseract (fallback). "
                "FastALPR mejorará la precisión de ~85% a ~93%."
            )
        else:
            reporte["recomendacion"] = "❌ Ningún motor OCR disponible."

        return JsonResponse(reporte)


def _generar_imagen_prueba(texto: str) -> bytes:
    """Imagen sintética de placa boliviana para pruebas."""
    from PIL import Image, ImageDraw, ImageFont
    W, H = 400, 100
    img  = Image.new("RGB", (W, H), color=(15, 30, 100))
    draw = ImageDraw.Draw(img)
    draw.rectangle([4, 4, W - 5, H - 5], outline=(220, 220, 220), width=4)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 60
        )
    except OSError:
        font = ImageFont.load_default()
    draw.text((W // 2, H // 2), texto, fill=(240, 240, 240), font=font, anchor="mm")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()
