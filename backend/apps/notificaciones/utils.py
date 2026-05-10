from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.mail import send_mail
from django.conf import settings

from .models import Notificacion, TipoNotificacion


def enviar_email(usuario, asunto: str, cuerpo: str) -> None:
    email = getattr(usuario, 'email', None)
    if not email:
        return
    try:
        send_mail(
            subject=asunto,
            message=cuerpo,
            from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@parqueo.edu.bo'),
            recipient_list=[email],
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
