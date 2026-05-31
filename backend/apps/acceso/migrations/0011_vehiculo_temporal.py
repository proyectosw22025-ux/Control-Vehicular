from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('acceso', '0010_coords_puntos_existentes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='VehiculoTemporal',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('placa', models.CharField(max_length=15)),
                ('tipo', models.CharField(
                    choices=[
                        ('proveedor',     'Proveedor / Entrega'),
                        ('mantenimiento', 'Servicio de Mantenimiento'),
                        ('emergencia',    'Emergencia / Ambulancia'),
                        ('visitante',     'Visitante sin pre-registro'),
                        ('otro',          'Otro'),
                    ],
                    default='visitante', max_length=15,
                )),
                ('destino', models.CharField(max_length=150)),
                ('responsable', models.CharField(blank=True, max_length=100)),
                ('hora_ingreso', models.DateTimeField(auto_now_add=True)),
                ('hora_limite', models.DateTimeField()),
                ('hora_salida', models.DateTimeField(blank=True, null=True)),
                ('activo', models.BooleanField(default=True)),
                ('observacion', models.TextField(blank=True)),
                ('registrado_por', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='vehiculos_temporales_registrados',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Vehículo temporal',
                'db_table': 'vehiculos_temporales',
                'ordering': ['-hora_ingreso'],
            },
        ),
        # Agregar 'temporal' a los metodos de RegistroAcceso
        # (solo documentación — CharField choices no genera DDL)
    ]
