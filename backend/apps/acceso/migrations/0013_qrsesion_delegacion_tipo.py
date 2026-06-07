"""
Migración 0013 — QrSesion: tipo de delegación + conteo de usos

Cambios:
  - Agrega  tipo_delegacion ("entrada"|"salida"|"ambos", default="ambos")
  - Agrega  usos_max     (1 para entrada/salida, 2 para ambos)
  - Agrega  usos_actual  (contador de usos consumidos)
  - Elimina usado        (BooleanField legacy, reemplazado por usos_actual >= usos_max)

Data migration:
  Todos los registros existentes quedan con tipo_delegacion="ambos",
  usos_max=1 y usos_actual derivado del campo 'usado' anterior.
"""
from django.db import migrations, models


def _migrar_usado_a_usos(apps, schema_editor):
    """Convierte el bool 'usado' a usos_actual (0 o 1) para todos los registros."""
    QrSesion = apps.get_model("acceso", "QrSesion")
    QrSesion.objects.filter(usado=True).update(usos_actual=1)
    # Los que tenían usado=False ya tienen usos_actual=0 (default del AddField)


class Migration(migrations.Migration):

    dependencies = [
        ("acceso", "0012_autorizacion_acceso_externo"),
    ]

    operations = [
        # 1. Agregar nuevos campos
        migrations.AddField(
            model_name="qrsesion",
            name="tipo_delegacion",
            field=models.CharField(
                choices=[
                    ("entrada", "Solo entrada"),
                    ("salida",  "Solo salida"),
                    ("ambos",   "Entrada y salida"),
                ],
                default="ambos",
                help_text="Tipo de acceso que habilita este QR.",
                max_length=8,
            ),
        ),
        migrations.AddField(
            model_name="qrsesion",
            name="usos_max",
            field=models.PositiveSmallIntegerField(
                default=1,
                help_text="Usos totales permitidos: 1 para entrada/salida, 2 para ambos.",
            ),
        ),
        migrations.AddField(
            model_name="qrsesion",
            name="usos_actual",
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text="Número de veces que este QR ya fue utilizado.",
            ),
        ),
        # 2. Poblar usos_actual desde el campo 'usado' antes de eliminarlo
        migrations.RunPython(_migrar_usado_a_usos, migrations.RunPython.noop),
        # 3. Eliminar el campo legacy
        migrations.RemoveField(
            model_name="qrsesion",
            name="usado",
        ),
    ]
