"""
Servicio de WhatsApp via Fonnte API.

Flujo:
  Django detecta evento (entrada, multa, visita, etc.)
    → enviar_whatsapp(telefono, mensaje)
    → Fonnte API → número Bolivia conectado → WhatsApp del destinatario

Configuración Railway:
  FONNTE_TOKEN = tu_token_de_fonnte

Formato de números Bolivia:
  Local:        72345678    → 59172345678
  Con prefijo: +59172345678 → 59172345678
  Con 591:      59172345678 → 59172345678
"""
import base64
import io
import json
import logging
import threading
import urllib.request

logger = logging.getLogger(__name__)

FONNTE_API_URL = "https://api.fonnte.com/send"


# ── Generación de QR como imagen ─────────────────────────────────────────────

def _generar_qr_base64(texto: str) -> str:
    """Genera un QR del texto y retorna la imagen como base64 PNG usando PIL."""
    import qrcode
    from PIL import Image

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=12,
        border=4,
    )
    qr.add_data(texto)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    img = img.resize((400, 400), Image.NEAREST)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _normalizar_telefono_bolivia(telefono: str) -> str | None:
    """
    Normaliza cualquier formato de número boliviano al formato internacional para Fonnte.
    Retorna None si el número no es válido.
    """
    num = telefono.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")

    if num.startswith("+"):
        num = num[1:]

    if num.startswith("591") and len(num) == 11:
        return num

    if num.isdigit() and len(num) == 8:
        return f"591{num}"

    if num.startswith("591") and len(num) > 8:
        return num

    logger.warning("[WhatsApp] Número no reconocido como boliviano: %s", telefono)
    return None


def _enviar_fonnte(telefono: str, mensaje: str) -> bool:
    """Envía mensaje de texto via Fonnte API. Retorna True si fue exitoso."""
    from django.conf import settings

    token = getattr(settings, "FONNTE_TOKEN", "")
    if not token:
        logger.warning("[WhatsApp] FONNTE_TOKEN no configurado")
        return False

    payload = json.dumps({
        "target": telefono,
        "message": mensaje,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            FONNTE_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": token,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            if result.get("status"):
                logger.info("[WhatsApp] ✓ Enviado a %s", telefono)
                return True
            logger.warning("[WhatsApp] Respuesta Fonnte: %s", result)
            return False
    except Exception as exc:
        logger.error("[WhatsApp] Error enviando a %s: %s", telefono, exc)
        return False


def _enviar_imagen_por_url(telefono: str, url_imagen: str, caption: str) -> bool:
    """Envía imagen via Fonnte API usando URL pública."""
    from django.conf import settings

    token = getattr(settings, "FONNTE_TOKEN", "")
    if not token:
        return False

    payload = json.dumps({
        "target": telefono,
        "message": caption,
        "url": url_imagen,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            FONNTE_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": token,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read())
            if result.get("status"):
                logger.info("[WhatsApp IMG] QR enviado a %s", telefono)
                return True
            logger.warning("[WhatsApp IMG] Respuesta Fonnte: %s", result)
    except Exception as exc:
        logger.error("[WhatsApp IMG] Error enviando imagen a %s: %s", telefono, exc)
    return False


def enviar_whatsapp_qr(telefono: str, texto_qr: str, caption: str) -> bool:
    """
    Genera un QR y lo envía como imagen a WhatsApp usando Fonnte.
    Fallback: envía el código como texto si falla la imagen.
    """
    import urllib.parse
    tel_limpio = telefono.strip().replace(" ", "")
    tel_normalizado = _normalizar_telefono_bolivia(tel_limpio)
    if not tel_normalizado:
        logger.warning("[WhatsApp QR] Número inválido: %r", telefono)
        return False

    logger.info("[WhatsApp QR] Enviando QR '%s...' a %s", texto_qr[:12], tel_normalizado)

    def _enviar():
        texto_encoded = urllib.parse.quote(texto_qr)
        url_qr = f"https://api.qrserver.com/v1/create-qr-code/?data={texto_encoded}&size=350x350&margin=4&ecc=H"

        ok = _enviar_imagen_por_url(tel_normalizado, url_qr, caption)
        if not ok:
            logger.warning("[WhatsApp QR] Imagen falló, enviando código como texto")
            _enviar_fonnte(
                tel_normalizado,
                f"🎓 *Pase de acceso UAGRM*\n\n"
                f"Código: *{texto_qr}*\n\n"
                f"{caption}\n\n"
                f"_(Abre la URL de verificación para ver el QR visual)_"
            )

    threading.Thread(target=_enviar, daemon=True).start()
    return True


def enviar_whatsapp(telefono: str, mensaje: str) -> bool:
    """
    Envía un mensaje de WhatsApp en un hilo daemon (no bloquea la request).
    Retorna True si el número es válido y el envío se programó.
    """
    if not telefono:
        return False

    tel_normalizado = _normalizar_telefono_bolivia(telefono)
    if not tel_normalizado:
        return False

    def _enviar():
        _enviar_fonnte(tel_normalizado, mensaje)

    threading.Thread(target=_enviar, daemon=True).start()
    return True


# ── Mensajes predefinidos para cada evento del sistema ────────────────────────

def msg_entrada_campus(placa: str, punto: str, hora: str) -> str:
    return (
        f"🚗 *Control Vehicular UAGRM*\n\n"
        f"Tu vehículo *{placa}* ingresó al campus.\n"
        f"📍 Portería: {punto}\n"
        f"⏰ Hora: {hora}"
    )


def msg_salida_campus(placa: str, punto: str, hora: str) -> str:
    return (
        f"🚗 *Control Vehicular UAGRM*\n\n"
        f"Tu vehículo *{placa}* salió del campus.\n"
        f"📍 Portería: {punto}\n"
        f"⏰ Hora: {hora}"
    )


def msg_multa_registrada(placa: str, tipo_multa: str, monto: str) -> str:
    return (
        f"⚠️ *Control Vehicular UAGRM*\n\n"
        f"Se registró una multa para *{placa}*.\n"
        f"📋 Infracción: {tipo_multa}\n"
        f"💰 Monto: Bs {monto}\n\n"
        f"Regulariza en el sistema para rehabilitar tu vehículo."
    )


def msg_visita_pre_registrada(nombre: str, codigo: str, url: str) -> str:
    return (
        f"✅ *UAGRM — Pase de acceso*\n\n"
        f"Hola {nombre}, tu pre-registro fue confirmado.\n\n"
        f"🔑 Código: *{codigo}*\n"
        f"📱 Muestra este código al guardia:\n{url}\n\n"
        f"Válido solo el día de tu visita hasta las 23:00."
    )


def msg_autorizacion_externa(empresa: str, placa: str, destino: str,
                              valido_desde: str, valido_hasta: str,
                              codigo: str, url: str) -> str:
    return (
        f"✅ *UAGRM — Autorización de acceso*\n\n"
        f"*{empresa}*\n"
        f"🚛 Placa: {placa}\n"
        f"📍 Destino: {destino}\n"
        f"🕐 Válido: {valido_desde} - {valido_hasta}\n\n"
        f"🔑 Código: *{codigo}*\n"
        f"📱 Ver QR: {url}"
    )


def msg_alerta_guardia(placa: str, tipo_alerta: str, descripcion: str) -> str:
    return (
        f"🔴 *ALERTA — Control Vehicular UAGRM*\n\n"
        f"Vehículo: *{placa}*\n"
        f"⚠️ {tipo_alerta}\n"
        f"📋 {descripcion}\n\n"
        f"Verificar en el panel de guardia."
    )
