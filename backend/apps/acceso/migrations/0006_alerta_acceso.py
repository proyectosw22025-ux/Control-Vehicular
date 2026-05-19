from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("acceso", "0005_registroacceso_qr_dinamico"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("vehiculos", "0008_vehiculo_estado_historial"),
    ]

    operations = [
        migrations.CreateModel(
            name="AlertaAcceso",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tipo_anomalia", models.CharField(
                    choices=[
                        ("frecuencia_excesiva", "Frecuencia excesiva de accesos"),
                        ("horario_inusual", "Acceso fuera de horario habitual"),
                        ("punto_inusual", "Punto de acceso inusual"),
                        ("vehiculo_sancionado", "Vehículo sancionado con acceso reciente"),
                        ("placas_similares", "Placas similares (posible clonación)"),
                    ],
                    max_length=25,
                )),
                ("severidad", models.CharField(
                    choices=[("info", "Informativa"), ("advertencia", "Advertencia"), ("critica", "Crítica")],
                    default="advertencia",
                    max_length=12,
                )),
                ("descripcion", models.TextField()),
                ("fecha", models.DateTimeField(auto_now_add=True)),
                ("fecha_analisis", models.DateField()),
                ("revisada", models.BooleanField(default=False)),
                ("fecha_revision", models.DateTimeField(blank=True, null=True)),
                ("datos_extra", models.JSONField(default=dict)),
                (
                    "vehiculo",
                    models.ForeignKey(
                        blank=True, null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="alertas_acceso",
                        to="vehiculos.vehiculo",
                    ),
                ),
                (
                    "revisada_por",
                    models.ForeignKey(
                        blank=True, null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="alertas_revisadas",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "alertas_acceso",
                "ordering": ["-fecha"],
                "indexes": [models.Index(fields=["revisada", "fecha_analisis"], name="alertas_acc_revisada_idx")],
            },
        ),
    ]
