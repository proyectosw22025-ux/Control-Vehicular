# Canonicaliza las placas existentes al formato boliviano "ABC-1234".
#
# Contexto: el registro de vehículos nunca validó ni normalizó la placa, así
# que la BD acumuló formatos mixtos ("ZYX123", "ABC-1234", "abc 123"...). El
# lookup del control de acceso ya es tolerante a separadores, pero la forma
# almacenada debe ser única y predecible para reportes, OCR y unicidad.
#
# Seguridad de la migración:
#   - Solo convierte placas que cumplen el patrón boliviano; las que no
#     (datos legacy como "SCZ" sin números o "CR71000" de 5 dígitos) se dejan
#     intactas — el lookup tolerante las sigue encontrando.
#   - Si dos vehículos colisionan en la misma forma comparable (duplicados
#     físicos preexistentes), NO se fusionan ni renombran: se conserva el más
#     antiguo y el resto queda como está, para resolución manual del admin.
import re

from django.db import migrations

PLACA_CANONICA_RE = re.compile(r"^([A-Z]{2,3})(\d{3,4})([A-Z]?)$")


def canonicalizar(apps, schema_editor):
    Vehiculo = apps.get_model("vehiculos", "Vehiculo")
    comparables_vistos = set()
    for v in Vehiculo.objects.order_by("pk"):
        comparable = re.sub(r"[^A-Z0-9]", "", (v.placa or "").upper())
        if not comparable or comparable in comparables_vistos:
            continue  # duplicado físico preexistente — no tocar
        comparables_vistos.add(comparable)
        m = PLACA_CANONICA_RE.match(comparable)
        if not m:
            continue  # formato legacy no estándar — se deja intacto
        canonica = f"{m.group(1)}-{m.group(2)}{m.group(3)}"
        if canonica != v.placa and not Vehiculo.objects.filter(placa=canonica).exclude(pk=v.pk).exists():
            v.placa = canonica
            v.save(update_fields=["placa"])


class Migration(migrations.Migration):

    dependencies = [
        ('vehiculos', '0009_alter_vehiculoestadohistorial_fecha'),
    ]

    operations = [
        migrations.RunPython(canonicalizar, migrations.RunPython.noop),
    ]
