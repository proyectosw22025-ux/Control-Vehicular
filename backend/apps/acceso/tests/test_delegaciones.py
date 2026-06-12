"""
Tests del módulo Mi Pase QR / Delegaciones.

Verifica el ciclo completo: generar QR temporal, revocar, y la consulta
mis_delegaciones. Incluye checks de seguridad (auth + ownership).
"""
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.acceso.models import QrSesion, AuditLog
from apps.vehiculos.models import Vehiculo
from conftest import graphql


GENERAR_QR = """
mutation GenerarQr($input: GenerarQrDelegacionInput!) {
  generarQrDelegacion(input: $input) {
    id codigoHash motivo fechaExpiracion vigente
  }
}
"""

REVOCAR_QR = """
mutation Revocar($qrId: Int!) {
  revocarQrDelegacion(qrId: $qrId)
}
"""

MIS_DELEGACIONES = """
query {
  misDelegaciones {
    id codigoHash motivo vigente placaVehiculo
  }
}
"""

QR_DELEGACIONES_VEHICULO = """
query QrDelVeh($vehiculoId: Int!) {
  qrDelegacionesVehiculo(vehiculoId: $vehiculoId) {
    id codigoHash vigente
  }
}
"""


# ── Generación ──────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_generar_qr_delegacion_exitoso(gql_usuario_normal, vehiculo_activo):
    r = graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_activo.id, "motivo": "Papá lleva el auto", "horasValidez": 4}
    })
    assert "errors" not in r
    data = r["data"]["generarQrDelegacion"]
    assert data["vigente"] is True
    assert data["motivo"] == "Papá lleva el auto"
    assert QrSesion.objects.filter(id=data["id"]).exists()


@pytest.mark.django_db
def test_generar_qr_requiere_autenticacion(gql_client, vehiculo_activo):
    r = graphql(gql_client, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_activo.id, "motivo": "Test", "horasValidez": 1}
    })
    assert "errors" in r
    assert "autenticación" in r["errors"][0]["message"].lower() or \
           "autenticacion" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_generar_qr_solo_vehiculo_propio(gql_usuario_normal, tipo_vehiculo, password):
    """Un usuario no puede generar QR para el vehículo de otra persona."""
    from apps.usuarios.models import Usuario
    otro = Usuario.objects.create_user(
        ci="77777777", email="otro@test.com",
        nombre="Otro", apellido="Dueño", password=password,
    )
    vehiculo_ajeno = Vehiculo.objects.create(
        placa="AJE-001", tipo=tipo_vehiculo, propietario=otro,
        marca="Ford", modelo="Ka", anio=2020, color="gris", estado="activo",
    )
    r = graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_ajeno.id, "motivo": "Robo de acceso", "horasValidez": 1}
    })
    assert "errors" in r
    assert "propio" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_generar_qr_vehiculo_sancionado_bloqueado(gql_usuario_normal, vehiculo_sancionado):
    r = graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_sancionado.id, "motivo": "Test", "horasValidez": 2}
    })
    assert "errors" in r
    assert "sancionado" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_generar_qr_motivo_obligatorio(gql_usuario_normal, vehiculo_activo):
    r = graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_activo.id, "motivo": "   ", "horasValidez": 1}
    })
    assert "errors" in r
    assert "motivo" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_generar_qr_crea_audit_log(gql_usuario_normal, vehiculo_activo):
    graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_activo.id, "motivo": "Audit test", "horasValidez": 1}
    })
    assert AuditLog.objects.filter(accion="qr_delegacion_generado").exists()


# ── Revocación ──────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_revocar_qr_exitoso(gql_usuario_normal, vehiculo_activo):
    """El propietario puede revocar un QR vigente antes de que sea usado."""
    r_gen = graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_activo.id, "motivo": "Revocar test", "horasValidez": 2}
    })
    qr_id = r_gen["data"]["generarQrDelegacion"]["id"]

    r_rev = graphql(gql_usuario_normal, REVOCAR_QR, {"qrId": qr_id})
    assert "errors" not in r_rev
    assert r_rev["data"]["revocarQrDelegacion"] is True

    # Verificar que ya no aparece en misDelegaciones (expirado)
    qr = QrSesion.objects.get(pk=qr_id)
    assert qr.fecha_expiracion <= timezone.now()


