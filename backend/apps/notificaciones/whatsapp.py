"""
Servicio de WhatsApp via Green API.

Flujo:
  Django detecta evento (entrada, multa, visita, etc.)
    → enviar_whatsapp(telefono, mensaje)
    → Green API → número Bolivia conectado → WhatsApp del destinatario

Configuración Railway:
  GREEN_API_INSTANCE_ID = 7107639603
  GREEN_API_TOKEN       = tu_token_de_green_api

Formato de números Bolivia:
  Local:        72345678    → 59172345678@c.us
  Con prefijo: +59172345678 → 59172345678@c.us
  Con 591:      59172345678 → 59172345678@c.us
"""
import base64
import io
import json
import logging
import threading
import urllib.request

logger = logging.getLogger(__name__)


# ── Generación de QR como imagen ─────────────────────────────────────────────

def _generar_qr_base64(texto: str, size: int = 300) -> str:
    """Genera un QR del texto y retorna la imagen como base64 PNG."""
    import qrcode
    from qrcode.image.pure import PyPNGImage

    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=3,
    )
    qr.add_data(texto)
    qr.make(fit=True)
    img = qr.make_image(image_factory=PyPNGImage)

    buf = io.BytesIO()
    img.save(buf)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _enviar_imagen_base64(chat_id: str, qr_base64: str, caption: str) -> bool:
    """Envía imagen QR directamente como base64 via Green API sendFileByBase64."""
    from django.conf import settings
    instance_id = getattr(settings, "GREEN_API_INSTANCE_ID", "")
    token       = getattr(settings, "GREEN_API_TOKEN", "")
    if not instance_id or not token:
        return False

    url     = f"https://7107.api.greenapi.com/waInstance{instance_id}/sendFileByBase64/{token}"
    payload = json.dumps({
        "chatId":   chat_id,
        "base64File": f"data:image/png;base64,{qr_base64}",
        "fileName": "qr_acceso.png",
        "caption":  caption,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read())
            id_msg = result.get("idMessage", "")
            if id_msg:
                logger.info("[WhatsApp IMG] QR enviado a %s — id: %s", chat_id, id_msg)
                return True
    except Exception as exc:
        logger.error("[WhatsApp IMG] Error enviando QR a %s: %s", chat_id, exc)
    return False


def enviar_whatsapp_qr(telefono: str, texto_qr: str, caption: str) -> bool:
    """
    Genera un código QR del texto_qr y lo envía como imagen a WhatsApp.
    El destinatario puede mostrarlo al guardia directamente desde WhatsApp.
    Se ejecuta en hilo daemon — no bloquea la request.
    """
    chat_id = _normalizar_telefono_bolivia(telefono)
    if not chat_id:
        return False

    def _enviar():
        try:
            qr_b64 = _generar_qr_base64(texto_qr)
            _enviar_imagen_base64(chat_id, qr_b64, caption)
        except Exception as exc:
            logger.error("[WhatsApp QR] Error generando/enviando QR: %s", exc)

    threading.Thread(target=_enviar, daemon=True).start()
    return True


def _normalizar_telefono_bolivia(telefono: str) -> str | None:
    """
    Normaliza cualquier formato de número boliviano al formato @c.us de Green API.
    Retorna None si el número no es válido.
    """
    num = telefono.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")

    # Quitar el + si lo tiene
    if num.startswith("+"):
        num = num[1:]

    # Ya tiene prefijo 591
    if num.startswith("591") and len(num) == 11:
        return f"{num}@c.us"

    # Número local de 8 dígitos → agregar 591
    if num.isdigit() and len(num) == 8:
        return f"591{num}@c.us"

    # Número con 591 pero diferente longitud
    if num.startswith("591") and len(num) > 8:
        return f"{num}@c.us"

    logger.warning("[WhatsApp] Número no reconocido como boliviano: %s", telefono)
    return None


def _enviar_green_api(chat_id: str, mensaje: str) -> bool:
    """Envía mensaje via Green API REST. Retorna True si fue exitoso."""
    from django.conf import settings
    import json
    import urllib.request

    instance_id = getattr(settings, "GREEN_API_INSTANCE_ID", "")
    token        = getattr(settings, "GREEN_API_TOKEN", "")

    if not instance_id or not token:
        logger.warning("[WhatsApp] GREEN_API_INSTANCE_ID o GREEN_API_TOKEN no configurados en Railway")
        return False

    url = f"https://7107.api.greenapi.com/waInstance{instance_id}/sendMessage/{token}"
    payload = json.dumps({"chatId": chat_id, "message": mensaje}).encode("utf-8")

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read())
            id_msg = result.get("idMessage", "")
            if id_msg:
                logger.info("[WhatsApp] ✓ Enviado a %s — id: %s", chat_id, id_msg)
                return True
            logger.warning("[WhatsApp] Respuesta sin idMessage: %s", result)
            return False
    except Exception as exc:
        logger.error("[WhatsApp] Error enviando a %s: %s", chat_id, exc)
        return False


def enviar_whatsapp(telefono: str, mensaje: str) -> bool:
    """
    Envía un mensaje de WhatsApp en un hilo daemon (no bloquea la request).
    Retorna True si el número es válido y el envío se programó.
    Retorna False si no hay configuración o el número es inválido.
    """
    if not telefono:
        return False

    chat_id = _normalizar_telefono_bolivia(telefono)
    if not chat_id:
        return False

    def _enviar():
        _enviar_green_api(chat_id, mensaje)

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
