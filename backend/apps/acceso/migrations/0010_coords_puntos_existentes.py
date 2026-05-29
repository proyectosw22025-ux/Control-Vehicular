"""
Asigna coordenadas GPS verificadas en OSM a los 6 puntos de acceso
existentes (IDs 1-6) usando los nodos barrier=gate del perímetro
real del campus UAGRM (Way 165843591).

Fuente: Overpass API — barrier=gate dentro del bbox del campus
        south=-17.7798, north=-17.7748, west=-63.1936, east=-63.1899

Nodos utilizados:
  4123941795  (-17.7762342, -63.1925265)  access:private, motor_vehicle:yes  — Norte
  4138749231  (-17.7768874, -63.1927209)  access:private, motor_vehicle:yes  — Norte-Oeste
  5796668028  (-17.7780971, -63.1930738)  access:private                     — Oeste-Centro
  3155745910  (-17.7796401, -63.1914776)  access:private, motor_vehicle:yes  — Sur
  4123941816  (-17.7778202, -63.1901222)  access:private, motor_vehicle:yes  — Este
"""
from django.db import migrations


# Coordenadas asignadas por posición geográfica y nombre del punto
ASIGNACIONES = [
    {
        "id": 1,
        "nombre_esperado": "Entrada Principal",
        "lat": -17.7780971,
        "lng": -63.1930738,
        "ubicacion": "Portería oeste-central del campus — acceso desde Calle Raúl Bascope",
    },
    {
        "id": 2,
        "nombre_esperado": "Entrada Principal Norte",
        "lat": -17.7762342,
        "lng": -63.1925265,
        "ubicacion": "Portería norte del campus — acceso desde Avenida Busch (motor_vehicle:yes)",
    },
    {
        "id": 3,
        "nombre_esperado": "Entrada Secundaria Sur",
        "lat": -17.7796401,
        "lng": -63.1914776,
        "ubicacion": "Portería sur del campus — acceso desde Av. Doctor Rómulo Herrera (motor_vehicle:yes)",
    },
    {
        "id": 4,
        "nombre_esperado": "Salida Principal Norte",
        "lat": -17.7768874,
        "lng": -63.1927209,
        "ubicacion": "Portería norte-oeste — salida hacia Avenida Busch (motor_vehicle:yes)",
    },
    {
        "id": 5,
        "nombre_esperado": "Salida Secundaria Sur",
        "lat": -17.7796401,
        "lng": -63.1914776,
        "ubicacion": "Portería sur — salida (misma ubicación física que Entrada Secundaria Sur)",
    },
    {
        "id": 6,
        "nombre_esperado": "Control Central",
        "lat": -17.7778202,
        "lng": -63.1901222,
        "ubicacion": "Portería este — control Av. 26 de Febrero / Av. Felipe Leonor Ribera (motor_vehicle:yes)",
    },
]


def asignar_coords(apps, schema_editor):
    PuntoAcceso = apps.get_model("acceso", "PuntoAcceso")
    for a in ASIGNACIONES:
        try:
            punto = PuntoAcceso.objects.get(pk=a["id"])
            if punto.latitud is None:
                punto.latitud  = a["lat"]
                punto.longitud = a["lng"]
                punto.ubicacion = a["ubicacion"]
                punto.save(update_fields=["latitud", "longitud", "ubicacion"])
        except PuntoAcceso.DoesNotExist:
            pass  # El registro no existe en esta instancia — se ignora


def revertir(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('acceso', '0009_seed_porterias_coords'),
    ]

    operations = [
        migrations.RunPython(asignar_coords, revertir),
    ]
