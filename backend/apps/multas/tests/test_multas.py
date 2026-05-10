"""Tests de multas: registro, pago y validaciones de estado."""
import pytest
from apps.multas.models import Multa
from conftest import graphql

REGISTRAR_MULTA = """
mutation RegistrarMulta($input: RegistrarMultaInput!) {
  registrarMulta(input: $input) {
    id monto estado placaVehiculo
  }
}
"""

PAGAR_MULTA = """
mutation PagarMulta($input: PagarMultaInput!) {
  pagarMulta(input: $input) {
    id metodoPago montoPagado
  }
}
"""


@pytest.mark.django_db
def test_registrar_multa_exitosa(gql_admin, vehiculo_activo, tipo_multa):
    r = graphql(gql_admin, REGISTRAR_MULTA, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_multa.id,
            "descripcion": "Estacionado en zona prohibida",
        }
    })
    assert "errors" not in r
    data = r["data"]["registrarMulta"]
    assert data["estado"] == "pendiente"
    assert float(data["monto"]) == float(tipo_multa.monto_base)
    assert data["placaVehiculo"] == vehiculo_activo.placa


@pytest.mark.django_db
def test_registrar_multa_cambia_vehiculo_a_sancionado(gql_admin, vehiculo_activo, tipo_multa):
    graphql(gql_admin, REGISTRAR_MULTA, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_multa.id,
            "descripcion": "Test sanción",
        }
    })
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "sancionado"


@pytest.mark.django_db
def test_pagar_multa_exitosa(gql_admin, vehiculo_activo, tipo_multa):
    r_multa = graphql(gql_admin, REGISTRAR_MULTA, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_multa.id,
            "descripcion": "Test pago",
        }
    })
    multa_id = r_multa["data"]["registrarMulta"]["id"]

    r_pago = graphql(gql_admin, PAGAR_MULTA, {"input": {"multaId": multa_id, "metodoPago": "efectivo"}})
    assert "errors" not in r_pago
    assert r_pago["data"]["pagarMulta"]["metodoPago"] == "efectivo"


@pytest.mark.django_db
def test_pagar_multa_ya_pagada_lanza_error(gql_admin, vehiculo_activo, tipo_multa):
    r = graphql(gql_admin, REGISTRAR_MULTA, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_multa.id,
            "descripcion": "Test doble pago",
        }
    })
    multa_id = r["data"]["registrarMulta"]["id"]
    graphql(gql_admin, PAGAR_MULTA, {"input": {"multaId": multa_id, "metodoPago": "efectivo"}})

    r2 = graphql(gql_admin, PAGAR_MULTA, {"input": {"multaId": multa_id, "metodoPago": "efectivo"}})
    assert "errors" in r2
    assert "no encontrada" in r2["errors"][0]["message"]


@pytest.mark.django_db
def test_registrar_multa_vehiculo_inexistente(gql_admin, tipo_multa):
    r = graphql(gql_admin, REGISTRAR_MULTA, {
        "input": {
            "vehiculoId": 9999,
            "tipoId": tipo_multa.id,
            "descripcion": "Test",
        }
    })
    assert "errors" in r
    assert "no encontrado" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_metodo_pago_invalido(gql_admin, vehiculo_activo, tipo_multa):
    r = graphql(gql_admin, REGISTRAR_MULTA, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_multa.id,
            "descripcion": "Test método inválido",
        }
    })
    multa_id = r["data"]["registrarMulta"]["id"]

    r2 = graphql(gql_admin, PAGAR_MULTA, {"input": {"multaId": multa_id, "metodoPago": "bitcoin"}})
    assert "errors" in r2
    assert "pago" in r2["errors"][0]["message"].lower()
