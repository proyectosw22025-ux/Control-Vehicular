from django.db import migrations

# Mapea el estado combinado de la antigua "Multa" (hecho + consecuencia económica
# fusionados) hacia el nuevo par (Infraccion.estado, Sancion.estado), donde cada
# entidad representa solo una mitad del concepto original.
MAPEO_ESTADOS = {
    "pendiente":   ("registrada", "pendiente"),
    "en_revision": ("registrada", "en_revision"),
    "pagada":      ("confirmada", "cumplida"),
    "apelada":     ("apelada",    "pendiente"),
    "cancelada":   ("anulada",    "cancelada"),
}


def migrar_a_sancion(apps, schema_editor):
    Infraccion = apps.get_model("multas", "Infraccion")
    Sancion = apps.get_model("multas", "Sancion")
    PagoSancion = apps.get_model("multas", "PagoSancion")

    for infraccion in Infraccion.objects.all():
        estado_infraccion, estado_sancion = MAPEO_ESTADOS.get(
            infraccion.estado, ("registrada", "pendiente")
        )
        sancion = Sancion.objects.create(
            infraccion=infraccion,
            tipo_sancion="multa_economica",
            monto=infraccion.monto,
            estado=estado_sancion,
            fecha=infraccion.fecha,
        )
        infraccion.estado = estado_infraccion
        infraccion.save(update_fields=["estado"])

        # En este punto de la historia de migraciones, el campo FK de PagoSancion
        # todavía se llama "multa" (apunta a Infraccion — el modelo fue renombrado
        # en 0004 pero el campo no). Se renombra a "sancion" recién en 0007.
        pago = PagoSancion.objects.filter(multa_id=infraccion.id).first()
        if pago is not None:
            pago.sancion_nueva = sancion
            pago.save(update_fields=["sancion_nueva"])


def revertir(apps, schema_editor):
    Sancion = apps.get_model("multas", "Sancion")
    Sancion.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('multas', '0005_crear_sancion'),
    ]

    operations = [
        migrations.RunPython(migrar_a_sancion, revertir),
    ]
