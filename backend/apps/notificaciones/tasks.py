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


@shared_task(name="vehiculos.alertar_documentos_por_vencer")
def alertar_documentos_por_vencer():
    """
    Tarea programada diaria (Celery Beat — 7:00 AM).
    Detecta documentos críticos (SOAT, Revisión Técnica) que vencen
    en exactamente 30, 15 o 5 días y notifica al propietario.

    Por qué umbrales exactos (no rangos):
      Si usáramos 'días <= 30', notificaríamos TODOS LOS DÍAS durante un mes.
      Con fechas exactas, el propietario recibe 3 avisos puntuales: con tiempo,
      con urgencia, y de emergencia — sin spam.
    """
    from datetime import timedelta
    from django.utils import timezone
    from apps.vehiculos.models import DocumentoVehiculo

    hoy = timezone.now().date()
    UMBRALES_DIAS = [30, 15, 5]
    DOCS_CRITICOS = {"soat", "tecnica"}
    NOMBRES = {
        "soat":        "SOAT",
        "tecnica":     "Revisión Técnica",
        "circulacion": "Permiso de Circulación",
        "otro":        "Documento",
    }

    notificados = 0
    for dias in UMBRALES_DIAS:
        fecha_objetivo = hoy + timedelta(days=dias)
        docs = (
            DocumentoVehiculo.objects
            .filter(fecha_vencimiento=fecha_objetivo)
            .select_related("vehiculo__propietario")
        )
        for doc in docs:
            propietario = doc.vehiculo.propietario
            es_critico = doc.tipo_doc in DOCS_CRITICOS
            titulo = (
                f"🚨 {NOMBRES[doc.tipo_doc]} vence en {dias} días — {doc.vehiculo.placa}"
                if es_critico else
                f"📄 {NOMBRES[doc.tipo_doc]} vence en {dias} días — {doc.vehiculo.placa}"
            )
            _enviar_notificacion_ws(
                usuario_id=propietario.pk,
                titulo=titulo,
                mensaje=(
                    f"El {NOMBRES[doc.tipo_doc]} de tu vehículo {doc.vehiculo.placa} "
                    f"vence el {doc.fecha_vencimiento.strftime('%d/%m/%Y')} "
                    f"(N° {doc.numero}). Renuévalo para seguir accediendo al campus."
                ),
                tipo_codigo="documento_por_vencer",
                datos_extra={
                    "placa": doc.vehiculo.placa,
                    "tipo_doc": doc.tipo_doc,
                    "fecha_vencimiento": doc.fecha_vencimiento.isoformat(),
                    "dias_restantes": dias,
                },
            )
            notificados += 1

    return f"alertar_documentos_por_vencer: {notificados} notificaciones enviadas"
