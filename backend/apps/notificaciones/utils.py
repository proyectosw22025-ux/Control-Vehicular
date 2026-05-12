from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings

from .models import Notificacion, TipoNotificacion


def enviar_email(usuario, asunto: str, cuerpo: str, html: str = "") -> None:
    """
    Envía email vía Resend API (HTTPS) si RESEND_API_KEY está configurado.
    Fallback a Django SMTP si no hay API key. Nunca bloquea la request.
    """
    email = getattr(usuario, 'email', None)
    if not email:
        return

    api_key = getattr(settings, 'RESEND_API_KEY', '')
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', 'Control Vehicular <onboarding@resend.dev>')

    if api_key:
        # Resend API — más confiable que SMTP en entornos cloud
        try:
            import resend
            resend.api_key = api_key
            params = {
                "from": from_email,
                "to": [email],
                "subject": asunto,
                "text": cuerpo,
            }
            if html:
                params["html"] = html
            resend.Emails.send(params)
        except Exception:
            pass
    else:
        # Fallback SMTP (desarrollo)
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
