from celery import shared_task
from django.utils import timezone


@shared_task(name="acceso.limpiar_qr_expirados")
def limpiar_qr_expirados():
    from .models import QrSesion
    resultado = QrSesion.objects.filter(
        fecha_expiracion__lt=timezone.now(), usado=False
    ).update(usado=True)
    return f"QR marcados como usados/expirados: {resultado}"


@shared_task(name="acceso.limpiar_pases_expirados")
def limpiar_pases_expirados():
    from .models import PaseTemporal
    resultado = PaseTemporal.objects.filter(
        valido_hasta__lt=timezone.now(), activo=True
    ).update(activo=False)
    return f"Pases temporales desactivados: {resultado}"
