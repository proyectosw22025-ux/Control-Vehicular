"""Tests de control de acceso: estados de vehículo, QR, manual y audit log."""
import pytest
from apps.acceso.models import RegistroAcceso, AuditLog
from conftest import graphql

REGISTRAR_ACCESO = """
mutation RegistrarAcceso($puntoId: Int!, $codigo: String!, $tipo: String!) {
  registrarAcceso(input: { puntoAccesoId: $puntoId, codigo: $codigo, tipo: $tipo }) {
    id tipo metodoAcceso placaVehiculo
  }
}
"""

REGISTRAR_MANUAL = """
mutation RegistrarManual($puntoId: Int!, $placa: String!, $tipo: String!) {
  registrarAccesoManual(input: { puntoAccesoId: $puntoId, placa: $placa, tipo: $tipo }) {
    id tipo metodoAcceso placaVehiculo
  }
}
"""


@pytest.mark.django_db
def test_acceso_qr_permanente_exitoso(gql_guardia, vehiculo_activo, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" not in r
    data = r["data"]["registrarAcceso"]
    assert data["tipo"] == "entrada"
    assert data["metodoAcceso"] == "qr_permanente"
    assert data["placaVehiculo"] == vehiculo_activo.placa


@pytest.mark.django_db
def test_vehiculo_sancionado_no_puede_entrar(gql_guardia, vehiculo_sancionado, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_sancionado.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "sancionado" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_vehiculo_pendiente_no_puede_entrar(gql_guardia, vehiculo_pendiente, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_pendiente.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "pendiente" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_codigo_desconocido_lanza_error(gql_guardia, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": "CODIGO_QUE_NO_EXISTE",
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "no reconocido" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_tipo_invalido_lanza_error(gql_guardia, vehiculo_activo, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "lateral",  # inválido
    })
    assert "errors" in r
    assert "Tipo inválido" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_acceso_genera_registro_en_bd(gql_guardia, vehiculo_activo, punto_acceso):
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert RegistroAcceso.objects.filter(
        vehiculo=vehiculo_activo, tipo="entrada"
    ).exists()


@pytest.mark.django_db
def test_acceso_genera_audit_log(gql_guardia, vehiculo_activo, punto_acceso):
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert AuditLog.objects.filter(accion="registrar_acceso").exists()


@pytest.mark.django_db
def test_acceso_manual_exitoso(gql_guardia, vehiculo_activo, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "salida",
    })
    assert "errors" not in r
    assert r["data"]["registrarAccesoManual"]["metodoAcceso"] == "manual"


@pytest.mark.django_db
def test_acceso_manual_placa_inexistente(gql_guardia, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": "ZZZ-999",
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "no registrado" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_acceso_manual_genera_audit_log(gql_guardia, vehiculo_activo, punto_acceso):
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "entrada",
    })
    assert AuditLog.objects.filter(accion="acceso_manual").exists()


@pytest.mark.django_db
def test_acceso_manual_bloquea_vehiculo_pendiente(gql_guardia, vehiculo_pendiente, punto_acceso):
    """Un guardia no puede dar acceso manual a un vehículo sin aprobar — security gap cerrado."""
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_pendiente.placa,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "pendiente" in r["errors"][0]["message"].lower()


# ── Guard: entrada duplicada ───────────────────────────────

@pytest.mark.django_db
def test_entrada_duplicada_qr_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """Si un vehículo ya entró sin haber salido, no puede volver a entrar."""
    # Primera entrada — debe funcionar
    r1 = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" not in r1

    # Segunda entrada — debe bloquearse
    r2 = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r2
    assert "ya está dentro" in r2["errors"][0]["message"]


@pytest.mark.django_db
def test_entrada_permitida_despues_de_salida(gql_guardia, vehiculo_activo, punto_acceso):
    """Entrada → Salida → Entrada: flujo válido."""
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    assert "errors" not in r


@pytest.mark.django_db
def test_entrada_duplicada_manual_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """Entrada manual duplicada también debe ser bloqueada."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    assert "errors" in r
    assert "ya está dentro" in r["errors"][0]["message"]
