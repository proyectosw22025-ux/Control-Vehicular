"""
Comando: python manage.py seed_data
Pobla la base de datos con datos iniciales y demo realistas para la UAGRM.
Es idempotente: se puede ejecutar múltiples veces sin duplicar registros.
"""

from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Carga datos iniciales y demo realistas del sistema vehicular UAGRM"

    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("\n=== SEED DATA — Sistema Vehicular UAGRM ===\n"))
        with transaction.atomic():
            self._seed_roles()
            self._seed_tipos_vehiculo()
            self._seed_categorias_espacio()
            self._seed_zonas_y_espacios()
            self._seed_puntos_acceso()
            self._seed_tipos_multa()
            self._seed_usuarios_demo()
            self._seed_vehiculos_demo()
            self._asignar_admin_a_superusers()
        self.stdout.write(self.style.SUCCESS("\n✓ Seed data completado exitosamente.\n"))

    # ── ROLES ─────────────────────────────────────────────────
    def _seed_roles(self):
        from apps.usuarios.models import Rol
        self.stdout.write(self.style.HTTP_INFO("\n[1/8] Roles..."))
        roles = [
            ("Administrador",           "Control total del sistema. Accede a todos los módulos."),
            ("Guardia",                 "Registra accesos vehiculares, emite multas y gestiona visitantes."),
            ("Estudiante",              "Gestiona sus vehículos y consulta su historial."),
            ("Docente",                 "Gestiona sus vehículos con privilegios de zona preferencial."),
            ("Personal Administrativo", "Personal de la UAGRM. Gestiona sus vehículos."),
        ]
        for nombre, descripcion in roles:
            _, created = Rol.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": descripcion, "is_active": True},
            )
            self.stdout.write(f"  {'CREADO' if created else 'existe'}  → {nombre}")

    # ── TIPOS DE VEHÍCULO ─────────────────────────────────────
    def _seed_tipos_vehiculo(self):
        from apps.vehiculos.models import TipoVehiculo
        self.stdout.write(self.style.HTTP_INFO("\n[2/8] Tipos de vehículo..."))
        tipos = [
            ("Automóvil",   "Vehículo de pasajeros de 4 ruedas"),
            ("Motocicleta", "Vehículo de 2 ruedas con motor"),
            ("Camioneta",   "Vehículo pick-up o SUV"),
            ("Minibús",     "Vehículo de transporte colectivo menor"),
            ("Bicicleta",   "Vehículo no motorizado de 2 ruedas"),
        ]
        for nombre, descripcion in tipos:
            _, created = TipoVehiculo.objects.get_or_create(
                nombre=nombre, defaults={"descripcion": descripcion}
            )
            self.stdout.write(f"  {'CREADO' if created else 'existe'}  → {nombre}")

    # ── CATEGORÍAS DE ESPACIO ──────────────────────────────────
    def _seed_categorias_espacio(self):
        from apps.parqueos.models import CategoriaEspacio
        self.stdout.write(self.style.HTTP_INFO("\n[3/8] Categorías de espacio..."))
        categorias = [
            ("Docente",                 "Reservado para docentes universitarios",               False, "#3B82F6"),
            ("Estudiante",              "Disponible para estudiantes con vehículo registrado",  False, "#10B981"),
            ("Personal Administrativo", "Reservado para personal administrativo de la UAGRM",  False, "#F59E0B"),
            ("Discapacitado",           "Espacio de accesibilidad — uso exclusivo con permiso", True,  "#8B5CF6"),
            ("Visitante",               "Uso temporal para visitantes con pase autorizado",     False, "#6B7280"),
            ("General",                 "Espacio de uso común sin restricción de rol",          False, "#EF4444"),
        ]
        for nombre, descripcion, es_disc, color in categorias:
            _, created = CategoriaEspacio.objects.get_or_create(
                nombre=nombre,
                defaults={"descripcion": descripcion, "es_discapacidad": es_disc, "color": color},
            )
            self.stdout.write(f"  {'CREADO' if created else 'existe'}  → {nombre}")

    # ── ZONAS Y ESPACIOS ───────────────────────────────────────
    def _seed_zonas_y_espacios(self):
        from apps.parqueos.models import ZonaParqueo, EspacioParqueo, CategoriaEspacio
        self.stdout.write(self.style.HTTP_INFO("\n[4/8] Zonas de parqueo..."))

        def cat(nombre):
            return CategoriaEspacio.objects.filter(nombre=nombre).first()

        zonas_config = [
            {
                "nombre": "Zona A — Bloque Administrativo",
                "ubicacion": "Edificio Central, planta baja, ala norte",
                "espacios": [
                    ("A01", "Docente"), ("A02", "Docente"), ("A03", "Docente"),
                    ("A04", "Docente"), ("A05", "Docente"), ("A06", "Discapacitado"),
                    ("A07", "Discapacitado"), ("A08", "Visitante"), ("A09", "Visitante"),
                    ("A10", "Personal Administrativo"), ("A11", "Personal Administrativo"),
                    ("A12", "Personal Administrativo"),
                ],
            },
            {
                "nombre": "Zona B — Bloque Facultades",
                "ubicacion": "Avenida Universitaria, sector sur del campus",
                "espacios": [
                    ("B01", "Estudiante"), ("B02", "Estudiante"), ("B03", "Estudiante"),
                    ("B04", "Estudiante"), ("B05", "Estudiante"), ("B06", "Estudiante"),
                    ("B07", "Estudiante"), ("B08", "Estudiante"), ("B09", "Estudiante"),
                    ("B10", "Estudiante"), ("B11", "Docente"), ("B12", "Docente"),
                    ("B13", "Discapacitado"), ("B14", "Visitante"), ("B15", "General"),
                ],
            },
            {
                "nombre": "Zona C — Biblioteca Central",
                "ubicacion": "Costado este de la Biblioteca Central",
                "espacios": [
                    ("C01", "Estudiante"), ("C02", "Estudiante"), ("C03", "Estudiante"),
                    ("C04", "Estudiante"), ("C05", "Docente"), ("C06", "Docente"),
                    ("C07", "Discapacitado"), ("C08", "Visitante"), ("C09", "General"),
                    ("C10", "General"),
                ],
            },
        ]

        for zona_data in zonas_config:
            espacios_def = zona_data.pop("espacios")
            zona, zona_created = ZonaParqueo.objects.get_or_create(
                nombre=zona_data["nombre"],
                defaults={
                    "ubicacion": zona_data["ubicacion"],
                    "capacidad_total": len(espacios_def),
                    "activo": True,
                },
            )
            self.stdout.write(f"  {'CREADO' if zona_created else 'existe'}  → {zona.nombre}")
            for numero, cat_nombre in espacios_def:
                EspacioParqueo.objects.get_or_create(
                    zona=zona, numero=numero,
                    defaults={"categoria": cat(cat_nombre), "estado": "disponible"},
                )

    # ── PUNTOS DE ACCESO ───────────────────────────────────────
    def _seed_puntos_acceso(self):
        from apps.acceso.models import PuntoAcceso
        self.stdout.write(self.style.HTTP_INFO("\n[5/8] Puntos de acceso..."))
        puntos = [
            ("Entrada Principal Norte",  "Portón principal sobre la Av. Universitaria",  "entrada"),
            ("Entrada Secundaria Sur",   "Portón de acceso al sector de facultades",     "entrada"),
            ("Salida Principal Norte",   "Salida frente al edificio administrativo",     "salida"),
            ("Salida Secundaria Sur",    "Salida hacia la Av. Busch",                    "salida"),
            ("Control Central",          "Caseta de control — entrada y salida",         "ambos"),
        ]
        for nombre, ubicacion, tipo in puntos:
            _, created = PuntoAcceso.objects.get_or_create(
                nombre=nombre,
                defaults={"ubicacion": ubicacion, "tipo": tipo, "activo": True},
            )
            self.stdout.write(f"  {'CREADO' if created else 'existe'}  → {nombre}")

    # ── TIPOS DE MULTA ─────────────────────────────────────────
    def _seed_tipos_multa(self):
        from apps.multas.models import TipoMulta
        self.stdout.write(self.style.HTTP_INFO("\n[6/8] Tipos de multa..."))
        tipos = [
            ("Estacionamiento en zona prohibida",              50.00,  "Vehículo en área señalizada como prohibida para parqueo"),
            ("Vehículo en espacio de discapacitado sin permiso", 150.00, "Ocupar espacio reservado sin autorización"),
            ("Obstrucción de vía peatonal",                    60.00,  "Vehículo bloqueando aceras o rampas dentro del campus"),
            ("Exceso de velocidad en campus",                 100.00,  "Velocidad superior a 20 km/h dentro del recinto"),
            ("Vehículo sin registro en el sistema",            80.00,  "Circulación con vehículo no registrado"),
            ("Documentación vehicular vencida",                40.00,  "SOAT o revisión técnica con vencimiento superado"),
            ("Ingreso no autorizado",                         120.00,  "Acceso evadiendo puntos de control o con QR ajeno"),
        ]
        for nombre, monto, descripcion in tipos:
            _, created = TipoMulta.objects.get_or_create(
                nombre=nombre, defaults={"monto_base": monto, "descripcion": descripcion}
            )
            self.stdout.write(f"  {'CREADO' if created else 'existe'}  → {nombre} (Bs {monto})")

    # ── USUARIOS DEMO ──────────────────────────────────────────
    def _seed_usuarios_demo(self):
        from apps.usuarios.models import Usuario, Rol, UsuarioRol
        self.stdout.write(self.style.HTTP_INFO("\n[7/8] Usuarios demo..."))

        def crear_usuario(ci, email, nombre, apellido, password, rol_nombre):
            if Usuario.objects.filter(ci=ci).exists():
                self.stdout.write(f"  existe   → {ci} ({nombre} {apellido})")
                return Usuario.objects.get(ci=ci)
            user = Usuario.objects.create_user(
                ci=ci, email=email, nombre=nombre,
                apellido=apellido, password=password,
            )
            rol = Rol.objects.filter(nombre=rol_nombre).first()
            if rol:
                UsuarioRol.objects.get_or_create(usuario=user, rol=rol)
            self.stdout.write(self.style.SUCCESS(f"  CREADO   → {ci} ({nombre} {apellido}) [{rol_nombre}]"))
            return user

        crear_usuario("G001",     "guardia1@uagrm.edu.bo",   "Pedro",    "Mamani Flores",    "Guardia123!", "Guardia")
        crear_usuario("G002",     "guardia2@uagrm.edu.bo",   "Carmen",   "Vaca Suárez",      "Guardia123!", "Guardia")
        crear_usuario("D001",     "docente1@uagrm.edu.bo",   "Dr. Luis", "Torrico Gutierrez","Docente123!", "Docente")
        crear_usuario("D002",     "docente2@uagrm.edu.bo",   "Dra. Ana", "Pérez Montaño",    "Docente123!", "Docente")
        crear_usuario("D003",     "docente3@uagrm.edu.bo",   "Ing. Carlos","Rada Vásquez",   "Docente123!", "Docente")
        crear_usuario("E001",     "est1@uagrm.edu.bo",       "Marcos",   "Justiniano López", "Est123456!",  "Estudiante")
        crear_usuario("E002",     "est2@uagrm.edu.bo",       "Valentina","Rivero Chávez",    "Est123456!",  "Estudiante")
        crear_usuario("E003",     "est3@uagrm.edu.bo",       "Diego",    "Soto Medina",      "Est123456!",  "Estudiante")
        crear_usuario("E004",     "est4@uagrm.edu.bo",       "Lucía",    "Vargas Pedraza",   "Est123456!",  "Estudiante")
        crear_usuario("PA001",    "personal1@uagrm.edu.bo",  "Sandra",   "Coca Mercado",     "Personal123!","Personal Administrativo")
        crear_usuario("PA002",    "personal2@uagrm.edu.bo",  "Roberto",  "Nava Aguilar",     "Personal123!","Personal Administrativo")

    # ── VEHÍCULOS DEMO ─────────────────────────────────────────
    def _seed_vehiculos_demo(self):
        from apps.usuarios.models import Usuario
        from apps.vehiculos.models import Vehiculo, TipoVehiculo, HistorialPropietario
        from django.utils import timezone
        self.stdout.write(self.style.HTTP_INFO("\n[8/8] Vehículos demo..."))

        def tipo(nombre):
            return TipoVehiculo.objects.filter(nombre=nombre).first()

        def propietario(ci):
            return Usuario.objects.filter(ci=ci).first()

        vehiculos = [
            # (placa, tipo, ci_propietario, marca, modelo, anio, color, estado)
            ("SCZ-1234", "Automóvil",   "D001", "Toyota",   "Corolla",   2020, "Blanco",  "activo"),
            ("SCZ-5678", "Camioneta",   "D002", "Ford",     "Explorer",  2019, "Plata",   "activo"),
            ("SCZ-9012", "Automóvil",   "D003", "Hyundai",  "Tucson",    2021, "Negro",   "activo"),
            ("SCZ-3456", "Motocicleta", "E001", "Honda",    "CB300",     2022, "Rojo",    "activo"),
            ("SCZ-7890", "Automóvil",   "E002", "Chevrolet","Sail",      2018, "Azul",    "activo"),
            ("SCZ-2345", "Motocicleta", "E003", "Yamaha",   "FZ-S",      2021, "Negro",   "activo"),
            ("SCZ-6789", "Automóvil",   "E004", "Kia",      "Rio",       2020, "Gris",    "activo"),
            ("SCZ-0123", "Automóvil",   "PA001","Nissan",   "Sentra",    2019, "Blanco",  "activo"),
            ("SCZ-4567", "Camioneta",   "PA002","Toyota",   "Hilux",     2022, "Verde",   "activo"),
            ("SCZ-8888", "Automóvil",   "E001", "Suzuki",   "Swift",     2017, "Amarillo","pendiente"),
        ]

        for placa, tipo_nombre, ci, marca, modelo, anio, color, estado in vehiculos:
            if Vehiculo.objects.filter(placa=placa).exists():
                self.stdout.write(f"  existe   → {placa}")
                continue
            owner = propietario(ci)
            if not owner:
                self.stdout.write(self.style.WARNING(f"  AVISO: propietario CI={ci} no encontrado, omitiendo {placa}"))
                continue
            v = Vehiculo.objects.create(
                placa=placa, tipo=tipo(tipo_nombre), propietario=owner,
                marca=marca, modelo=modelo, anio=anio, color=color, estado=estado,
            )
            HistorialPropietario.objects.get_or_create(
                vehiculo=v, usuario=owner,
                defaults={"fecha_inicio": timezone.now().date()},
            )
            self.stdout.write(self.style.SUCCESS(f"  CREADO   → {placa} {marca} {modelo} [{estado}]"))

    # ── ASIGNAR ROL ADMIN A SUPERUSERS ────────────────────────
    def _asignar_admin_a_superusers(self):
        from apps.usuarios.models import Usuario, Rol, UsuarioRol
        self.stdout.write(self.style.HTTP_INFO("\n[Extra] Asignando rol Administrador a superusers..."))
        rol_admin = Rol.objects.filter(nombre="Administrador").first()
        if not rol_admin:
            return
        for user in Usuario.objects.filter(is_superuser=True, is_active=True):
            _, created = UsuarioRol.objects.get_or_create(
                usuario=user, rol=rol_admin, defaults={"asignado_por": None}
            )
            self.stdout.write(f"  {'ASIGNADO' if created else 'ya tenía rol'}  → {user.ci}")
