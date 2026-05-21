from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("acceso",    "0006_alerta_acceso"),
        ("vehiculos", "0008_vehiculo_estado_historial"),
    ]

    operations = [
        migrations.CreateModel(
            name="UbicacionVehiculo",
            fields=[
                ("id",        models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ("latitud",   models.DecimalField(decimal_places=8, max_digits=12)),
                ("longitud",  models.DecimalField(decimal_places=8, max_digits=12)),
                ("velocidad", models.FloatField(default=0.0)),
                ("timestamp", models.DateTimeField(auto_now=True)),
                ("activo",    models.BooleanField(default=True)),
                (
                    "vehiculo",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ubicacion_actual",
                        to="vehiculos.vehiculo",
                    ),
                ),
            ],
            options={"db_table": "ubicaciones_vehiculo", "ordering": ["-timestamp"]},
        ),
    ]
