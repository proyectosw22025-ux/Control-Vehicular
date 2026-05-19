"""
Vista REST para OCR de placas vehiculares bolivianas con PaddleOCR.

Por qué REST y no GraphQL:
  El frontend envía frames de video (imágenes base64) en tiempo real.
  Un endpoint REST es más simple y eficiente para este flujo de datos binarios.

Flujo:
  1. Frontend captura frame del video → Canvas → base64 JPEG
  2. POST /api/ocr/placa/ con { "imagen": "<base64>" }
  3. Preprocessing PIL: escala de grises + contraste + nitidez
  4. PaddleOCR (CPU, PP-OCRv4) reconoce el texto
  5. Regex boliviana filtra candidatos válidos
  6. Retorna { "placa": "SCZ-3456", "confianza": 0.97 } o { "placa": null }

Primera solicitud: descarga modelos (~80MB) en ~/.paddleocr/ — tarda ~30s en Railway.
Solicitudes siguientes: inferencia en ~200-400ms.
"""
import base64
import io
import json
import re

from django.http import JsonResponse
from django.views import View

# Regex para placas bolivianas: 2-4 letras + guión opcional + 3-4 dígitos + letra opcional
PLACA_RE = re.compile(r'([A-Z]{2,4}[-]?\d{3,4}[A-Z]?)', re.IGNORECASE)


def _preprocesar(img_bytes: bytes):
    """
    Mejora la imagen para OCR de placas:
      - Escala de grises (elimina ruido de color)
      - Contraste amplificado x2.2 (textos en placa más definidos)
      - Nitidez aumentada x2.0 (bordes de caracteres más nítidos)
    Retorna numpy array RGB (formato requerido por PaddleOCR).
    """
    from PIL import Image, ImageEnhance
    import numpy as np

    pil = Image.open(io.BytesIO(img_bytes)).convert("L")   # grayscale
    pil = ImageEnhance.Contrast(pil).enhance(2.2)
    pil = ImageEnhance.Sharpness(pil).enhance(2.0)
    pil = pil.convert("RGB")                               # PaddleOCR necesita RGB
    return np.array(pil)


class OcrPlacaView(View):
    """
    POST /api/ocr/placa/
    Body JSON: { "imagen": "<base64 JPEG del recorte de la placa>" }
    Response:  { "placa": "SCZ-3456", "confianza": 0.97 }
            o  { "placa": null, "confianza": 0.0 }
    """

    # Singleton lazy — se inicializa en la primera solicitud
    _ocr_instance = None

    @classmethod
    def _get_ocr(cls):
        if cls._ocr_instance is None:
            from paddleocr import PaddleOCR
            cls._ocr_instance = PaddleOCR(
                use_angle_cls=False,   # placas siempre horizontales — ahorra tiempo
                lang="en",            # alfabeto latino
                use_gpu=False,        # Railway free tier sin GPU
                show_log=False,       # suprimir logs de PaddlePaddle
            )
        return cls._ocr_instance

    def _autenticar(self, request):
        """Bearer token o ?token= query param (mismo patrón que otras vistas)."""
        if request.user.is_authenticated:
            return request.user
        from rest_framework_simplejwt.authentication import JWTAuthentication
        token = request.GET.get("token") or request.META.get("HTTP_AUTHORIZATION", "").replace("Bearer ", "")
        if not token:
            return None
        try:
            auth = JWTAuthentication()
            validated = auth.get_validated_token(token.encode() if isinstance(token, str) else token)
            return auth.get_user(validated)
        except Exception:
            return None

    def post(self, request):
        user = self._autenticar(request)
        if not user:
            return JsonResponse({"error": "Autenticación requerida"}, status=401)

        # ── Leer imagen base64 ────────────────────────────────────────────
        try:
            body    = json.loads(request.body)
            img_b64 = body.get("imagen", "").strip()
        except (json.JSONDecodeError, AttributeError):
            return JsonResponse({"error": "JSON inválido"}, status=400)

        if not img_b64:
            return JsonResponse({"error": "Se requiere el campo 'imagen' en base64"}, status=400)

        try:
            img_bytes = base64.b64decode(img_b64)
        except Exception:
            return JsonResponse({"error": "Base64 inválido"}, status=400)

        # ── Preprocessing ─────────────────────────────────────────────────
        try:
            img_np = _preprocesar(img_bytes)
        except Exception as e:
            return JsonResponse({"error": f"Error al procesar imagen: {e}", "placa": None}, status=400)

        # ── OCR — PaddleOCR puede no estar instalado en entornos de desarrollo ──
        try:
            ocr    = self._get_ocr()
            result = ocr.ocr(img_np, cls=False)
        except ImportError:
            return JsonResponse(
                {"error": "PaddleOCR no instalado en el servidor", "placa": None},
                status=503,
            )
        except Exception as e:
            return JsonResponse({"error": str(e), "placa": None}, status=500)

        # ── Extraer y filtrar candidatos ─────────────────────────────────
        candidatos = []
        if result and result[0]:
            for linea in result[0]:
                try:
                    _bbox, (texto, confianza) = linea
                except (ValueError, TypeError):
                    continue

                # Limpiar: solo A-Z, 0-9 y guión
                limpio = re.sub(r"[^A-Z0-9-]", "", texto.upper())
                match  = PLACA_RE.search(limpio)
                if match and float(confianza) >= 0.70:
                    placa_norm = match.group(0).upper()
                    # Normalizar: insertar guión si falta (SCZ3456 → SCZ-3456)
                    if "-" not in placa_norm:
                        m2 = re.match(r"([A-Z]{2,4})(\d{3,4}[A-Z]?)", placa_norm)
                        if m2:
                            placa_norm = f"{m2.group(1)}-{m2.group(2)}"
                    candidatos.append({
                        "placa":     placa_norm,
                        "confianza": round(float(confianza), 3),
                    })

        if candidatos:
            mejor = max(candidatos, key=lambda x: x["confianza"])
            return JsonResponse(mejor)

        return JsonResponse({"placa": None, "confianza": 0.0})
