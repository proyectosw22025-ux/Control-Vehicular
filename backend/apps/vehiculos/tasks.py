from celery import shared_task
from django.utils import timezone
from datetime import timedelta


@shared_task(name="vehiculos.alertar_documentos")
def alertar_documentos_por_vencer():
    """
    Revisa documentos SOAT y Revisión Técnica que vencen en 30, 7 o 1 días
    y envía notificación al propietario del vehículo.
    Corre diariamente vía Celery beat.
    """
    from .models import DocumentoVehiculo
    from apps.notificaciones.utils import enviar_notificacion

    hoy = timezone.localdate()
    umbrales = [
        (1,  "URGENTE", "vence mañana"),
        (7,  "Alerta",  "vence en 7 días"),
        (30, "Aviso",   "vence en 30 días"),
    ]
    tipos_alerta = ["soat", "tecnica"]

    for dias, nivel, texto in umbrales:
        fecha_objetivo = hoy + timedelta(days=dias)
        docs = (
            DocumentoVehiculo.objects
            .filter(tipo_doc__in=tipos_alerta, fecha_vencimiento=fecha_objetivo)
            .select_related("vehiculo__propietario")
        )
        for doc in docs:
            vehiculo = doc.vehiculo
            propietario = vehiculo.propietario
            tipo_label = "SOAT" if doc.tipo_doc == "soat" else "Revisión Técnica"
            enviar_notificacion(
                usuario=propietario,
                titulo=f"{nivel}: {tipo_label} de {vehiculo.placa} {texto}",
                mensaje=(
                    f"El {tipo_label} del vehículo {vehiculo.marca} {vehiculo.modelo} "
                    f"({vehiculo.placa}) vence el {doc.fecha_vencimiento.strftime('%d/%m/%Y')}. "
                    f"Renueva el documento para evitar sanciones."
                ),
                tipo_codigo="documento_por_vencer",
            )
