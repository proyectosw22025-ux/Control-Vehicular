"""
Comando: python manage.py seed_data
Pobla la base de datos con datos iniciales necesarios para operar el sistema.
Es idempotente: se puede ejecutar múltiples veces sin duplicar registros.
"""

from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Carga datos iniciales (roles, permisos, tipos, zonas, puntos de acceso)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Elimina datos existentes antes de insertar (solo datos de catálogo, NO usuarios ni vehículos)",
        )

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("\n=== SEED DATA — Sistema Vehicular UAGRM ===\n"))
        with transaction.atomic():
            self._seed_roles()
            self._seed_permisos()
            self._seed_permisos_por_rol()
            self._seed_tipos_vehiculo()
            self._seed_categorias_espacio()
            self._seed_zonas_y_espacios()
            self._seed_puntos_acceso()
            self._seed_tipos_multa()
            self._seed_tipos_visita()
            self._seed_tipos_notificacion()
            self._asignar_admin_a_superusers()
        self.stdout.write(self.style.SUCCESS("\n✓ Seed data completado exitosamente.\n"))

    # ──────────────────────────────────────────────
    # FASE 1 — ROLES
    # ──────────────────────────────────────────────
    def _seed_roles(self):
        from apps.usuarios.models import Rol
        self.stdout.write(self.style.HTTP_INFO("\n[1/10] Roles..."))
        roles = [
            ("Administrador",          "Control total del sistema. Accede a todos los módulos."),
            ("Guardia",                "Registra accesos vehiculares, emite multas, gestiona visitantes."),
            ("Estudiante",             "Gestiona sus vehículos y consulta su historial de accesos y multas."),
            ("Docente",                "Gestiona sus vehículos con privilegios de zona preferencial."),
            ("Personal Administrativo","Personal de la universidad. Gestiona sus vehículos."),
        ]
        for nombre, descripcion in roles:
            rol, created = Rol.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": descripcion, "is_active": True},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {nombre}")

    # ──────────────────────────────────────────────
    # FASE 2 — PERMISOS
    # ──────────────────────────────────────────────
    def _seed_permisos(self):
        from apps.usuarios.models import Permiso
        self.stdout.write(self.style.HTTP_INFO("\n[2/10] Permisos..."))
        permisos = [
            # (codigo, nombre, modulo)
            ("usuarios.ver",           "Ver usuarios",                        "usuarios"),
            ("usuarios.crear",         "Crear usuarios",                      "usuarios"),
            ("usuarios.editar",        "Editar usuarios",                     "usuarios"),
            ("usuarios.desactivar",    "Desactivar usuarios",                 "usuarios"),
            ("usuarios.roles",         "Asignar y remover roles",             "usuarios"),

            ("vehiculos.ver",          "Ver vehículos",                       "vehiculos"),
            ("vehiculos.registrar",    "Registrar vehículos",                 "vehiculos"),
            ("vehiculos.editar",       "Editar vehículos",                    "vehiculos"),
            ("vehiculos.documentos",   "Gestionar documentos de vehículo",    "vehiculos"),
            ("vehiculos.qr",           "Ver y regenerar QR de vehículo",      "vehiculos"),

            ("parqueos.ver",           "Ver zonas y espacios",                "parqueos"),
            ("parqueos.gestionar",     "Crear y editar zonas y espacios",     "parqueos"),
            ("parqueos.sesiones",      "Iniciar y cerrar sesiones",           "parqueos"),
            ("parqueos.historial",     "Ver historial de sesiones",           "parqueos"),

            ("acceso.ver",             "Ver registros de acceso",             "acceso"),
            ("acceso.registrar",       "Registrar entradas y salidas",        "acceso"),
            ("acceso.qr_delegacion",   "Generar QR de delegación",            "acceso"),
            ("acceso.pase_temporal",   "Crear pases temporales",              "acceso"),

            ("visitantes.ver",         "Ver visitantes y visitas",            "visitantes"),
            ("visitantes.registrar",   "Registrar visitantes y visitas",      "visitantes"),
            ("visitantes.gestionar",   "Iniciar y finalizar visitas",         "visitantes"),

            ("multas.ver",             "Ver multas propias",                  "multas"),
            ("multas.ver_todas",       "Ver todas las multas del sistema",    "multas"),
            ("multas.registrar",       "Registrar multas",                    "multas"),
            ("multas.pagar",           "Registrar pago de multas",            "multas"),
            ("multas.apelar",          "Apelar multas propias",               "multas"),
            ("multas.resolver",        "Resolver apelaciones",                "multas"),

            ("notificaciones.ver",     "Ver notificaciones propias",          "notificaciones"),
            ("notificaciones.enviar",  "Enviar notificaciones a usuarios",    "notificaciones"),

            ("reportes.ver",           "Ver reportes del sistema",            "reportes"),
            ("reportes.exportar",      "Exportar reportes a PDF/Excel",       "reportes"),
        ]
        for codigo, nombre, modulo in permisos:
            _, created = Permiso.objects.get_or_create(
                codigo=codigo,
                defaults={"nombre": nombre, "modulo": modulo, "descripcion": ""},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {codigo}")

    # ──────────────────────────────────────────────
    # FASE 3 — PERMISOS POR ROL
    # ──────────────────────────────────────────────
    def _seed_permisos_por_rol(self):
        from apps.usuarios.models import Rol, Permiso, RolPermiso
        self.stdout.write(self.style.HTTP_INFO("\n[3/10] Permisos por rol..."))

        mapa = {
            "Administrador": None,  # None = todos los permisos
            "Guardia": [
                "vehiculos.ver", "vehiculos.qr",
                "parqueos.ver", "parqueos.sesiones", "parqueos.historial",
                "acceso.ver", "acceso.registrar", "acceso.pase_temporal",
                "visitantes.ver", "visitantes.registrar", "visitantes.gestionar",
                "multas.ver_todas", "multas.registrar", "multas.pagar",
                "notificaciones.ver",
            ],
            "Estudiante": [
                "vehiculos.ver", "vehiculos.registrar", "vehiculos.editar",
                "vehiculos.documentos", "vehiculos.qr",
                "acceso.ver", "acceso.qr_delegacion",
                "multas.ver", "multas.apelar",
                "notificaciones.ver",
            ],
            "Docente": [
                "vehiculos.ver", "vehiculos.registrar", "vehiculos.editar",
                "vehiculos.documentos", "vehiculos.qr",
                "acceso.ver", "acceso.qr_delegacion",
                "multas.ver", "multas.apelar",
                "notificaciones.ver",
            ],
            "Personal Administrativo": [
                "vehiculos.ver", "vehiculos.registrar", "vehiculos.editar",
                "vehiculos.documentos", "vehiculos.qr",
                "acceso.ver", "acceso.qr_delegacion",
                "multas.ver", "multas.apelar",
                "notificaciones.ver",
            ],
        }

        todos_permisos = list(Permiso.objects.all())

        for nombre_rol, codigos in mapa.items():
            rol = Rol.objects.filter(nombre=nombre_rol).first()
            if not rol:
                self.stdout.write(self.style.WARNING(f"  AVISO: rol '{nombre_rol}' no existe, omitiendo."))
                continue

            permisos_a_asignar = todos_permisos if codigos is None else [
                p for p in todos_permisos if p.codigo in codigos
            ]
            creados = 0
            for permiso in permisos_a_asignar:
                _, created = RolPermiso.objects.get_or_create(rol=rol, permiso=permiso)
                if created:
                    creados += 1
            self.stdout.write(f"  → {nombre_rol}: {creados} permisos nuevos asignados")

    # ──────────────────────────────────────────────
    # FASE 4 — TIPOS DE VEHÍCULO
    # ──────────────────────────────────────────────
    def _seed_tipos_vehiculo(self):
        from apps.vehiculos.models import TipoVehiculo
        self.stdout.write(self.style.HTTP_INFO("\n[4/10] Tipos de vehículo..."))
        tipos = [
            ("Automóvil",    "Vehículo de pasajeros de 4 ruedas"),
            ("Motocicleta",  "Vehículo de 2 ruedas con motor"),
            ("Camioneta",    "Vehículo pick-up o SUV"),
            ("Minibús",      "Vehículo de transporte colectivo menor"),
            ("Bicicleta",    "Vehículo no motorizado de 2 ruedas"),
            ("Camión",       "Vehículo de carga pesada"),
        ]
        for nombre, descripcion in tipos:
            _, created = TipoVehiculo.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": descripcion},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {nombre}")

    # ──────────────────────────────────────────────
    # FASE 5 — CATEGORÍAS DE ESPACIO
    # ──────────────────────────────────────────────
    def _seed_categorias_espacio(self):
        from apps.parqueos.models import CategoriaEspacio
        self.stdout.write(self.style.HTTP_INFO("\n[5/10] Categorías de espacio de parqueo..."))
        categorias = [
            # (nombre, descripcion, es_discapacidad, color)
            ("Docente",                "Reservado para docentes universitarios",              False, "#3B82F6"),
            ("Estudiante",             "Disponible para estudiantes con vehículo registrado", False, "#10B981"),
            ("Personal Administrativo","Reservado para personal administrativo de la UAGRM", False, "#F59E0B"),
            ("Discapacitado",          "Espacio de accesibilidad — uso exclusivo con permiso",True,  "#8B5CF6"),
            ("Visitante",              "Uso temporal para visitantes con pase autorizado",    False, "#6B7280"),
            ("General",                "Espacio de uso común sin restricción de rol",         False, "#EF4444"),
        ]
        for nombre, descripcion, es_disc, color in categorias:
            _, created = CategoriaEspacio.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": descripcion, "es_discapacidad": es_disc, "color": color},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {nombre}  ({color})")

    # ──────────────────────────────────────────────
    # FASE 6 — ZONAS DE PARQUEO Y ESPACIOS
    # ──────────────────────────────────────────────
    def _seed_zonas_y_espacios(self):
        from apps.parqueos.models import ZonaParqueo, EspacioParqueo, CategoriaEspacio
        self.stdout.write(self.style.HTTP_INFO("\n[6/10] Zonas de parqueo y espacios..."))

        cat_doc  = CategoriaEspacio.objects.filter(nombre="Docente").first()
        cat_est  = CategoriaEspacio.objects.filter(nombre="Estudiante").first()
        cat_adm  = CategoriaEspacio.objects.filter(nombre="Personal Administrativo").first()
        cat_disc = CategoriaEspacio.objects.filter(nombre="Discapacitado").first()
        cat_vis  = CategoriaEspacio.objects.filter(nombre="Visitante").first()
        cat_gen  = CategoriaEspacio.objects.filter(nombre="General").first()

        zonas_config = [
            {
                "nombre": "Zona A — Bloque Administrativo",
                "descripcion": "Parqueo principal frente al edificio administrativo central",
                "ubicacion": "Edificio Central, planta baja, ala norte",
                "espacios": [
                    ("A01", cat_doc),  ("A02", cat_doc),  ("A03", cat_doc),
                    ("A04", cat_doc),  ("A05", cat_doc),  ("A06", cat_disc),
                    ("A07", cat_disc), ("A08", cat_vis),  ("A09", cat_vis),
                    ("A10", cat_adm),  ("A11", cat_adm),  ("A12", cat_adm),
                ],
            },
            {
                "nombre": "Zona B — Bloque Facultades",
                "descripcion": "Parqueo entre los bloques de facultades de ciencias e ingeniería",
                "ubicacion": "Avenida Universitaria, sector sur del campus",
                "espacios": [
                    ("B01", cat_est),  ("B02", cat_est),  ("B03", cat_est),
                    ("B04", cat_est),  ("B05", cat_est),  ("B06", cat_est),
                    ("B07", cat_est),  ("B08", cat_est),  ("B09", cat_est),
                    ("B10", cat_est),  ("B11", cat_doc),  ("B12", cat_doc),
                    ("B13", cat_disc), ("B14", cat_vis),  ("B15", cat_gen),
                ],
            },
            {
                "nombre": "Zona C — Biblioteca Central",
                "descripcion": "Parqueo lateral junto a la biblioteca universitaria",
                "ubicacion": "Costado este de la Biblioteca Central",
                "espacios": [
                    ("C01", cat_est),  ("C02", cat_est),  ("C03", cat_est),
                    ("C04", cat_est),  ("C05", cat_doc),  ("C06", cat_doc),
                    ("C07", cat_disc), ("C08", cat_vis),  ("C09", cat_gen),
                    ("C10", cat_gen),
                ],
            },
        ]

        for zona_data in zonas_config:
            espacios_def = zona_data.pop("espacios")
            zona, zona_created = ZonaParqueo.objects.get_or_create(
                nombre=zona_data["nombre"],
                defaults={
                    "descripcion":    zona_data["descripcion"],
                    "ubicacion":      zona_data["ubicacion"],
                    "capacidad_total": len(espacios_def),
                    "activo":         True,
                },
            )
            estado_zona = self.style.SUCCESS("CREADO") if zona_created else "existe"
            self.stdout.write(f"  {estado_zona}  → {zona.nombre}  ({len(espacios_def)} espacios)")

            esp_creados = 0
            for numero, categoria in espacios_def:
                if categoria is None:
                    continue
                _, esp_created = EspacioParqueo.objects.get_or_create(
                    zona=zona,
                    numero=numero,
                    defaults={"categoria": categoria, "estado": "disponible"},
                )
                if esp_created:
                    esp_creados += 1
            if esp_creados:
                self.stdout.write(f"           {esp_creados} espacios nuevos creados")

    # ──────────────────────────────────────────────
    # FASE 7 — PUNTOS DE ACCESO
    # ──────────────────────────────────────────────
    def _seed_puntos_acceso(self):
        from apps.acceso.models import PuntoAcceso
        self.stdout.write(self.style.HTTP_INFO("\n[7/10] Puntos de acceso..."))
        puntos = [
            ("Entrada Principal Norte",  "Portón principal sobre la Av. Universitaria",     "entrada"),
            ("Entrada Secundaria Sur",   "Portón de acceso al sector de facultades",        "entrada"),
            ("Salida Principal Norte",   "Salida frente al edificio administrativo",        "salida"),
            ("Salida Secundaria Sur",    "Salida hacia la Av. Busch",                       "salida"),
            ("Control Central",          "Caseta de control central — entrada y salida",    "ambos"),
        ]
        for nombre, ubicacion, tipo in puntos:
            _, created = PuntoAcceso.objects.get_or_create(
                nombre=nombre,
                defaults={"ubicacion": ubicacion, "tipo": tipo, "activo": True},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {nombre}  [{tipo}]")

    # ──────────────────────────────────────────────
    # FASE 8 — TIPOS DE MULTA
    # ──────────────────────────────────────────────
    def _seed_tipos_multa(self):
        from apps.multas.models import TipoMulta
        self.stdout.write(self.style.HTTP_INFO("\n[8/10] Tipos de multa..."))
        tipos = [
            # (nombre, monto_base, descripcion)
            ("Estacionamiento en zona prohibida",
             50.00,
             "Vehículo detenido en área señalizada como prohibida para parqueo"),
            ("Vehículo en espacio de discapacitado sin permiso",
             150.00,
             "Ocupar espacio reservado para personas con discapacidad sin autorización"),
            ("Obstrucción de vía peatonal",
             60.00,
             "Vehículo bloqueando aceras, rampas o paso peatonal dentro del campus"),
            ("Exceso de velocidad en campus",
             100.00,
             "Circular a velocidad superior a 20 km/h dentro del recinto universitario"),
            ("Vehículo sin registro en el sistema",
             80.00,
             "Circulación dentro del campus con vehículo no registrado en el sistema"),
            ("Documentación vehicular vencida",
             40.00,
             "SOAT, revisión técnica o permiso de circulación con fecha de vencimiento superada"),
            ("Fuga de líquidos o contaminación",
             70.00,
             "Vehículo con derrame de aceite, combustible u otros líquidos contaminantes"),
            ("Ingreso no autorizado",
             120.00,
             "Acceso al campus evadiendo puntos de control o con QR de otro vehículo"),
        ]
        for nombre, monto, descripcion in tipos:
            _, created = TipoMulta.objects.get_or_create(
                nombre=nombre,
                defaults={"monto_base": monto, "descripcion": descripcion},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {nombre}  (Bs {monto:.2f})")

    # ──────────────────────────────────────────────
    # FASE 9 — TIPOS DE VISITA
    # ──────────────────────────────────────────────
    def _seed_tipos_visita(self):
        from apps.visitantes.models import TipoVisita
        self.stdout.write(self.style.HTTP_INFO("\n[9/10] Tipos de visita..."))
        tipos = [
            # (nombre, descripcion, requiere_vehiculo)
            ("Reunión institucional",      "Reunión formal con autoridades o departamentos",          False),
            ("Entrega de documentos",      "Trámite administrativo con entrega de papelería",         False),
            ("Visita académica",           "Actividad académica: conferencia, tutoría o evaluación",  False),
            ("Proveedor / Servicio",       "Empresa o persona que presta servicios a la universidad", True),
            ("Entrevista laboral",         "Postulante citado para proceso de selección de personal", False),
            ("Visita a docente/personal",  "Visita personal autorizada por un miembro de la UAGRM",   False),
            ("Mantenimiento y obras",      "Personal de construcción, limpieza o mantenimiento",      True),
            ("Evento universitario",       "Asistente a evento, feria, congreso o graduación",        False),
        ]
        for nombre, descripcion, req_veh in tipos:
            _, created = TipoVisita.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": descripcion, "requiere_vehiculo": req_veh},
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            req = "con vehículo" if req_veh else "sin vehículo"
            self.stdout.write(f"  {estado}  → {nombre}  [{req}]")

    # ──────────────────────────────────────────────
    # FASE 10 — TIPOS DE NOTIFICACIÓN
    # ──────────────────────────────────────────────
    def _seed_tipos_notificacion(self):
        from apps.notificaciones.models import TipoNotificacion
        self.stdout.write(self.style.HTTP_INFO("\n[10/10] Tipos de notificación..."))
        tipos = [
            # (codigo, nombre, plantilla_titulo, plantilla_cuerpo)
            (
                "ACCESO_ENTRADA",
                "Acceso vehicular — Entrada",
                "Tu vehículo ingresó al campus",
                "Tu vehículo con placa {placa} registró una entrada en {punto_acceso} a las {hora}.",
            ),
            (
                "ACCESO_SALIDA",
                "Acceso vehicular — Salida",
                "Tu vehículo salió del campus",
                "Tu vehículo con placa {placa} registró una salida en {punto_acceso} a las {hora}.",
            ),
            (
                "MULTA_REGISTRADA",
                "Nueva multa registrada",
                "Se registró una multa en tu vehículo",
                "Tu vehículo con placa {placa} recibió una multa de Bs {monto} por: {motivo}.",
            ),
            (
                "MULTA_PAGADA",
                "Pago de multa confirmado",
                "Tu multa fue pagada exitosamente",
                "El pago de Bs {monto} correspondiente a la multa #{id_multa} ha sido registrado.",
            ),
            (
                "APELACION_RESUELTA",
                "Apelación de multa resuelta",
                "Resolución de tu apelación",
                "Tu apelación a la multa #{id_multa} fue {resultado}. {respuesta}",
            ),
            (
                "QR_DELEGACION_GENERADO",
                "QR de delegación generado",
                "Se generó un QR de delegación para tu vehículo",
                "Se autorizó acceso temporal para tu vehículo {placa} hasta el {fecha_expiracion}.",
            ),
            (
                "QR_DELEGACION_USADO",
                "QR de delegación utilizado",
                "Tu QR de delegación fue utilizado",
                "El QR de delegación de tu vehículo {placa} fue usado en {punto_acceso}.",
            ),
            (
                "DOCUMENTO_POR_VENCER",
                "Documento vehicular por vencer",
                "Un documento de tu vehículo vence pronto",
                "El {tipo_documento} de tu vehículo {placa} vence el {fecha_vencimiento}. Renuévalo a tiempo.",
            ),
            (
                "VISITA_CONFIRMADA",
                "Visita confirmada",
                "Tu visita ha sido confirmada",
                "La visita de {nombre_visitante} ha sido registrada y está activa.",
            ),
            (
                "ESPACIO_DISPONIBLE",
                "Espacios disponibles",
                "Hay espacios libres en el parqueo",
                "La {zona} tiene {cantidad} espacios disponibles en este momento.",
            ),
        ]
        for codigo, nombre, tit, cuerpo in tipos:
            _, created = TipoNotificacion.objects.get_or_create(
                codigo=codigo,
                defaults={
                    "nombre": nombre,
                    "plantilla_titulo": tit,
                    "plantilla_cuerpo": cuerpo,
                    "descripcion": "",
                },
            )
            estado = self.style.SUCCESS("  CREADO") if created else "  existe"
            self.stdout.write(f"  {estado}  → {codigo}")

    # ──────────────────────────────────────────────
    # EXTRA — ASIGNAR ROL ADMINISTRADOR A SUPERUSERS
    # ──────────────────────────────────────────────
    def _asignar_admin_a_superusers(self):
        from apps.usuarios.models import Usuario, Rol, UsuarioRol
        self.stdout.write(self.style.HTTP_INFO("\n[Extra] Asignando rol Administrador a superusers..."))

        rol_admin = Rol.objects.filter(nombre="Administrador").first()
        if not rol_admin:
            self.stdout.write(self.style.WARNING("  Rol Administrador no encontrado, omitiendo."))
            return

        superusers = Usuario.objects.filter(is_superuser=True, is_active=True)
        if not superusers.exists():
            self.stdout.write("  No hay superusers activos en la base de datos.")
            return

        for user in superusers:
            _, created = UsuarioRol.objects.get_or_create(
                usuario=user,
                rol=rol_admin,
                defaults={"asignado_por": None},
            )
            estado = self.style.SUCCESS("  ASIGNADO") if created else "  ya tenía el rol"
            self.stdout.write(f"  {estado}  → {user.ci} ({user.nombre} {user.apellido})")
