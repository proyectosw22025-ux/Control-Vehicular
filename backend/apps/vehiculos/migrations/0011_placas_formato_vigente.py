# Reconvierte placas del formato anterior (letras+dígitos, "ABC-1234") al
# formato boliviano VIGENTE (3-4 números + 3 letras, "1234-ABC").
#
# Contexto: una versión previa canonicalizó al revés (letras primero). El
# formato real de Bolivia (unificación 2016) es dígitos primero. Esta migración
# corrige los datos existentes que sigan el patrón viejo invirtiendo los grupos.
#
# Seguridad:
#   - Solo toca placas que matcheen exactamente el patrón viejo "LLL-NNNN"
#     (2-3 letras + 3-4 dígitos). El resto se deja intacto.
#   - Si la inversión colisiona con otra placa ya existente, se omite (para
#     resolución manual) en vez de fusionar identidades.
import re

from django.db import migrations

VIEJO_RE = re.compile(r"^([A-Z]{2,3})-?(\d{3,4})$")


def a_formato_vigente(apps, schema_editor):
    Vehiculo = apps.get_model("vehiculos", "Vehiculo")
    for v in Vehiculo.objects.order_by("pk"):
        comparable = re.sub(r"[^A-Z0-9]", "", (v.placa or "").upper())
        m = VIEJO_RE.match(comparable)
        if not m:
            continue  # ya está en formato nuevo o es legacy no estándar
        letras, numeros = m.group(1), m.group(2)
        if len(letras) != 3:
            continue  # el formato vigente exige exactamente 3 letras
        nueva = f"{numeros}-{letras}"
        if Vehiculo.objects.filter(placa=nueva).exclude(pk=v.pk).exists():
            continue  # colisión — no fusionar, dejar para revisión manual
        v.placa = nueva
        v.save(update_fields=["placa"])


class Migration(migrations.Migration):

    dependencies = [
        ('vehiculos', '0010_canonicalizar_placas'),
    ]

    operations = [
        migrations.RunPython(a_formato_vigente, migrations.RunPython.noop),
    ]
