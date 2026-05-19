from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def crear_historial_retroactivo(apps, schema_editor):
    """Crea un registro inicial por cada vehículo existente."""
    Vehiculo = apps.get_model("vehiculos", "Vehiculo")
    VehiculoEstadoHistorial = apps.get_model("vehiculos", "VehiculoEstadoHistorial")
    historiales = [
        VehiculoEstadoHistorial(
            vehiculo=v,
            estado_anterior="",
            estado_nuevo=v.estado,
            motivo="Estado inicial (retroactivo)",
            usuario=None,
            fecha=v.created_at,
        )
        for v in Vehiculo.objects.all()
    ]
    VehiculoEstadoHistorial.objects.bulk_create(historiales)


class Migration(migrations.Migration):

    dependencies = [
        ("vehiculos", "0007_vehiculos_indexes"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="VehiculoEstadoHistorial",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("estado_anterior", models.CharField(blank=True, max_length=15)),
                ("estado_nuevo", models.CharField(max_length=15)),
                ("motivo", models.TextField(blank=True)),
                ("fecha", models.DateTimeField(default=None, null=True)),
                (
                    "vehiculo",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="historial_estados",
                        to="vehiculos.vehiculo",
                    ),
                ),
                (
                    "usuario",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cambios_estado_vehiculo",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Historial de estado",
                "verbose_name_plural": "Historial de estados",
                "db_table": "vehiculo_estado_historial",
                "ordering": ["-fecha"],
            },
        ),
        migrations.RunPython(crear_historial_retroactivo, migrations.RunPython.noop),
    ]
