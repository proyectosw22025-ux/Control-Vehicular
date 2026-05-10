from typing import Optional
from celery import shared_task
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer  # type: ignore[import-untyped]


def _enviar_notificacion_ws(usuario_id: int, titulo: str, mensaje: str, tipo_codigo: Optional[str] = None, datos_extra: Optional[dict] = None):
    """Crea la notificación en BD y la entrega por WebSocket si hay canal activo."""
    from .models import TipoNotificacion, Notificacion
    from django.contrib.auth import get_user_model
    Usuario = get_user_model()
    try:
        usuario = Usuario.objects.get(pk=usuario_id)
    except Usuario.DoesNotExist:
        return None
    tipo = TipoNotificacion.objects.filter(codigo=tipo_codigo).first() if tipo_codigo else None
    notif = Notificacion.objects.create(
        usuario=usuario,
        tipo=tipo,
        titulo=titulo,
        mensaje=mensaje,
        datos_extra=datos_extra or {},
    )
    channel_layer = get_channel_layer()
    if channel_layer is not None:
        try:
            async_to_sync(channel_layer.group_send)(
                f"notificaciones_usuario_{usuario_id}",
                {
                    "type": "notificacion_nueva",
                    "id": notif.pk,
                    "titulo": notif.titulo,
                    "mensaje": notif.mensaje,
                    "fecha": notif.fecha.isoformat(),
                },
            )
        except Exception:
            pass
    return notif


@shared_task(name="notificaciones.notificar_multa")
def notificar_multa(usuario_id: int, placa: str, monto: str):
    _enviar_notificacion_ws(
        usuario_id=usuario_id,
        titulo="Nueva multa registrada",
        mensaje=f"Su vehículo {placa} tiene una multa de Bs {monto}.",
        tipo_codigo="multa_nueva",
        datos_extra={"placa": placa, "monto": monto},
    )


@shared_task(name="notificaciones.notificar_reserva_proxima")
def notificar_reserva_proxima(usuario_id: int, espacio: str, fecha: str):
    _enviar_notificacion_ws(
        usuario_id=usuario_id,
        titulo="Reserva próxima a vencer",
        mensaje=f"Su reserva en {espacio} vence a las {fecha}.",
        tipo_codigo="reserva_proxima",
        datos_extra={"espacio": espacio, "fecha": fecha},
    )


@shared_task(name="notificaciones.notificar_qr_generado")
def notificar_qr_generado(usuario_id: int, placa: str, expiracion: str):
    _enviar_notificacion_ws(
        usuario_id=usuario_id,
        titulo="QR de acceso generado",
        mensaje=f"Se generó un QR para {placa} válido hasta {expiracion}.",
        tipo_codigo="qr_generado",
        datos_extra={"placa": placa, "expiracion": expiracion},
    )
