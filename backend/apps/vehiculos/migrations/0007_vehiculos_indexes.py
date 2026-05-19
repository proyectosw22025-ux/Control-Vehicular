from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vehiculos", "0006_vehiculo_campos_extendidos"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="vehiculo",
            index=models.Index(fields=["estado"], name="vehiculos_estado_idx"),
        ),
        migrations.AddIndex(
            model_name="vehiculo",
            index=models.Index(fields=["created_at"], name="vehiculos_created_at_idx"),
        ),
    ]
