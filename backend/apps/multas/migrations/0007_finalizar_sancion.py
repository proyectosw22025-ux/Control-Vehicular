import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('multas', '0006_migrar_datos_a_sancion'),
    ]

    operations = [
        # Quitar la antigua FK de PagoSancion hacia Infraccion (ya migrada a sancion_nueva)
        migrations.RemoveField(model_name='pagosancion', name='multa'),
        migrations.RenameField(model_name='pagosancion', old_name='sancion_nueva', new_name='sancion'),
        migrations.AlterField(
            model_name='pagosancion',
            name='sancion',
            field=models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='pago', to='multas.sancion'),
        ),

        # RenameModel (0004) no actualiza los related_name heredados del modelo viejo
        migrations.AlterField(
            model_name='infraccion',
            name='tipo',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='infracciones', to='multas.tipoinfraccion'),
        ),
        migrations.AlterField(
            model_name='infraccion',
            name='vehiculo',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='infracciones', to='vehiculos.vehiculo'),
        ),
        migrations.AlterField(
            model_name='pagosancion',
            name='registrado_por',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='pagos_sancion_registrados', to=settings.AUTH_USER_MODEL),
        ),

        # El monto y los estados de pago ahora viven en Sancion, no en Infraccion
        migrations.RemoveField(model_name='infraccion', name='monto'),
        migrations.AlterField(
            model_name='infraccion',
            name='estado',
            field=models.CharField(choices=[('registrada', 'Registrada'), ('apelada', 'En apelación'), ('confirmada', 'Confirmada'), ('anulada', 'Anulada')], default='registrada', max_length=12),
        ),
        migrations.AlterField(
            model_name='infraccion',
            name='evidencia',
            field=models.ImageField(blank=True, null=True, upload_to='infracciones/evidencias/'),
        ),
        migrations.AlterField(
            model_name='infraccion',
            name='registrado_por',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='infracciones_registradas', to=settings.AUTH_USER_MODEL),
        ),
    ]
