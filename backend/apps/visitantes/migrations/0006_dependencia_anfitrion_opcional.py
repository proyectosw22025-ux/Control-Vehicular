"""
Reforma arquitectónica: el anfitrión deja de ser obligatorio.
Un visitante puede ir a una dependencia/oficina sin conocer a nadie específico.

Cambios:
  - NUEVA tabla dependencias_uagrm (unidades, facultades, oficinas)
  - Visita.anfitrion: PROTECT → SET_NULL nullable (FK ahora opcional)
  - Visita.dependencia: FK a DependenciaUAGRM (opcional)
  - Regla de negocio: anfitrion OR dependencia debe estar presente (validado en schema)
  - Seed: dependencias frecuentes de la UAGRM para que el guardia las encuentre al instante
"""
from django.db import migrations, models
import django.db.models.deletion

DEPENDENCIAS_SEED = [
    {"nombre": "Secretaría de Admisiones e Inscripciones",  "codigo": "SAI",  "descripcion": "Trámites de inscripción, requisitos de ingreso y consultas sobre carreras.",      "ubicacion": "Rectorado — planta baja"},
    {"nombre": "Biblioteca Central UAGRM",                  "codigo": "BIB",  "descripcion": "Consulta bibliográfica, préstamo de libros y salas de estudio.",                  "ubicacion": "Campus central — edificio biblioteca"},
    {"nombre": "Comedor Universitario",                     "codigo": "COM",  "descripcion": "Servicio de alimentación para la comunidad universitaria.",                        "ubicacion": "Campus central — área gastronómica"},
    {"nombre": "Dirección de Bienestar Estudiantil (DUB)",  "codigo": "DUB",  "descripcion": "Apoyo estudiantil, becas, orientación psicológica y servicios sociales.",         "ubicacion": "Edificio DUB"},
    {"nombre": "Rectorado",                                 "codigo": "REC",  "descripcion": "Autoridades máximas de la universidad. Visitas oficiales y administrativas.",      "ubicacion": "Edificio Rectorado"},
    {"nombre": "Almacén / Proveeduría Central",             "codigo": "ALM",  "descripcion": "Recepción de insumos, materiales y proveedores. Requiere vehículo en muchos casos.", "ubicacion": "Zona de carga — sector norte"},
    {"nombre": "Facultad de Ciencias Exactas y Tecnología", "codigo": "FCET", "descripcion": "Ingeniería, Sistemas, Ciencias y carreras técnicas.",                             "ubicacion": "Módulos 200"},
    {"nombre": "Facultad de Ciencias Económicas",           "codigo": "FCE",  "descripcion": "Administración, Contabilidad, Economía y Auditoría.",                             "ubicacion": "Módulos 250"},
    {"nombre": "Facultad de Humanidades",                   "codigo": "FH",   "descripcion": "Derecho, Comunicación Social, Ciencias Políticas.",                                "ubicacion": "Módulos 260"},
    {"nombre": "Facultad de Ciencias de la Salud",          "codigo": "FCS",  "descripcion": "Medicina, Odontología, Enfermería y Farmacia.",                                    "ubicacion": "Campus Salud"},
    {"nombre": "Facultad de Ciencias Agrícolas",            "codigo": "FCA",  "descripcion": "Agronomía, Veterinaria y Zootecnia.",                                              "ubicacion": "Campus Agropecuario"},
    {"nombre": "Departamento de TI / Sistemas UAGRM",       "codigo": "TI",   "descripcion": "Soporte técnico, infraestructura informática y servicios digitales.",              "ubicacion": "Edificio central — piso 2"},
    {"nombre": "Recursos Humanos",                          "codigo": "RH",   "descripcion": "Trámites laborales, contratos, planillas y entrevistas de trabajo.",               "ubicacion": "Rectorado — piso 1"},
    {"nombre": "Estadio Universitario",                     "codigo": "EST",  "descripcion": "Eventos deportivos, actos académicos y actividades culturales masivas.",           "ubicacion": "Estadio universitario"},
    {"nombre": "Consulta General / Sin destino específico", "codigo": "GEN",  "descripcion": "Visitas de exploración, consultas informales o sin departamento definido.",        "ubicacion": "Portería principal"},
]


def seed_dependencias(apps, schema_editor):
    Dependencia = apps.get_model("visitantes", "DependenciaUAGRM")
    for d in DEPENDENCIAS_SEED:
        Dependencia.objects.get_or_create(codigo=d["codigo"], defaults=d)


class Migration(migrations.Migration):

    dependencies = [
        ("visitantes", "0005_control_salida"),
    ]

    operations = [
        # 1. Crear tabla DependenciaUAGRM
        migrations.CreateModel(
            name="DependenciaUAGRM",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False)),
                ("nombre", models.CharField(max_length=120, unique=True)),
                ("codigo", models.CharField(max_length=10, unique=True, help_text="Código corto para búsqueda rápida.")),
                ("descripcion", models.TextField(blank=True)),
                ("ubicacion", models.CharField(max_length=120, blank=True, help_text="Referencia física en el campus.")),
                ("activo", models.BooleanField(default=True)),
            ],
            options={"db_table": "dependencias_uagrm", "ordering": ["nombre"]},
        ),
        # 2. Anfitrion → nullable
        migrations.AlterField(
            model_name="visita",
            name="anfitrion",
            field=models.ForeignKey(
                to="usuarios.Usuario",
                on_delete=django.db.models.deletion.SET_NULL,
                null=True,
                blank=True,
                related_name="visitas_como_anfitrion",
            ),
        ),
        # 3. FK dependencia en Visita
        migrations.AddField(
            model_name="visita",
            name="dependencia",
            field=models.ForeignKey(
                to="visitantes.DependenciaUAGRM",
                on_delete=django.db.models.deletion.SET_NULL,
                null=True,
                blank=True,
                related_name="visitas",
                help_text="Dependencia visitada cuando no hay anfitrión específico.",
            ),
        ),
        # 4. Seed dependencias
        migrations.RunPython(seed_dependencias, reverse_code=migrations.RunPython.noop),
    ]
