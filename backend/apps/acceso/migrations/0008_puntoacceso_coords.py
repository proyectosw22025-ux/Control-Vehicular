from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('acceso', '0007_ubicacion_vehiculo'),
    ]

    operations = [
        migrations.AddField(
            model_name='puntoacceso',
            name='latitud',
            field=models.DecimalField(blank=True, decimal_places=8, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name='puntoacceso',
            name='longitud',
            field=models.DecimalField(blank=True, decimal_places=8, max_digits=12, null=True),
        ),
    ]