@pytest.mark.django_db
def test_revocar_qr_otro_usuario_bloqueado(gql_usuario_normal, gql_guardia, vehiculo_activo):
    """Un usuario no puede revocar el QR de otra persona (excepto admin/guardia)."""
    from apps.usuarios.models import Usuario
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken

    # Crear otro usuario con su propio vehículo
    otro = Usuario.objects.create_user(
        ci="66666666", email="otrousr@test.com",
        nombre="Otro", apellido="User", password="Pass1234!",
    )
    from apps.vehiculos.models import TipoVehiculo
    tipo = TipoVehiculo.objects.first()
    if not tipo:
        tipo = TipoVehiculo.objects.create(nombre="Auto", descripcion="Automóvil")
    veh_otro = Vehiculo.objects.create(
        placa="OTR-001", tipo=tipo, propietario=otro,
        marca="Kia", modelo="Picanto", anio=2021, color="azul", estado="activo",
    )
    token = str(RefreshToken.for_user(otro).access_token)
    client_otro = Client()
    client_otro.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    # Otro genera un QR
    r_gen = graphql(client_otro, GENERAR_QR, {
        "input": {"vehiculoId": veh_otro.id, "motivo": "QR de otro", "horasValidez": 1}
    })
    qr_id = r_gen["data"]["generarQrDelegacion"]["id"]

    # usuario_normal intenta revocar → debe fallar
    r_rev = graphql(gql_usuario_normal, REVOCAR_QR, {"qrId": qr_id})
    assert "errors" in r_rev
    assert "propio" in r_rev["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_revocar_qr_ya_usado_bloqueado(gql_usuario_normal, vehiculo_activo):
    """No se puede revocar un QR que ya fue escaneado en portería."""
    qr = QrSesion.objects.create(
        vehiculo=vehiculo_activo,
        codigo_hash="abc123usado",
        motivo="Ya usado",
        fecha_expiracion=timezone.now() + timedelta(hours=2),
        usos_max=1, usos_actual=1,  # todos los usos consumidos
    )
    r = graphql(gql_usuario_normal, REVOCAR_QR, {"qrId": qr.id})
    assert "errors" in r
    assert "utilizado" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_revocar_crea_audit_log(gql_usuario_normal, vehiculo_activo):
    r_gen = graphql(gql_usuario_normal, GENERAR_QR, {
        "input": {"vehiculoId": vehiculo_activo.id, "motivo": "Audit rev", "horasValidez": 1}
    })
    qr_id = r_gen["data"]["generarQrDelegacion"]["id"]
    graphql(gql_usuario_normal, REVOCAR_QR, {"qrId": qr_id})
    assert AuditLog.objects.filter(accion="qr_delegacion_revocada").exists()


# ── Consultas ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_mis_delegaciones_retorna_solo_vigentes(gql_usuario_normal, vehiculo_activo):
    """mis_delegaciones no incluye QRs usados ni expirados."""
    # QR vigente
    QrSesion.objects.create(
        vehiculo=vehiculo_activo, codigo_hash="vigente123",
        motivo="Vigente", fecha_expiracion=timezone.now() + timedelta(hours=4),
    )
    # QR usado
    QrSesion.objects.create(
        vehiculo=vehiculo_activo, codigo_hash="usado456",
        motivo="Usado", fecha_expiracion=timezone.now() + timedelta(hours=4), usos_max=1, usos_actual=1,
    )
    # QR expirado
    QrSesion.objects.create(
        vehiculo=vehiculo_activo, codigo_hash="expirado789",
        motivo="Expirado", fecha_expiracion=timezone.now() - timedelta(hours=1),
    )

    r = graphql(gql_usuario_normal, MIS_DELEGACIONES)
    assert "errors" not in r
    delegaciones = r["data"]["misDelegaciones"]
    assert len(delegaciones) == 1
    assert delegaciones[0]["vigente"] is True


@pytest.mark.django_db
def test_mis_delegaciones_requiere_auth(gql_client):
    r = graphql(gql_client, MIS_DELEGACIONES)
    assert "errors" in r


@pytest.mark.django_db
def test_qr_delegaciones_vehiculo_requiere_ownership(gql_usuario_normal, tipo_vehiculo, password):
    from apps.usuarios.models import Usuario
    otro = Usuario.objects.create_user(
        ci="55555555", email="otro2@test.com",
        nombre="Tercero", apellido="Test", password=password,
    )
    veh_ajeno = Vehiculo.objects.create(
        placa="AJE-002", tipo=tipo_vehiculo, propietario=otro,
        marca="Honda", modelo="Fit", anio=2019, color="plata", estado="activo",
    )
    r = graphql(gql_usuario_normal, QR_DELEGACIONES_VEHICULO, {"vehiculoId": veh_ajeno.id})
    assert "errors" in r
    assert "propio" in r["errors"][0]["message"].lower()
