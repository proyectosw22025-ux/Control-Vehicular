from celery import shared_task
from django.utils import timezone
from datetime import timedelta


@shared_task(name="acceso.limpiar_qr_expirados")
def limpiar_qr_expirados():
    from .models import QrSesion
    resultado = QrSesion.objects.filter(
        fecha_expiracion__lt=timezone.now(), usado=False
    ).update(usado=True)
    return f"QR de delegación expirados: {resultado}"


@shared_task(name="acceso.limpiar_pases_expirados")
def limpiar_pases_expirados():
    from .models import PaseTemporal
    resultado = PaseTemporal.objects.filter(
        valido_hasta__lt=timezone.now(), activo=True
    ).update(activo=False)
    return f"Pases temporales desactivados: {resultado}"


@shared_task(name="acceso.expirar_reservas")
def expirar_reservas():
    """
    Reservas cuya fecha_fin ya pasó y siguen en estado pendiente/confirmada
    se marcan como expiradas. El espacio vuelve a estar disponible para otros.
    """
    from apps.parqueos.models import Reserva
    ahora = timezone.now()
    expiradas = Reserva.objects.filter(
        fecha_fin__lt=ahora, estado__in=["pendiente", "confirmada"]
    )
    count = expiradas.count()
    expiradas.update(estado="expirada")
    return f"Reservas expiradas: {count}"


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


@shared_task(name="acceso.alertar_sesiones_largas")
def alertar_sesiones_largas():
    """
    Sesiones de parqueo abiertas por más de 10 horas generan una alerta
    al administrador. Útil para detectar vehículos olvidados o fallas en el
    registro de salida.
    """
    from apps.parqueos.models import SesionParqueo
    from apps.notificaciones.utils import enviar_notificacion
    from apps.usuarios.models import UsuarioRol
    limite = timezone.now() - timedelta(hours=10)
    sesiones = SesionParqueo.objects.filter(
        estado="activa", hora_entrada__lt=limite
    ).select_related("vehiculo__propietario", "espacio__zona")
    if not sesiones.exists():
        return "Sin sesiones largas detectadas"
    admins = [
        ur.usuario for ur in UsuarioRol.objects.filter(
            rol__nombre="Administrador"
        ).select_related("usuario").distinct()
    ]
    for sesion in sesiones:
        horas = int((timezone.now() - sesion.hora_entrada).total_seconds() / 3600)
        msg = (
            f"El vehículo {sesion.vehiculo.placa} lleva {horas}h en "
            f"{sesion.espacio.zona.nombre} #{sesion.espacio.numero} "
            f"sin registrar salida."
        )
        for admin in admins:
            enviar_notificacion(
                usuario=admin,
                titulo=f"Sesión prolongada — {sesion.vehiculo.placa}",
                mensaje=msg,
                tipo_codigo="sesion_prolongada",
            )
    return f"Alertas enviadas por {sesiones.count()} sesiones prolongadas"
