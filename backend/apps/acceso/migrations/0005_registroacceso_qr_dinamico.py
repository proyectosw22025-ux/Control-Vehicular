from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("acceso", "0004_auditlog"),
    ]

    operations = [
        migrations.AlterField(
            model_name="registroacceso",
            name="metodo_acceso",
            field=models.CharField(
                choices=[
                    ("qr_dinamico",  "QR dinámico TOTP (seguro, caduca cada 30s)"),
                    ("qr_permanente","QR permanente del vehículo (legacy)"),
                    ("qr_delegacion","QR de delegación"),
                    ("pase_temporal","Pase temporal"),
                    ("manual",       "Ingreso manual por guardia"),
                ],
                default="qr_dinamico",
                max_length=15,
            ),
        ),
    ]
