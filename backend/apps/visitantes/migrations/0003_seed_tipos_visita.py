"""
Migración de datos: carga tipos de visita predeterminados para la UAGRM.
Usa get_or_create para ser idempotente (segura si se ejecuta más de una vez).
"""
from django.db import migrations


TIPOS = [
    {
        "nombre": "Académica",
        "descripcion": "Reunión con docente, consulta académica, asesoría de tesis o trámite estudiantil.",
        "requiere_vehiculo": False,
    },
    {
        "nombre": "Proveedora / Proveedor",
        "descripcion": "Ingreso de empresa o persona para entrega de bienes, insumos o servicios a la UAGRM.",
        "requiere_vehiculo": True,
    },
    {
        "nombre": "Familiar",
        "descripcion": "Familiar de un miembro de la comunidad universitaria (docente, estudiante, administrativo).",
        "requiere_vehiculo": False,
    },
    {
        "nombre": "Laboral / Administrativa",
        "descripcion": "Gestión laboral, entrevista, trámite de contratación o visita a unidad administrativa.",
        "requiere_vehiculo": False,
    },
    {
        "nombre": "Trámite Oficial",
        "descripcion": "Trámite en oficinas UAGRM: inscripciones, certificados, legalizaciones, registros.",
        "requiere_vehiculo": False,
    },
    {
        "nombre": "Evento / Acto Académico",
        "descripcion": "Asistente a conferencia, congreso, graduación, acto deportivo o cultural en el campus.",
        "requiere_vehiculo": False,
    },
    {
        "nombre": "Autoridad Externa",
        "descripcion": "Autoridad gubernamental, municipal, consular o institucional en visita oficial.",
        "requiere_vehiculo": True,
    },
    {
        "nombre": "Emergencia",
        "descripcion": "Ingreso urgente por emergencia médica, familiar u otra situación que requiere acceso inmediato.",
        "requiere_vehiculo": False,
    },
]


def seed_tipos(apps, schema_editor):
    TipoVisita = apps.get_model("visitantes", "TipoVisita")
    for t in TIPOS:
        TipoVisita.objects.get_or_create(
            nombre=t["nombre"],
            defaults={
                "descripcion": t["descripcion"],
                "requiere_vehiculo": t["requiere_vehiculo"],
            },
        )


def deseed_tipos(apps, schema_editor):
    TipoVisita = apps.get_model("visitantes", "TipoVisita")
    nombres = [t["nombre"] for t in TIPOS]
    TipoVisita.objects.filter(nombre__in=nombres).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("visitantes", "0002_agrega_placa_vehiculo_visitante"),
    ]

    operations = [
        migrations.RunPython(seed_tipos, reverse_code=deseed_tipos),
    ]
