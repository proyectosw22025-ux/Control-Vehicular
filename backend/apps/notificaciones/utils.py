import logging
import threading
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings

from .models import Notificacion, TipoNotificacion

logger = logging.getLogger(__name__)


def _enviar_email_sync(email: str, asunto: str, cuerpo: str, html: str) -> None:
    """
    Envía el email de forma síncrona. Se llama desde un hilo separado.

    Prioridad (de mayor a menor confiabilidad en Railway):
      1. Brevo HTTP API  (BREVO_API_KEY)  — usa HTTPS puerto 443, nunca bloqueado
      2. Resend HTTP API (RESEND_API_KEY) — también HTTPS, requiere dominio verificado
      3. SMTP Django     (EMAIL_HOST_USER) — puerto 587, bloqueado por Railway
    """
    from_email   = getattr(settings, 'DEFAULT_FROM_EMAIL',
                           'Control Vehicular UAGRM <noreply@control-vehicular.app>')
    brevo_key    = getattr(settings, 'BREVO_API_KEY',   '')
    resend_key   = getattr(settings, 'RESEND_API_KEY',  '')

    # ── 1. Brevo HTTP API ─────────────────────────────────────────────────────
    if brevo_key:
        try:
            import json, urllib.request
            # Extraer nombre y email del DEFAULT_FROM_EMAIL: "Nombre <email@>"
            import re
            m = re.match(r'^(.+?)\s*<(.+?)>$', from_email.strip())
            sender_name  = m.group(1).strip() if m else "Control Vehicular UAGRM"
            sender_email = m.group(2).strip() if m else "noreply@control-vehicular.app"

            payload = json.dumps({
                "sender":      {"name": sender_name, "email": sender_email},
                "to":          [{"email": email}],
                "subject":     asunto,
                "textContent": cuerpo,
                "htmlContent": html or cuerpo,
            }).encode("utf-8")

            req = urllib.request.Request(
                "https://api.brevo.com/v3/smtp/email",
                data=payload,
                headers={"Content-Type": "application/json", "api-key": brevo_key},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                result = json.loads(resp.read())
            logger.info("[EMAIL] Enviado via Brevo API a %s — id=%s",
                        email, result.get("messageId", "?"))
            return
        except Exception as exc:
            logger.error("[EMAIL] Error Brevo API enviando a %s: %s", email, exc)

    # ── 2. Resend HTTP API ────────────────────────────────────────────────────
    if resend_key:
        try:
            import resend
            resend.api_key = resend_key
            params: dict = {
                "from": from_email, "to": [email],
                "subject": asunto, "text": cuerpo,
            }
            if html:
                params["html"] = html
            result = resend.Emails.send(params)
            logger.info("[EMAIL] Enviado via Resend a %s — id=%s",
                        email, result.get("id", "?"))
            return
        except Exception as exc:
            logger.error("[EMAIL] Error Resend enviando a %s: %s", email, exc)

    # ── 3. SMTP Django (fallback — puede fallar en Railway por puerto bloqueado) ──
    try:
        from django.core.mail import send_mail
        send_mail(
            subject=asunto, message=cuerpo, from_email=from_email,
            recipient_list=[email],
            html_message=html if html else None,
            fail_silently=False,
        )
        logger.info("[EMAIL] Enviado via SMTP a %s", email)
    except Exception as exc:
        logger.error(
            "[EMAIL] Error SMTP enviando a %s: %s — "
            "Agrega BREVO_API_KEY en Railway para evitar bloqueo de puertos",
            email, exc
        )


def enviar_email(usuario, asunto: str, cuerpo: str, html: str = "") -> None:
    """
    Envía email en un hilo separado para no bloquear la request HTTP.
    El usuario recibe la respuesta inmediatamente; el email llega en segundos.
    """
    email = getattr(usuario, 'email', None)
    if not email:
        return
    hilo = threading.Thread(
        target=_enviar_email_sync,
        args=(email, asunto, cuerpo, html),
        daemon=True,
    )
    hilo.start()


def enviar_notificacion(usuario, titulo: str, mensaje: str, tipo_codigo: str | None = None, datos_extra: dict | None = None) -> Notificacion:
    """
    Guarda la notificación en BD y la entrega en tiempo real por WebSocket
    al canal del usuario (si hay una conexión activa).
    """
    tipo = None
    if tipo_codigo:
        tipo = TipoNotificacion.objects.filter(codigo=tipo_codigo).first()

    notif = Notificacion.objects.create(
        usuario=usuario,
        titulo=titulo,
        mensaje=mensaje,
        tipo=tipo,
        datos_extra=datos_extra or {},
    )

    channel_layer = get_channel_layer()
    if channel_layer is not None:
        try:
            async_to_sync(channel_layer.group_send)(
                f"notificaciones_usuario_{usuario.pk}",
                {
                    "type":       "notificacion_nueva",
                    "id":         notif.id,
                    "titulo":     titulo,
                    "mensaje":    mensaje,
                    "fecha":      notif.fecha.isoformat(),
                    "tipo_codigo": tipo_codigo or "",
                    "datos_extra": datos_extra or {},  # contexto para acciones del frontend
                },
            )
        except Exception:
            pass  # El usuario no tiene WS activo; la notificación queda en BD

    return notif
