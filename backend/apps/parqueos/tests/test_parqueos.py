"""Tests de sesiones de parqueo: iniciar, cerrar y validaciones de estado."""
import pytest
from apps.parqueos.models import SesionParqueo, EspacioParqueo
from conftest import graphql

INICIAR = """
mutation IniciarSesion($espacioId: Int!, $vehiculoId: Int!) {
  iniciarSesionParqueo(input: { espacioId: $espacioId, vehiculoId: $vehiculoId }) {
    id estado placaVehiculo espacio { numero }
  }
}
"""

CERRAR = """
mutation CerrarSesion($sesionId: Int!) {
  cerrarSesionParqueo(sesionId: $sesionId) {
    id estado horaSalida
  }
}
"""


@pytest.mark.django_db
def test_iniciar_sesion_exitosa(gql_admin, vehiculo_activo, espacio_disponible):
    r = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_activo.id,
    })
    assert "errors" not in r
    data = r["data"]["iniciarSesionParqueo"]
    assert data["estado"] == "activa"
    assert data["placaVehiculo"] == vehiculo_activo.placa

    # El espacio debe quedar ocupado
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "ocupado"


@pytest.mark.django_db
def test_no_iniciar_sesion_en_espacio_ocupado(gql_admin, vehiculo_activo, espacio_ocupado):
    r = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_ocupado.id,
        "vehiculoId": vehiculo_activo.id,
    })
    assert "errors" in r
    assert "no está disponible" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_vehiculo_no_puede_tener_dos_sesiones_activas(
    db, gql_admin, vehiculo_activo, zona, categoria_espacio
):
    e1 = EspacioParqueo.objects.create(zona=zona, categoria=categoria_espacio, numero="B01", estado="disponible")
    e2 = EspacioParqueo.objects.create(zona=zona, categoria=categoria_espacio, numero="B02", estado="disponible")

    graphql(gql_admin, INICIAR, {"espacioId": e1.id, "vehiculoId": vehiculo_activo.id})
    r = graphql(gql_admin, INICIAR, {"espacioId": e2.id, "vehiculoId": vehiculo_activo.id})

    assert "errors" in r
    assert "sesión de parqueo activa" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_cerrar_sesion_libera_espacio(gql_admin, vehiculo_activo, espacio_disponible):
    r_iniciar = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_activo.id,
    })
    sesion_id = r_iniciar["data"]["iniciarSesionParqueo"]["id"]

    r_cerrar = graphql(gql_admin, CERRAR, {"sesionId": sesion_id})
    assert "errors" not in r_cerrar
    assert r_cerrar["data"]["cerrarSesionParqueo"]["estado"] == "cerrada"
    assert r_cerrar["data"]["cerrarSesionParqueo"]["horaSalida"] is not None

    # El espacio debe volver a disponible
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "disponible"


@pytest.mark.django_db
def test_cerrar_sesion_inexistente(gql_admin):
    r = graphql(gql_admin, CERRAR, {"sesionId": 9999})
    assert "errors" in r
    assert "no encontrada" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_espacio_inexistente_lanza_error(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, INICIAR, {"espacioId": 9999, "vehiculoId": vehiculo_activo.id})
    assert "errors" in r
    assert "no encontrado" in r["errors"][0]["message"]
