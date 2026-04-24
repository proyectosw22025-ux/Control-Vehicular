import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

app = Celery("vehiculos_control")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

# Tareas periódicas — se ejecutan vía celery beat
app.conf.beat_schedule = {
    "limpiar-qr-cada-hora": {
        "task": "acceso.limpiar_qr_expirados",
        "schedule": 3600.0,
    },
    "limpiar-pases-cada-hora": {
        "task": "acceso.limpiar_pases_expirados",
        "schedule": 3600.0,
    },
}
