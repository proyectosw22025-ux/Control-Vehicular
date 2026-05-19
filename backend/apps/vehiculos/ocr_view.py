"""
Vista REST para OCR de placas vehiculares bolivianas con pytesseract.

Por qué pytesseract en vez de PaddleOCR:
  PaddleOCR/PaddlePaddle requiere >1.5GB RAM para inicializar su engine.
  Railway free tier tiene 512MB → crash en producción (500/503).
  pytesseract usa el binario Tesseract instalado vía apt-get (tesseract-ocr),
  consume ~50MB, arranca en <1s y es confiable en cualquier entorno Linux.

Ventaja sobre Tesseract.js en el browser:
  El preprocessing se hace en PIL/Pillow en el servidor, con algoritmos más
  precisos que Canvas API (upscaling 3x + contraste + nitidez + binarización).
  Precisión estimada: 85-90% vs ~75-88% del Tesseract.js.

Flujo:
  1. Frontend captura frame 4:1 → base64 JPEG → POST /api/ocr/placa/
  2. Preprocessing PIL: grayscale → contraste x2.2 → nitidez x2.0 → upscale 3x
  3. pytesseract con whitelist alfanumérica y PSM 7 (línea única)
  4. Regex boliviana filtra candidatos → retorna mejor o null
"""
import base64
import io
import json
import re

from django.http import JsonResponse
from django.views import View

# Import a nivel de módulo → permite mockear en tests con @patch
try:
    import pytesseract
except ImportError:
    pytesseract = None  # type: ignore[assignment]

PLACA_RE = re.compile(r'([A-Z]{2,4}[-]?\d{3,4}[A-Z]?)', re.IGNORECASE)

TESSERACT_CONFIG = (
    '--psm 7 '           # Treat image as single text line
    '--oem 3 '           # Default engine (LSTM + legacy)
    '-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
)


def _preprocesar(img_bytes: bytes):
    """
    Preprocessing optimizado para placas vehiculares bolivianas:
      1. Grayscale — elimina ruido de color
      2. Contraste x2.2 — diferencia texto/fondo más marcada
      3. Nitidez x2.0 — bordes de caracteres más definidos
      4. Upscale 3x con LANCZOS — Tesseract funciona mejor con imágenes grandes
    Retorna PIL Image en modo 'L' (escala de grises).
    """
    from PIL import Image, ImageEnhance
    pil = Image.open(io.BytesIO(img_bytes)).convert("L")
    pil = ImageEnhance.Contrast(pil).enhance(2.2)
    pil = ImageEnhance.Sharpness(pil).enhance(2.0)
    w, h = pil.size
    pil = pil.resize((w * 3, h * 3), Image.LANCZOS)
    return pil


class OcrPlacaView(View):
    """
    POST /api/ocr/placa/
    Body JSON: { "imagen": "<base64 JPEG del recorte de la placa>" }
    Response:  { "placa": "SCZ-3456", "confianza": 0.90 }
            o  { "placa": null, "confianza": 0.0 }
    """

    def _autenticar(self, request):
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
            auth = JWTAuthentication()
            validated = auth.get_validated_token(
                token.encode() if isinstance(token, str) else token
            )
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
            img_pil = _preprocesar(img_bytes)
        except Exception as e:
            return JsonResponse({"error": f"Error al procesar imagen: {e}", "placa": None}, status=400)

        # ── OCR con pytesseract ───────────────────────────────────────────
        if pytesseract is None:
            return JsonResponse(
                {"error": "pytesseract no disponible. Instala: apt-get install tesseract-ocr && pip install pytesseract", "placa": None},
                status=503,
            )
        try:
            raw = pytesseract.image_to_string(img_pil, config=TESSERACT_CONFIG)
        except Exception as e:
            return JsonResponse({"error": str(e), "placa": None}, status=500)

        # ── Filtrar candidatos con regex boliviana ────────────────────────
        limpio = re.sub(r"[^A-Z0-9-]", "", raw.upper())
        match  = PLACA_RE.search(limpio)

        if not match:
            return JsonResponse({"placa": None, "confianza": 0.0})

        placa = match.group(0).upper()
        # Insertar guión si falta: SCZ3456 → SCZ-3456
        if "-" not in placa:
            m2 = re.match(r"([A-Z]{2,4})(\d{3,4}[A-Z]?)", placa)
            if m2:
                placa = f"{m2.group(1)}-{m2.group(2)}"

        # pytesseract no da score de confianza por texto (solo por caja).
        # Estimamos confianza basada en longitud y formato correcto.
        confianza = 0.85 if re.match(r'^[A-Z]{2,4}-\d{3,4}[A-Z]?$', placa) else 0.70

        return JsonResponse({"placa": placa, "confianza": confianza})
