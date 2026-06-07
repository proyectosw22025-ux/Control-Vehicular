"""Tests de infracciones: registro, sanción derivada, pago y validaciones de estado."""
import pytest
from apps.multas.models import Infraccion, Sancion
from conftest import graphql

REGISTRAR_INFRACCION = """
mutation RegistrarInfraccion($input: RegistrarInfraccionInput!) {
  registrarInfraccion(input: $input) {
    id estado placaVehiculo
    sancion { id tipoSancion monto estado }
  }
}
"""

PAGAR_SANCION = """
mutation PagarSancion($input: PagarSancionInput!) {
  pagarSancion(input: $input) {
    id metodoPago montoPagado
  }
}
"""

RESOLVER_APELACION = """
mutation Resolver($input: ResolverApelacionInput!) {
  resolverApelacion(input: $input) { id estado }
}
"""


@pytest.mark.django_db
def test_registrar_infraccion_exitosa(gql_admin, vehiculo_activo, tipo_infraccion):
    r = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Estacionado en zona prohibida",
        }
    })
    assert "errors" not in r
    data = r["data"]["registrarInfraccion"]
    assert data["estado"] == "registrada"
    assert data["sancion"]["tipoSancion"] == "multa_economica"
    assert float(data["sancion"]["monto"]) == float(tipo_infraccion.monto_base)
    assert data["placaVehiculo"] == vehiculo_activo.placa


@pytest.mark.django_db
def test_registrar_infraccion_multa_economica_sanciona_vehiculo(gql_admin, vehiculo_activo, tipo_infraccion):
    """Una infracción cuya sanción sugerida es multa económica bloquea el vehículo."""
    graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Test sanción",
        }
    })
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "sancionado"


@pytest.mark.django_db
def test_registrar_infraccion_amonestacion_no_sanciona_vehiculo(gql_admin, vehiculo_activo, tipo_infraccion):
    """Una amonestación es informativa: nace 'cumplida' y NO bloquea el vehículo."""
    tipo_infraccion.tipo_sancion_sugerido = "amonestacion"
    tipo_infraccion.monto_base = None
    tipo_infraccion.save()

    r = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Documentación vencida",
        }
    })
    assert "errors" not in r
    data = r["data"]["registrarInfraccion"]
    assert data["sancion"]["tipoSancion"] == "amonestacion"
    assert data["sancion"]["estado"] == "cumplida"

    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "activo"


@pytest.mark.django_db
def test_pagar_sancion_exitosa(gql_admin, vehiculo_activo, tipo_infraccion):
    r_inf = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Test pago",
        }
    })
    sancion_id = r_inf["data"]["registrarInfraccion"]["sancion"]["id"]

    r_pago = graphql(gql_admin, PAGAR_SANCION, {"input": {"sancionId": sancion_id, "metodoPago": "efectivo"}})
    assert "errors" not in r_pago
    assert r_pago["data"]["pagarSancion"]["metodoPago"] == "efectivo"


@pytest.mark.django_db
def test_pagar_sancion_ya_pagada_lanza_error(gql_admin, vehiculo_activo, tipo_infraccion):
    r = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Test doble pago",
        }
    })
    sancion_id = r["data"]["registrarInfraccion"]["sancion"]["id"]
    graphql(gql_admin, PAGAR_SANCION, {"input": {"sancionId": sancion_id, "metodoPago": "efectivo"}})

    r2 = graphql(gql_admin, PAGAR_SANCION, {"input": {"sancionId": sancion_id, "metodoPago": "efectivo"}})
    assert "errors" in r2
    assert "no encontrada" in r2["errors"][0]["message"]


@pytest.mark.django_db
def test_registrar_infraccion_vehiculo_inexistente(gql_admin, tipo_infraccion):
    r = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": 9999,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Test",
        }
    })
    assert "errors" in r
    assert "no encontrado" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_pagar_unica_sancion_rehabilita_vehiculo(gql_admin, vehiculo_activo, tipo_infraccion):
    """Pagar la única sanción pendiente debe rehabilitar el vehículo a 'activo'."""
    graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id, "descripcion": "Test rehab"}
    })
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "sancionado"

    sancion = Sancion.objects.filter(infraccion__vehiculo=vehiculo_activo, estado="pendiente").first()
    graphql(gql_admin, PAGAR_SANCION, {"input": {"sancionId": sancion.id, "metodoPago": "efectivo"}})

    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "activo"


@pytest.mark.django_db
def test_vehiculo_permanece_sancionado_si_tiene_mas_sanciones(gql_admin, vehiculo_activo, tipo_infraccion):
    """Pagar una sanción no rehabilita el vehículo si aún quedan otras pendientes."""
    r1 = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id, "descripcion": "Infracción 1"}
    })
    graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id, "descripcion": "Infracción 2"}
    })
    sancion_id = r1["data"]["registrarInfraccion"]["sancion"]["id"]
    graphql(gql_admin, PAGAR_SANCION, {"input": {"sancionId": sancion_id, "metodoPago": "transferencia"}})

    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "sancionado"


@pytest.mark.django_db
def test_metodo_pago_invalido(gql_admin, vehiculo_activo, tipo_infraccion):
    r = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoId": tipo_infraccion.id,
            "descripcion": "Test método inválido",
        }
    })
    sancion_id = r["data"]["registrarInfraccion"]["sancion"]["id"]

    r2 = graphql(gql_admin, PAGAR_SANCION, {"input": {"sancionId": sancion_id, "metodoPago": "bitcoin"}})
    assert "errors" in r2
    assert "pago" in r2["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_apelacion_aprobada_cancela_sancion_en_cascada(gql_admin, vehiculo_activo, tipo_infraccion):
    """Aprobar la apelación anula la infracción y cancela su sanción asociada — el vehículo se rehabilita."""
    from apps.multas.models import ApelacionInfraccion

    r = graphql(gql_admin, REGISTRAR_INFRACCION, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id, "descripcion": "Infracción a apelar"}
    })
    infraccion_id = r["data"]["registrarInfraccion"]["id"]
    sancion_id = r["data"]["registrarInfraccion"]["sancion"]["id"]

    infraccion = Infraccion.objects.get(pk=infraccion_id)
    apelacion = ApelacionInfraccion.objects.create(
        infraccion=infraccion, usuario=vehiculo_activo.propietario, motivo="No fui yo"
    )
    infraccion.estado = "apelada"
    infraccion.save(update_fields=["estado"])

    r2 = graphql(gql_admin, RESOLVER_APELACION, {
        "input": {"apelacionId": apelacion.id, "aprobada": True, "respuesta": "Aprobado, evidencia insuficiente"}
    })
    assert "errors" not in r2
    assert r2["data"]["resolverApelacion"]["estado"] == "aprobada"

    infraccion.refresh_from_db()
    assert infraccion.estado == "anulada"

    sancion = Sancion.objects.get(pk=sancion_id)
    assert sancion.estado == "cancelada"

    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "activo"
