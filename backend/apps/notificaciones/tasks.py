from celery import shared_task
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def enviar_notificacion(usuario_id: int, titulo: str, mensaje: str, tipo_codigo: str = None, datos_extra: dict = None):
    from .models import TipoNotificacion, Notificacion
    from django.contrib.auth import get_user_model
    Usuario = get_user_model()
    try:
        usuario = Usuario.objects.get(pk=usuario_id)
    except Usuario.DoesNotExist:
        return None
    tipo = None
    if tipo_codigo:
        tipo = TipoNotificacion.objects.filter(codigo=tipo_codigo).first()
    notif = Notificacion.objects.create(
        usuario=usuario,
        tipo=tipo,
        titulo=titulo,
        mensaje=mensaje,
        datos_extra=datos_extra or {},
    )
    channel_layer = get_channel_layer()
    group_name = f"notificaciones_usuario_{usuario_id}"
    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": "notificacion_nueva",
            "id": notif.pk,
            "titulo": notif.titulo,
            "mensaje": notif.mensaje,
            "fecha": notif.fecha.isoformat(),
        },
    )
    return notif


@shared_task(name="notificaciones.notificar_multa")
def notificar_multa(usuario_id: int, placa: str, monto: str):
    enviar_notificacion(
        usuario_id=usuario_id,
        titulo="Nueva multa registrada",
        mensaje=f"Su vehículo {placa} tiene una multa de Bs {monto}.",
        tipo_codigo="multa_nueva",
        datos_extra={"placa": placa, "monto": monto},
    )


@shared_task(name="notificaciones.notificar_reserva_proxima")
def notificar_reserva_proxima(usuario_id: int, espacio: str, fecha: str):
    enviar_notificacion(
        usuario_id=usuario_id,
        titulo="Reserva próxima a vencer",
        mensaje=f"Su reserva en {espacio} vence a las {fecha}.",
        tipo_codigo="reserva_proxima",
        datos_extra={"espacio": espacio, "fecha": fecha},
    )


@shared_task(name="notificaciones.notificar_qr_generado")
def notificar_qr_generado(usuario_id: int, placa: str, expiracion: str):
    enviar_notificacion(
        usuario_id=usuario_id,
        titulo="QR de acceso generado",
        mensaje=f"Se generó un QR para {placa} válido hasta {expiracion}.",
        tipo_codigo="qr_generado",
        datos_extra={"placa": placa, "expiracion": expiracion},
    )
