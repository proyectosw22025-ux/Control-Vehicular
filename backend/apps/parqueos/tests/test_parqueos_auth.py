"""
Tests de autorización en parqueos — verifica que solo
guardias y administradores pueden operar sesiones y espacios.
"""
import pytest
from conftest import graphql

INICIAR = """
mutation IniciarSesion($espacioId: Int!, $vehiculoId: Int!) {
  iniciarSesionParqueo(input: { espacioId: $espacioId, vehiculoId: $vehiculoId }) {
    id estado
  }
}
"""

CERRAR = """
mutation CerrarSesion($sesionId: Int!) {
  cerrarSesionParqueo(sesionId: $sesionId) { id estado }
}
"""

CREAR_ZONA = """
mutation CrearZona($nombre: String!, $capacidadTotal: Int!) {
  crearZona(input: { nombre: $nombre, capacidadTotal: $capacidadTotal }) { id nombre }
}
"""


@pytest.mark.django_db
def test_usuario_no_autenticado_no_puede_iniciar_sesion(gql_client, vehiculo_activo, espacio_disponible):
    """Un request sin token JWT no puede iniciar sesión de parqueo."""
    r = graphql(gql_client, INICIAR, {"espacioId": espacio_disponible.id, "vehiculoId": vehiculo_activo.id})
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower() or "autenticaci" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_guardia_puede_iniciar_sesion(gql_guardia, vehiculo_activo, espacio_disponible):
    """Un guardia autenticado puede iniciar sesión de parqueo."""
    r = graphql(gql_guardia, INICIAR, {"espacioId": espacio_disponible.id, "vehiculoId": vehiculo_activo.id})
    assert "errors" not in r
    assert r["data"]["iniciarSesionParqueo"]["estado"] == "activa"


@pytest.mark.django_db
def test_admin_puede_crear_zona(gql_admin):
    """Solo un administrador puede crear zonas de parqueo."""
    r = graphql(gql_admin, CREAR_ZONA, {"nombre": "Zona Test Auth", "capacidadTotal": 5})
    assert "errors" not in r
    assert r["data"]["crearZona"]["nombre"] == "Zona Test Auth"


@pytest.mark.django_db
def test_guardia_no_puede_crear_zona(gql_guardia):
    """Un guardia no puede crear zonas — solo admins."""
    r = graphql(gql_guardia, CREAR_ZONA, {"nombre": "Zona No Permitida", "capacidadTotal": 5})
    assert "errors" in r
    assert "administrador" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_vehiculo_sancionado_no_puede_estacionar(gql_guardia, vehiculo_sancionado, espacio_disponible):
    """Un vehículo sancionado no puede iniciar sesión de parqueo."""
    r = graphql(gql_guardia, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_sancionado.id,
    })
    assert "errors" in r
    assert "sancionado" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_cerrar_sesion_requiere_autenticacion(gql_client):
    """Cerrar sesión de parqueo requiere estar autenticado."""
    r = graphql(gql_client, CERRAR, {"sesionId": 1})
    assert "errors" in r
