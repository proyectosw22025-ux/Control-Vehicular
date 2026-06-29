from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('acceso', '0011_vehiculo_temporal'),
        # DependenciaUAGRM se crea en visitantes/0006; sin esta dependencia, en
        # una base nueva esta migración corre antes y la FK no resuelve.
        ('visitantes', '0006_dependencia_anfitrion_opcional'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AutorizacionAccesoExterno',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ('placa',           models.CharField(max_length=15)),
                ('empresa',         models.CharField(max_length=150)),
                ('motivo',          models.CharField(max_length=250)),
                ('email_proveedor', models.CharField(blank=True, max_length=254)),
                ('valido_desde',    models.DateTimeField()),
                ('valido_hasta',    models.DateTimeField()),
                ('codigo_acceso',   models.CharField(max_length=24, unique=True)),
                ('activo',          models.BooleanField(default=True)),
                ('usado',           models.BooleanField(default=False)),
                ('email_enviado',   models.BooleanField(default=False)),
                ('fecha_creacion',  models.DateTimeField(auto_now_add=True)),
                ('observacion',     models.TextField(blank=True)),
                ('dependencia', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='autorizaciones_externas',
                    to='visitantes.dependenciauagrm',
                )),
                ('autorizado_por', models.ForeignKey(
                    on_delete=django.db.models.deletion.PROTECT,
                    related_name='autorizaciones_externas_emitidas',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'Autorización de acceso externo',
                'db_table': 'autorizaciones_acceso_externo',
                'ordering': ['-fecha_creacion'],
            },
        ),
    ]
