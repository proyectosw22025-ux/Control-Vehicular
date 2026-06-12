from celery import shared_task
from django.utils import timezone


# NOTA: la antigua task limpiar_qr_expirados se eliminó — crasheaba cada hora
# porque QrSesion.usado es una @property (no un campo) desde el modelo de usos
# múltiples. Era además redundante: QrSesion.vigente valida fecha_expiracion
# en el momento del uso, así que un QR vencido nunca puede consumirse.


@shared_task(name="acceso.limpiar_pases_expirados")
def limpiar_pases_expirados():
    from .models import PaseTemporal
    resultado = PaseTemporal.objects.filter(
        valido_hasta__lt=timezone.now(), activo=True
    ).update(activo=False)
    return f"Pases temporales desactivados: {resultado}"


@shared_task(name="acceso.vigilar_vencimiento_temporal")
def vigilar_vencimiento_temporal(vehiculo_temporal_id: int, escalar: bool = False):
    """
    Se ejecuta al vencer el tiempo de un acceso temporal.
    Si el vehículo no ha salido: crea AlertaAcceso y notifica a guardias.
    escalar=True → la segunda llamada (+30min) sube la severidad a crítica.
    """
    from apps.acceso.models import VehiculoTemporal, AlertaAcceso
    from apps.usuarios.models import UsuarioRol
    from apps.notificaciones.utils import enviar_notificacion

    vt = VehiculoTemporal.objects.filter(pk=vehiculo_temporal_id, activo=True).first()
    if not vt:
        return "Vehículo temporal ya salió o no existe"

    severidad   = "critica" if escalar else "advertencia"
    demora_min  = 60 if escalar else 30
    descripcion = (
        f"{vt.placa} ({vt.get_tipo_display()}) lleva {demora_min}min más del tiempo "
        f"autorizado. Destino: {vt.destino}."
    )

    alerta = AlertaAcceso.objects.create(
        vehiculo=None,
        tipo_anomalia="vehiculo_sancionado",
        severidad=severidad,
        descripcion=descripcion,
        fecha_analisis=timezone.now().date(),
        datos_extra={
            "placa":               vt.placa,
            "tipo":                vt.tipo,
            "destino":             vt.destino,
            "vehiculo_temporal_id": vehiculo_temporal_id,
        },
    )

    # Notificar a todos los guardias y admins activos
    guardias_admins = UsuarioRol.objects.filter(
        rol__nombre__in=["Guardia", "Administrador"]
    ).select_related("usuario")

    icono = "🔴" if escalar else "🟠"
    for ur in guardias_admins:
        enviar_notificacion(
            usuario=ur.usuario,
            titulo=f"{icono} Vehículo temporal vencido — {vt.placa}",
            mensaje=descripcion,
            tipo_codigo="alerta_acceso",
            datos_extra={
                "alerta_id":     alerta.pk,
                "tipo_anomalia": "vehiculo_sancionado",
                "severidad":     severidad,
                "placa":         vt.placa,
                "descripcion":   descripcion,
            },
        )

    return f"Alerta {'crítica' if escalar else 'advertencia'} enviada para {vt.placa}"


# NOTA: alertar_sesiones_largas vive en apps/parqueos/tasks.py — es dominio de parqueo.
