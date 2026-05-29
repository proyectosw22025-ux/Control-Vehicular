"""
Siembra coordenadas GPS verificadas en OSM (Overpass API, Way 165843591) en los
PuntoAcceso existentes. Busca por nombre exacto; si no existe, crea los registros.
Coordenadas fuente: barrier=gate nodes en el perímetro del campus UAGRM.
"""
from django.db import migrations

PORTERIAS = [
    {
        "nombre":   "Portería Este",
        "ubicacion": "Acceso este del campus — Av. Roca y Coronado",
        "latitud":  -17.77765,
        "longitud": -63.19344,
    },
    {
        "nombre":   "Portería Sur Central",
        "ubicacion": "Acceso sur-central del campus",
        "latitud":  -17.77901,
        "longitud": -63.19481,
    },
    {
        "nombre":   "Portería Av. Busch",
        "ubicacion": "Acceso principal — Avenida Busch",
        "latitud":  -17.77877,
        "longitud": -63.19660,
    },
]


def sembrar_porterias(apps, schema_editor):
    PuntoAcceso = apps.get_model("acceso", "PuntoAcceso")
    for datos in PORTERIAS:
        obj, created = PuntoAcceso.objects.get_or_create(
            nombre=datos["nombre"],
            defaults={
                "ubicacion": datos["ubicacion"],
                "tipo":      "ambos",
                "activo":    True,
                "latitud":   datos["latitud"],
                "longitud":  datos["longitud"],
            },
        )
        if not created:
            # Actualizar coords en registros existentes que aún no las tengan
            if obj.latitud is None:
                obj.latitud  = datos["latitud"]
                obj.longitud = datos["longitud"]
                obj.ubicacion = datos["ubicacion"]
                obj.save(update_fields=["latitud", "longitud", "ubicacion"])


def revertir(apps, schema_editor):
    pass  # No eliminar — los registros pueden tener accesos asociados


class Migration(migrations.Migration):

    dependencies = [
        ('acceso', '0008_puntoacceso_coords'),
    ]

    operations = [
        migrations.RunPython(sembrar_porterias, revertir),
    ]
