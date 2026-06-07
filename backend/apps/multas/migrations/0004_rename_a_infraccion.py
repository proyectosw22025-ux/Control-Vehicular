from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('multas', '0003_pago_en_revision_comprobante_url'),
    ]

    operations = [
        migrations.RenameModel(old_name='TipoMulta', new_name='TipoInfraccion'),
        migrations.AlterModelTable(name='tipoinfraccion', table='tipos_infraccion'),
        migrations.AlterModelOptions(
            name='tipoinfraccion',
            options={'verbose_name': 'Tipo de infracción', 'verbose_name_plural': 'Tipos de infracción'},
        ),

        migrations.RenameModel(old_name='Multa', new_name='Infraccion'),
        migrations.AlterModelTable(name='infraccion', table='infracciones'),
        migrations.AlterModelOptions(
            name='infraccion',
            options={'ordering': ['-fecha'], 'verbose_name': 'Infracción', 'verbose_name_plural': 'Infracciones'},
        ),
        migrations.RenameModel(old_name='PagoMulta', new_name='PagoSancion'),
        migrations.AlterModelTable(name='pagosancion', table='pagos_sancion'),
        migrations.AlterModelOptions(
            name='pagosancion',
            options={'verbose_name': 'Pago de sanción', 'verbose_name_plural': 'Pagos de sanción'},
        ),

        migrations.RenameModel(old_name='ApelacionMulta', new_name='ApelacionInfraccion'),
        migrations.AlterModelTable(name='apelacioninfraccion', table='apelaciones_infraccion'),
        migrations.AlterModelOptions(
            name='apelacioninfraccion',
            options={'ordering': ['-fecha'], 'verbose_name': 'Apelación de infracción', 'verbose_name_plural': 'Apelaciones de infracción'},
        ),
    ]
