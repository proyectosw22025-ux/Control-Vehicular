from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("acceso", "0013_qrsesion_delegacion_tipo"),
    ]

    operations = [
        migrations.AddField(
            model_name="qrsesion",
            name="tipo_destinatario",
            field=models.CharField(
                max_length=12,
                choices=[("externo", "Persona externa"), ("registrado", "Miembro UAGRM")],
                default="externo",
                help_text="Si es miembro UAGRM o persona externa (familiar, etc.)",
            ),
        ),
        migrations.AddField(
            model_name="qrsesion",
            name="destinatario_nombre",
            field=models.CharField(
                max_length=150,
                blank=True,
                default="",
                help_text="Nombre completo de quien puede usar este QR.",
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="qrsesion",
            name="destinatario_ci",
            field=models.CharField(
                max_length=20,
                blank=True,
                default="",
                help_text="CI/carnet del destinatario para verificación en portería.",
            ),
            preserve_default=False,
        ),
    ]
