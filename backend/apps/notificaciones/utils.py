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

    Prioridad:
      1. Resend API (RESEND_API_KEY configurada en Railway)
      2. SMTP (EMAIL_HOST_USER + EMAIL_HOST_PASSWORD en Railway)
      3. Console backend — imprime en logs, NO envía (solo para desarrollo)
    """
    api_key   = getattr(settings, 'RESEND_API_KEY', '')
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL',
                         'Control Vehicular <onboarding@resend.dev>')

    if api_key:
        try:
            import resend
            resend.api_key = api_key
            params: dict = {
                "from": from_email,
                "to":   [email],
                "subject": asunto,
                "text": cuerpo,
            }
            if html:
                params["html"] = html
            result = resend.Emails.send(params)
            logger.info("[EMAIL] Enviado via Resend a %s — id=%s", email, result.get("id", "?"))
        except Exception as exc:
            logger.error("[EMAIL] Error Resend enviando a %s: %s", email, exc)
    else:
        try:
            from django.core.mail import send_mail
            send_mail(
                subject=asunto,
                message=cuerpo,
                from_email=from_email,
                recipient_list=[email],
                html_message=html if html else None,
                fail_silently=False,
            )
            logger.info("[EMAIL] Enviado via SMTP/backend a %s", email)
        except Exception as exc:
            logger.error(
                "[EMAIL] Error enviando a %s: %s — "
                "Configura RESEND_API_KEY o EMAIL_HOST_USER/PASSWORD en Railway",
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
