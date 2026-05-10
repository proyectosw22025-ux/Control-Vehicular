"""
Fixtures globales reutilizables en todos los tests del proyecto.

Uso rápido:
    pytest                        # todos los tests
    pytest apps/acceso/tests/     # solo acceso
    pytest --cov=apps --cov-report=term-missing  # con cobertura
"""
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.usuarios.models import Usuario, Rol, UsuarioRol
from apps.vehiculos.models import TipoVehiculo, Vehiculo
from apps.acceso.models import PuntoAcceso, AuditLog
from apps.parqueos.models import CategoriaEspacio, ZonaParqueo, EspacioParqueo
from apps.multas.models import TipoMulta


# ── Usuarios ────────────────────────────────────────────────────────────────

@pytest.fixture
def password():
    return "TestPass123!"


@pytest.fixture
def admin(db, password):
    u = Usuario.objects.create_superuser(
        ci="00000001",
        email="admin@test.com",
        nombre="Admin",
        apellido="Test",
        password=password,
    )
    return u


@pytest.fixture
def usuario_normal(db, password):
    u = Usuario.objects.create_user(
        ci="00000002",
        email="usuario@test.com",
        nombre="Juan",
        apellido="Pérez",
        password=password,
    )
    return u


@pytest.fixture
def rol_guardia(db):
    rol, _ = Rol.objects.get_or_create(nombre="Guardia", defaults={"descripcion": "Guardia de seguridad"})
    return rol


@pytest.fixture
def guardia(db, password, rol_guardia):
    u = Usuario.objects.create_user(
        ci="00000003",
        email="guardia@test.com",
        nombre="Pedro",
        apellido="Guardia",
        password=password,
    )
    UsuarioRol.objects.create(usuario=u, rol=rol_guardia)
    return u


# ── Vehículos ────────────────────────────────────────────────────────────────

@pytest.fixture
def tipo_vehiculo(db):
    t, _ = TipoVehiculo.objects.get_or_create(nombre="Auto", defaults={"descripcion": "Automóvil"})
    return t


@pytest.fixture
def vehiculo_activo(db, usuario_normal, tipo_vehiculo):
    return Vehiculo.objects.create(
        placa="ABC-001",
        tipo=tipo_vehiculo,
        propietario=usuario_normal,
        marca="Toyota",
        modelo="Corolla",
        anio=2020,
        color="blanco",
        estado="activo",
    )


@pytest.fixture
def vehiculo_sancionado(db, usuario_normal, tipo_vehiculo):
    return Vehiculo.objects.create(
        placa="SAN-001",
        tipo=tipo_vehiculo,
        propietario=usuario_normal,
        marca="Honda",
        modelo="Civic",
        anio=2019,
        color="negro",
        estado="sancionado",
    )


@pytest.fixture
def vehiculo_pendiente(db, usuario_normal, tipo_vehiculo):
    return Vehiculo.objects.create(
        placa="PEN-001",
        tipo=tipo_vehiculo,
        propietario=usuario_normal,
        marca="Kia",
        modelo="Rio",
        anio=2021,
        color="rojo",
        estado="pendiente",
    )


# ── Acceso ───────────────────────────────────────────────────────────────────

@pytest.fixture
def punto_acceso(db):
    return PuntoAcceso.objects.create(nombre="Entrada Principal", tipo="ambos", ubicacion="Portón norte")


# ── Parqueos ─────────────────────────────────────────────────────────────────

@pytest.fixture
def categoria_espacio(db):
    c, _ = CategoriaEspacio.objects.get_or_create(
        nombre="General",
        defaults={"descripcion": "Espacio general", "es_discapacidad": False, "color": "#4ade80"},
    )
    return c


@pytest.fixture
def zona(db):
    return ZonaParqueo.objects.create(nombre="Zona A", capacidad_total=10, activo=True)


@pytest.fixture
def espacio_disponible(db, zona, categoria_espacio):
    return EspacioParqueo.objects.create(
        zona=zona, categoria=categoria_espacio, numero="A01", estado="disponible"
    )


@pytest.fixture
def espacio_ocupado(db, zona, categoria_espacio):
    return EspacioParqueo.objects.create(
        zona=zona, categoria=categoria_espacio, numero="A02", estado="ocupado"
    )


# ── Multas ───────────────────────────────────────────────────────────────────

@pytest.fixture
def tipo_multa(db):
    t, _ = TipoMulta.objects.get_or_create(
        nombre="Estacionamiento indebido",
        defaults={"descripcion": "Vehículo mal estacionado", "monto_base": 50.00},
    )
    return t


# ── Cliente GraphQL ───────────────────────────────────────────────────────────

@pytest.fixture
def gql_client():
    """Cliente HTTP sin autenticación."""
    from django.test import Client
    return Client()


@pytest.fixture
def gql_admin(admin):
    """Cliente HTTP autenticado como administrador."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    token = str(RefreshToken.for_user(admin).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return c


@pytest.fixture
def gql_guardia(guardia):
    """Cliente HTTP autenticado como guardia."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    token = str(RefreshToken.for_user(guardia).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return c


def graphql(client, query: str, variables: dict = None):
    """Ejecuta una operación GraphQL y retorna el JSON completo."""
    import json
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    resp = client.post(
        "/graphql/",
        data=json.dumps(payload),
        content_type="application/json",
    )
    return resp.json()
