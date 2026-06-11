from celery import shared_task
from django.utils import timezone
from datetime import timedelta


@shared_task(name="parqueos.alertar_sesiones_largas")
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
