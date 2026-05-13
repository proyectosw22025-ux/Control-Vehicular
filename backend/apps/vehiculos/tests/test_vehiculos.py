"""Tests de vehículos: aprobación, rechazo, visibilidad de pendientes y audit log."""
import pytest
from apps.vehiculos.models import Vehiculo
from apps.acceso.models import AuditLog
from conftest import graphql

APROBAR = """
mutation Aprobar($id: Int!) {
  aprobarVehiculo(vehiculoId: $id) {
    id estado placa
  }
}
"""

RECHAZAR = """
mutation Rechazar($id: Int!, $motivo: String!) {
  rechazarVehiculo(vehiculoId: $id, motivo: $motivo) {
    id estado placa
  }
}
"""

VEHICULOS = """
query Vehiculos($propietarioId: Int) {
  vehiculos(propietarioId: $propietarioId) {
    items { id placa estado }
  }
}
"""


@pytest.mark.django_db
def test_aprobar_vehiculo_cambia_estado(gql_admin, vehiculo_pendiente):
    r = graphql(gql_admin, APROBAR, {"id": vehiculo_pendiente.id})
    assert "errors" not in r
    assert r["data"]["aprobarVehiculo"]["estado"] == "activo"
    vehiculo_pendiente.refresh_from_db()
    assert vehiculo_pendiente.estado == "activo"


@pytest.mark.django_db
def test_rechazar_vehiculo_cambia_estado_a_inactivo(gql_admin, vehiculo_pendiente):
    r = graphql(gql_admin, RECHAZAR, {"id": vehiculo_pendiente.id, "motivo": "Documentación incompleta"})
    assert "errors" not in r
    assert r["data"]["rechazarVehiculo"]["estado"] == "inactivo"
    vehiculo_pendiente.refresh_from_db()
    assert vehiculo_pendiente.estado == "inactivo"


@pytest.mark.django_db
def test_aprobar_vehiculo_no_pendiente_lanza_error(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, APROBAR, {"id": vehiculo_activo.id})
    assert "errors" in r
    assert "nválida" in r["errors"][0]["message"]  # máquina de estados: activo→activo no permitido


@pytest.mark.django_db
def test_aprobar_vehiculo_genera_audit_log(gql_admin, vehiculo_pendiente):
    graphql(gql_admin, APROBAR, {"id": vehiculo_pendiente.id})
    assert AuditLog.objects.filter(accion="vehiculo_aprobado").exists()


@pytest.mark.django_db
def test_rechazar_vehiculo_genera_audit_log(gql_admin, vehiculo_pendiente):
    graphql(gql_admin, RECHAZAR, {"id": vehiculo_pendiente.id, "motivo": "Test"})
    assert AuditLog.objects.filter(accion="vehiculo_rechazado").exists()


@pytest.mark.django_db
def test_propietario_ve_su_propio_vehiculo_pendiente(gql_guardia, usuario_normal, vehiculo_pendiente):
    """El dueño debe ver su vehículo pendiente en la lista aunque no sea admin."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    client = Client()
    token = str(RefreshToken.for_user(usuario_normal).access_token)
    client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    r = graphql(client, VEHICULOS, {"propietarioId": usuario_normal.id})
    assert "errors" not in r
    placas = [v["placa"] for v in r["data"]["vehiculos"]["items"]]
    assert vehiculo_pendiente.placa in placas


@pytest.mark.django_db
def test_no_admin_no_ve_pendientes_ajenos(gql_guardia, vehiculo_pendiente, usuario_normal):
    """Un guardia no debe ver vehículos pendientes de otros propietarios."""
    from apps.usuarios.models import Usuario
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    otro = Usuario.objects.create_user(
        ci="99999999", email="otro@test.com",
        nombre="Otro", apellido="Usuario", password="pass123"
    )
    client = Client()
    token = str(RefreshToken.for_user(otro).access_token)
    client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    r = graphql(client, VEHICULOS, {"propietarioId": usuario_normal.id})
    assert "errors" not in r
    # Otro usuario no debe ver el pendiente de usuario_normal
    placas = [v["placa"] for v in r["data"]["vehiculos"]["items"]]
    assert vehiculo_pendiente.placa not in placas
