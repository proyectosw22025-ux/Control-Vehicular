import os
from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("vehiculos_control")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Tareas periódicas — se ejecutan vía celery beat
app.conf.beat_schedule = {
    # Cada hora — limpieza de accesos
    "limpiar-qr-cada-hora": {
        "task": "acceso.limpiar_qr_expirados",
        "schedule": 3600.0,
    },
    "limpiar-pases-cada-hora": {
        "task": "acceso.limpiar_pases_expirados",
        "schedule": 3600.0,
    },
    # Cada hora — expirar reservas de parqueo no usadas
    "expirar-reservas-cada-hora": {
        "task": "acceso.expirar_reservas",
        "schedule": 3600.0,
    },
    # Cada 4 horas — alertar sesiones de parqueo anormalmente largas
    "alertar-sesiones-largas": {
        "task": "acceso.alertar_sesiones_largas",
        "schedule": 14400.0,
    },
    # Diariamente a las 7:00 AM — alertas de SOAT, técnica y circulación próximos a vencer
    # Detecta documentos que vencen en exactamente 30, 15 o 5 días
    "alertar-documentos-diario": {
        "task": "vehiculos.alertar_documentos_por_vencer",
        "schedule": crontab(hour=7, minute=0),
    },
}
