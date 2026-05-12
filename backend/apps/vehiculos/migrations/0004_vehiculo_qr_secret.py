from django.db import migrations, models
import secrets


def asignar_qr_secret(apps, schema_editor):
    """Asigna un secreto único a cada vehículo existente."""
    Vehiculo = apps.get_model("vehiculos", "Vehiculo")
    for v in Vehiculo.objects.all():
        if not v.qr_secret:
            v.qr_secret = secrets.token_hex(32)
            v.save(update_fields=["qr_secret"])


class Migration(migrations.Migration):

    dependencies = [
        ("vehiculos", "0003_add_pendiente_estado"),
    ]

    operations = [
        migrations.AddField(
            model_name="vehiculo",
            name="qr_secret",
            field=models.CharField(
                max_length=64,
                blank=True,
                help_text="Clave secreta para generar QR dinámico TOTP. Nunca se expone al cliente.",
            ),
        ),
        migrations.RunPython(asignar_qr_secret, migrations.RunPython.noop),
    ]
