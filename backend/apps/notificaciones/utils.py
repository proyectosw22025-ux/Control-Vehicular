import threading
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings

from .models import Notificacion, TipoNotificacion


def _enviar_email_sync(email: str, asunto: str, cuerpo: str, html: str) -> None:
    """Envía el email de forma síncrona. Se llama desde un hilo separado."""
    api_key = getattr(settings, 'RESEND_API_KEY', '')
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'Control Vehicular <onboarding@resend.dev>')

    if api_key:
        try:
            import resend
            resend.api_key = api_key
            params: dict = {"from": from_email, "to": [email], "subject": asunto, "text": cuerpo}
            if html:
                params["html"] = html
            resend.Emails.send(params)
        except Exception:
            pass
    else:
        try:
            from django.core.mail import send_mail
            send_mail(
                subject=asunto,
                message=cuerpo,
                from_email=from_email,
                recipient_list=[email],
                html_message=html if html else None,
                fail_silently=True,
            )
        except Exception:
            pass


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


def enviar_notificacion(usuario, titulo: str, mensaje: str, tipo_codigo: str | None = None) -> Notificacion:
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
    )

    channel_layer = get_channel_layer()
    if channel_layer is not None:
        try:
            async_to_sync(channel_layer.group_send)(
                f"notificaciones_usuario_{usuario.pk}",
                {
                    "type": "notificacion_nueva",
                    "id": notif.id,
                    "titulo": titulo,
                    "mensaje": mensaje,
                    "fecha": notif.fecha.isoformat(),
                },
            )
        except Exception:
            pass  # El usuario no tiene WS activo; la notificación queda en BD

    return notif
