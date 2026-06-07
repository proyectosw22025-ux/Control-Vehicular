import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('multas', '0004_rename_a_infraccion'),
    ]

    operations = [
        migrations.AddField(
            model_name='tipoinfraccion',
            name='gravedad',
            field=models.CharField(choices=[('leve', 'Leve'), ('moderada', 'Moderada'), ('grave', 'Grave')], default='moderada', max_length=10),
        ),
        migrations.AddField(
            model_name='tipoinfraccion',
            name='tipo_sancion_sugerido',
            field=models.CharField(choices=[('amonestacion', 'Amonestación'), ('multa_economica', 'Multa económica'), ('suspension_acceso', 'Suspensión de acceso'), ('reporte_bienestar', 'Reporte a Bienestar Estudiantil')], default='multa_economica', help_text='Sanción que se genera por defecto al registrar una infracción de este tipo', max_length=20),
        ),
        migrations.AlterField(
            model_name='tipoinfraccion',
            name='monto_base',
            field=models.DecimalField(blank=True, decimal_places=2, help_text='Monto sugerido cuando la sanción asociada es una multa económica', max_digits=8, null=True),
        ),

        migrations.CreateModel(
            name='Sancion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('tipo_sancion', models.CharField(choices=[('amonestacion', 'Amonestación'), ('multa_economica', 'Multa económica'), ('suspension_acceso', 'Suspensión de acceso'), ('reporte_bienestar', 'Reporte a Bienestar Estudiantil')], max_length=20)),
                ('monto', models.DecimalField(blank=True, decimal_places=2, help_text="Solo aplica cuando tipo_sancion es 'multa_economica'", max_digits=8, null=True)),
                ('estado', models.CharField(choices=[('pendiente', 'Pendiente'), ('en_revision', 'Comprobante en revisión'), ('cumplida', 'Cumplida'), ('cancelada', 'Cancelada')], default='pendiente', max_length=12)),
                ('fecha', models.DateTimeField(auto_now_add=True)),
                ('infraccion', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='sancion', to='multas.infraccion')),
            ],
            options={
                'verbose_name': 'Sanción',
                'verbose_name_plural': 'Sanciones',
                'db_table': 'sanciones',
                'ordering': ['-fecha'],
            },
        ),

        # Campo temporal nullable — se completa en la migración de datos 0006
        # y se finaliza (rename + not-null) en 0007.
        migrations.AddField(
            model_name='pagosancion',
            name='sancion_nueva',
            field=models.OneToOneField(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='pago_temp', to='multas.sancion'),
        ),

        migrations.RenameField(model_name='apelacioninfraccion', old_name='multa', new_name='infraccion'),
    ]
