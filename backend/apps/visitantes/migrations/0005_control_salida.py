"""
Control de salida de visitantes:
  - TipoVisita.duracion_esperada_horas: umbral inteligente por tipo (no un tiempo fijo)
  - Visita.tipo_cierre: distingue salida manual, confirmada por anfitrión, o auto-cerrada
  - Visita.notificacion_anfitrion_enviada: evita spam de notificaciones

La distinción tipo_cierre es clave para la integridad del historial:
el sistema admite explícitamente cuando una salida NO fue verificada por un humano.
"""
from django.db import migrations, models

DURACIONES_POR_TIPO = {
    "Académica":                2,
    "Proveedora / Proveedor":   6,
    "Familiar":                 3,
    "Laboral / Administrativa": 3,
    "Trámite Oficial":          2,
    "Evento / Acto Académico":  8,
    "Autoridad Externa":        4,
    "Emergencia":               1,
}


def asignar_duraciones(apps, schema_editor):
    TipoVisita = apps.get_model("visitantes", "TipoVisita")
    for nombre, horas in DURACIONES_POR_TIPO.items():
        TipoVisita.objects.filter(nombre=nombre).update(duracion_esperada_horas=horas)


class Migration(migrations.Migration):

    dependencies = [
        ("visitantes", "0004_visitante_procedencia_visita_acompanantes"),
    ]

    operations = [
        migrations.AddField(
            model_name="tipovisita",
            name="duracion_esperada_horas",
            field=models.PositiveSmallIntegerField(
                default=4,
                help_text="Duración típica en horas. Pasado este umbral se notifica al anfitrión y se auto-cierra si no hay confirmación.",
            ),
        ),
        migrations.AddField(
            model_name="visita",
            name="tipo_cierre",
            field=models.CharField(
                max_length=25,
                blank=True,
                default="",
                choices=[
                    ("manual_guardia",       "Registrada por guardia"),
                    ("confirmado_anfitrion", "Confirmada por anfitrión"),
                    ("auto",                 "Auto-cerrada — salida no verificada"),
                ],
                help_text="Indica quién confirmó la salida. Vacío = visita aún activa.",
            ),
        ),
        migrations.AddField(
            model_name="visita",
            name="notificacion_anfitrion_enviada",
            field=models.BooleanField(
                default=False,
                help_text="True cuando ya se envió la notificación de verificación al anfitrión.",
            ),
        ),
        migrations.RunPython(asignar_duraciones, reverse_code=migrations.RunPython.noop),
    ]
