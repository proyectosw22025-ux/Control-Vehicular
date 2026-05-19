from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vehiculos", "0005_alter_vehiculo_codigo_qr_alter_vehiculo_qr_secret"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehiculo",
            name="numero_motor",
            field=models.CharField(blank=True, max_length=30),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="numero_chasis",
            field=models.CharField(blank=True, max_length=30),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="num_puertas",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="cilindrada",
            field=models.CharField(blank=True, max_length=10),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="color_hex",
            field=models.CharField(blank=True, max_length=7),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="foto_vehiculo",
            field=models.URLField(blank=True),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="numero_soat",
            field=models.CharField(blank=True, max_length=30),
        ),
        migrations.AddField(
            model_name="vehiculo",
            name="capacidad_carga",
            field=models.CharField(blank=True, max_length=20),
        ),
    ]
