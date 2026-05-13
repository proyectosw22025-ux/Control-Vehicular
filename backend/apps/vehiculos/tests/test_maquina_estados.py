"""
Tests de la máquina de estados de vehículos — Regla 1 + Regla 5 del prompt.

Verifica que las transiciones de estado respetan el flujo de negocio de la UAGRM:
  pendiente → activo (aprobar)
  pendiente → inactivo (rechazar)
  activo    → inactivo (desactivar)
  activo    → sancionado (multa)
  inactivo  → activo (reactivar)
  sancionado → activo (pago multas)

Y que las transiciones INVÁLIDAS son bloqueadas:
  activo    → pendiente  ❌ (sin sentido de negocio)
  sancionado → inactivo  ❌ (debe pagar primero)
  inactivo  → sancionado ❌ (no puede multarse si inactivo)
"""
import pytest
from apps.vehiculos.schema import _validar_transicion
from conftest import graphql

ACTUALIZAR = """
mutation Actualizar($id: Int!, $input: ActualizarVehiculoInput!) {
  actualizarVehiculo(id: $id, input: $input) {
    id placa estado
  }
}
"""

APROBAR = """
mutation Aprobar($id: Int!) {
  aprobarVehiculo(vehiculoId: $id) { id placa estado }
}
"""

RECHAZAR = """
mutation Rechazar($id: Int!, $motivo: String!) {
  rechazarVehiculo(vehiculoId: $id, motivo: $motivo) { id placa estado }
}
"""


# ── Tests de _validar_transicion (pura, sin BD) ────────────────────────────

def test_transicion_pendiente_a_activo_es_valida():
    _validar_transicion("pendiente", "activo")  # no lanza


def test_transicion_pendiente_a_inactivo_es_valida():
    _validar_transicion("pendiente", "inactivo")  # no lanza


def test_transicion_activo_a_inactivo_es_valida():
    _validar_transicion("activo", "inactivo")  # no lanza


def test_transicion_activo_a_sancionado_es_valida():
    _validar_transicion("activo", "sancionado")  # no lanza


def test_transicion_inactivo_a_activo_es_valida():
    _validar_transicion("inactivo", "activo")  # no lanza


def test_transicion_sancionado_a_activo_es_valida():
    _validar_transicion("sancionado", "activo")  # no lanza


def test_transicion_activo_a_pendiente_es_invalida():
    """Un vehículo aprobado NO puede volver a pendiente."""
    with pytest.raises(Exception, match="nválida"):
        _validar_transicion("activo", "pendiente")


def test_transicion_sancionado_a_inactivo_es_invalida():
    """Un vehículo sancionado NO puede desactivarse directamente."""
    with pytest.raises(Exception, match="nválida"):
        _validar_transicion("sancionado", "inactivo")


def test_transicion_inactivo_a_sancionado_es_invalida():
    """Un vehículo inactivo NO puede recibir sanción directamente."""
    with pytest.raises(Exception, match="nválida"):
        _validar_transicion("inactivo", "sancionado")


def test_transicion_pendiente_a_sancionado_es_invalida():
    """Un vehículo pendiente no puede ser sancionado."""
    with pytest.raises(Exception, match="nválida"):
        _validar_transicion("pendiente", "sancionado")


# ── Tests de integración con GraphQL ─────────────────────────────────────────

@pytest.mark.django_db
def test_actualizar_vehiculo_permite_transicion_valida(gql_admin, vehiculo_activo):
    """Admin puede pasar un vehículo activo a inactivo."""
    r = graphql(gql_admin, ACTUALIZAR, {
        "id": vehiculo_activo.id,
        "input": {"estado": "inactivo"},
    })
    assert "errors" not in r
    assert r["data"]["actualizarVehiculo"]["estado"] == "inactivo"


@pytest.mark.django_db
def test_actualizar_vehiculo_bloquea_transicion_invalida(gql_admin, vehiculo_activo):
    """Admin NO puede regresar un vehículo activo a pendiente."""
    r = graphql(gql_admin, ACTUALIZAR, {
        "id": vehiculo_activo.id,
        "input": {"estado": "pendiente"},
    })
    assert "errors" in r
    assert "nválida" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_actualizar_vehiculo_bloquea_sancionado_a_inactivo(gql_admin, vehiculo_sancionado):
    """Un vehículo sancionado NO puede desactivarse directamente."""
    r = graphql(gql_admin, ACTUALIZAR, {
        "id": vehiculo_sancionado.id,
        "input": {"estado": "inactivo"},
    })
    assert "errors" in r
    assert "nválida" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_aprobar_vehiculo_no_pendiente_falla(gql_admin, vehiculo_activo):
    """Aprobar un vehículo ya activo debe fallar con mensaje de transición."""
    r = graphql(gql_admin, APROBAR, {"id": vehiculo_activo.id})
    assert "errors" in r
    assert "nválida" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_rechazar_vehiculo_requiere_motivo(gql_admin, vehiculo_pendiente):
    """El motivo de rechazo es obligatorio — campo vacío debe fallar."""
    r = graphql(gql_admin, RECHAZAR, {"id": vehiculo_pendiente.id, "motivo": ""})
    assert "errors" in r
    assert "obligatorio" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_guardia_no_puede_actualizar_vehiculo(gql_guardia, vehiculo_activo):
    """Solo administradores pueden actualizar vehículos."""
    r = graphql(gql_guardia, ACTUALIZAR, {
        "id": vehiculo_activo.id,
        "input": {"estado": "inactivo"},
    })
    assert "errors" in r
    assert "administrador" in r["errors"][0]["message"].lower()
