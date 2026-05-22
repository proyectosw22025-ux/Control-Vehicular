"""
Añade campos para control más estricto de visitantes:
  - Visitante.procedencia: ciudad/empresa/institución de donde viene
  - Visita.num_acompanantes: cuántas personas adicionales ingresan con el visitante
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("visitantes", "0003_seed_tipos_visita"),
    ]

    operations = [
        migrations.AddField(
            model_name="visitante",
            name="procedencia",
            field=models.CharField(
                max_length=120,
                blank=True,
                default="",
                help_text="Ciudad, empresa o institución de procedencia del visitante.",
            ),
        ),
        migrations.AddField(
            model_name="visita",
            name="num_acompanantes",
            field=models.PositiveSmallIntegerField(
                default=0,
                help_text="Número de personas adicionales que ingresan junto al visitante registrado.",
            ),
        ),
    ]
