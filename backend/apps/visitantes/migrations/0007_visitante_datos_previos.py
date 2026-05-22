"""
Datos que el visitante puede pre-cargar desde /register antes de llegar al campus.
Permiten al guardia procesar su entrada en ~30 segundos en lugar de 3-5 minutos.

  - Visitante.placa_habitual: placa de su vehículo (moto, auto, etc.)
  - Visitante.destino_sugerido_texto: texto libre ("Secretaría de Admisiones", etc.)

Se usa texto libre en destino (no FK) porque la página de pre-registro es pública
y no requiere autenticación — cargar la lista de dependencias sin auth es viable,
pero text libre es más simple y cumple el objetivo sin acoplar el modelo externo.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("visitantes", "0006_dependencia_anfitrion_opcional"),
    ]

    operations = [
        migrations.AddField(
            model_name="visitante",
            name="placa_habitual",
            field=models.CharField(
                max_length=20,
                blank=True,
                default="",
                help_text="Placa del vehículo con el que suele venir al campus. Pre-llenada por el visitante.",
            ),
        ),
        migrations.AddField(
            model_name="visitante",
            name="destino_sugerido_texto",
            field=models.CharField(
                max_length=120,
                blank=True,
                default="",
                help_text="Destino que el visitante indicó al pre-registrarse (texto libre). Referencial para el guardia.",
            ),
        ),
    ]
