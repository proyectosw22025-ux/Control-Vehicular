"""
Autorización de acceso externo (proveedor/contratista).

Regla de negocio: un QR de autorización cubre ENTRADA + SALIDA dentro de su
ventana horaria. El 1er escaneo registra la entrada; el 2do, la salida; el 3ro
se rechaza. La dirección la impone el conteo de usos, no el guardia.
"""
import pytest
from datetime import timedelta
from django.utils import timezone
from apps.acceso.models import AutorizacionAccesoExterno
from conftest import graphql

REGISTRAR = """
mutation R($puntoId: Int!, $codigo: String!, $tipo: String!) {
  registrarAcceso(input: { puntoAccesoId: $puntoId, codigo: $codigo, tipo: $tipo }) {
    id tipo metodoAcceso
  }
}
"""


@pytest.fixture
def auth_externa(db, guardia):
    ahora = timezone.now()
    return AutorizacionAccesoExterno.objects.create(
        placa="1234-ABC", empresa="Proveedor SRL", motivo="Entrega de insumos",
        autorizado_por=guardia,
        valido_desde=ahora - timedelta(hours=1),
        valido_hasta=ahora + timedelta(hours=8),
        codigo_acceso="ABCDEF1234567890ABCDEF12",
    )


@pytest.mark.django_db
def test_autorizacion_externa_entrada_luego_salida(gql_guardia, auth_externa, punto_acceso):
    """El proveedor entra (1er escaneo) y sale (2do escaneo) con el mismo QR."""
    # 1er escaneo → entrada
    r1 = graphql(gql_guardia, REGISTRAR, {
        "puntoId": punto_acceso.id, "codigo": auth_externa.codigo_acceso, "tipo": "auto",
    })
    assert "errors" not in r1, r1
    assert r1["data"]["registrarAcceso"]["tipo"] == "entrada"

    # 2do escaneo → salida (antes fallaba: el QR quedaba consumido en el 1er uso)
    r2 = graphql(gql_guardia, REGISTRAR, {
        "puntoId": punto_acceso.id, "codigo": auth_externa.codigo_acceso, "tipo": "auto",
    })
    assert "errors" not in r2, r2
    assert r2["data"]["registrarAcceso"]["tipo"] == "salida"

    auth_externa.refresh_from_db()
    assert auth_externa.usos_actual == 2
    assert auth_externa.usado is True
    assert auth_externa.vigente is False


@pytest.mark.django_db
def test_autorizacion_externa_tercer_escaneo_rechazado(gql_guardia, auth_externa, punto_acceso):
    """Tras entrada + salida, un 3er escaneo se rechaza."""
    for _ in range(2):
        graphql(gql_guardia, REGISTRAR, {
            "puntoId": punto_acceso.id, "codigo": auth_externa.codigo_acceso, "tipo": "auto",
        })
    r3 = graphql(gql_guardia, REGISTRAR, {
        "puntoId": punto_acceso.id, "codigo": auth_externa.codigo_acceso, "tipo": "auto",
    })
    assert "errors" in r3
    assert "completada" in r3["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_autorizacion_externa_fuera_de_ventana(gql_guardia, punto_acceso, guardia):
    """Fuera de la ventana horaria no se permite el acceso."""
    ahora = timezone.now()
    auth = AutorizacionAccesoExterno.objects.create(
        placa="9999-XYZ", empresa="Tarde SRL", motivo="x", autorizado_por=guardia,
        valido_desde=ahora + timedelta(hours=2),   # aún no válida
        valido_hasta=ahora + timedelta(hours=4),
        codigo_acceso="FUTURO00000000000000FUTU",
    )
    r = graphql(gql_guardia, REGISTRAR, {
        "puntoId": punto_acceso.id, "codigo": auth.codigo_acceso, "tipo": "auto",
    })
    assert "errors" in r
    assert "aún no válida" in r["errors"][0]["message"].lower()
