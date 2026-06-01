"""
Tests de la Pre-autorización de Acceso Externo para Proveedores.

Verifica:
  - Admin/guardia puede crear autorizaciones con dependencia y email
  - Código único generado en cada autorización
  - El resolver_codigo Level 4 valida vigencia y optimistic locking
  - Sin solapamiento de autorizaciones para la misma placa/período
  - La query verificarAutorizacionExterna es pública (sin auth)
  - Revocación solo por admin/guardia
  - Estado calculado correctamente (vigente/pendiente/vencida/usada/revocada)
"""
import json
import pytest
from datetime import timedelta
from django.utils import timezone
from unittest.mock import patch

from apps.acceso.models import AutorizacionAccesoExterno
from apps.acceso.services import resolver_codigo


# ── Helper ────────────────────────────────────────────────────────────────────

CREAR_GQL = """
mutation CrearAutorizacionExterna(
  $placa: String! $empresa: String! $motivo: String!
  $validoDesde: String! $validoHasta: String!
  $dependenciaId: Int $emailProveedor: String
) {
  crearAutorizacionExterna(
    placa: $placa empresa: $empresa motivo: $motivo
    validoDesde: $validoDesde validoHasta: $validoHasta
    dependenciaId: $dependenciaId emailProveedor: $emailProveedor
  ) {
    id placa empresa codigoAcceso estado vigente emailEnviado urlVerificacion
  }
}
"""

VERIFICAR_GQL = """
query VerificarAutorizacionExterna($codigo: String!) {
  verificarAutorizacionExterna(codigo: $codigo) {
    id placa empresa estado vigente dependenciaNombre
  }
}
"""

REVOCAR_GQL = """
mutation RevocarAutorizacionExterna($authId: Int!) {
  revocarAutorizacionExterna(authId: $authId) { id activo estado }
}
"""


def gql(client, query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    return client.post(
        "/graphql/",
        data=json.dumps(payload),
        content_type="application/json",
    ).json()


def _iso(dt) -> str:
    return dt.isoformat()


# ── Tests de creación ─────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestCrearAutorizacion:

    def test_admin_crea_autorizacion_exitosamente(self, gql_admin):
        desde = timezone.now() + timedelta(hours=1)
        hasta = timezone.now() + timedelta(hours=5)
        with patch("apps.acceso.schema._enviar_email_autorizacion_async"):
            data = gql(gql_admin, CREAR_GQL, {
                "placa": "PRV-001", "empresa": "Dist. Alimentos SA",
                "motivo": "Entrega de insumos cafetería",
                "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
            })
        assert "errors" not in data, data.get("errors")
        r = data["data"]["crearAutorizacionExterna"]
        assert r["placa"] == "PRV-001"
        assert r["empresa"] == "Dist. Alimentos SA"
        assert len(r["codigoAcceso"]) == 20
        assert "/autorizacion/" in r["urlVerificacion"]
        assert r["estado"] == "pendiente"  # no empieza hasta 'desde'

    def test_placa_normalizada_a_mayusculas(self, gql_admin):
        desde = timezone.now() + timedelta(minutes=1)
        hasta = timezone.now() + timedelta(hours=2)
        with patch("apps.acceso.schema._enviar_email_autorizacion_async"):
            data = gql(gql_admin, CREAR_GQL, {
                "placa": "prv-099", "empresa": "Test", "motivo": "Test",
                "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
            })
        assert data["data"]["crearAutorizacionExterna"]["placa"] == "PRV-099"

    def test_estudiante_no_puede_crear(self, gql_usuario_normal):
        desde = timezone.now() + timedelta(hours=1)
        hasta = timezone.now() + timedelta(hours=3)
        data = gql(gql_usuario_normal, CREAR_GQL, {
            "placa": "EST-001", "empresa": "Empresa", "motivo": "Motivo",
            "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
        })
        assert "errors" in data

    def test_no_permite_autorizacion_para_fecha_pasada(self, gql_admin):
        desde = timezone.now() - timedelta(hours=2)
        hasta = timezone.now() - timedelta(hours=1)
        data = gql(gql_admin, CREAR_GQL, {
            "placa": "OLD-001", "empresa": "Test", "motivo": "Test",
            "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
        })
        assert "errors" in data

    def test_no_permite_solapamiento_de_placa(self, gql_admin):
        desde = timezone.now() + timedelta(hours=1)
        hasta  = timezone.now() + timedelta(hours=6)
        with patch("apps.acceso.schema._enviar_email_autorizacion_async"):
            gql(gql_admin, CREAR_GQL, {
                "placa": "DUP-001", "empresa": "Empresa A", "motivo": "Entrega",
                "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
            })
            data = gql(gql_admin, CREAR_GQL, {
                "placa": "DUP-001", "empresa": "Empresa B", "motivo": "Otro",
                "validoDesde": _iso(desde + timedelta(hours=1)),
                "validoHasta": _iso(hasta),
            })
        assert "errors" in data

    def test_vigencia_maxima_7_dias(self, gql_admin):
        desde = timezone.now() + timedelta(hours=1)
        hasta  = timezone.now() + timedelta(days=10)
        data = gql(gql_admin, CREAR_GQL, {
            "placa": "MAX-001", "empresa": "Test", "motivo": "Test",
            "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
        })
        assert "errors" in data
        assert "7 días" in data["errors"][0]["message"]

    def test_email_enviado_cuando_hay_email(self, gql_admin):
        desde = timezone.now() + timedelta(hours=1)
        hasta  = timezone.now() + timedelta(hours=3)
        with patch("apps.acceso.schema._enviar_email_autorizacion_async") as mock_email:
            data = gql(gql_admin, CREAR_GQL, {
                "placa": "EMAIL-01", "empresa": "Test Corp", "motivo": "Servicio",
                "validoDesde": _iso(desde), "validoHasta": _iso(hasta),
                "emailProveedor": "proveedor@test.com",
            })
        assert data["data"]["crearAutorizacionExterna"]["emailEnviado"] is True
        mock_email.assert_called_once()


# ── Tests del resolver_codigo (Level 4) ───────────────────────────────────────

@pytest.mark.django_db
class TestResolverCodigoAutorizacion:

    @pytest.fixture
    def auth_vigente(self, db, admin):
        return AutorizacionAccesoExterno.objects.create(
            placa="TST-001",
            empresa="Test Provider",
            motivo="Entrega",
            autorizado_por=admin,
            valido_desde=timezone.now() - timedelta(minutes=5),
            valido_hasta=timezone.now() + timedelta(hours=4),
            codigo_acceso="TESTCODE0000000001",
            activo=True, usado=False,
        )

    def test_resolver_acepta_codigo_vigente(self, auth_vigente):
        resultado = resolver_codigo("TESTCODE0000000001")
        assert resultado.metodo_acceso == "temporal"
        assert resultado.vehiculo is None
        assert resultado.autorizacion_externa.pk == auth_vigente.pk

        auth_vigente.refresh_from_db()
        assert auth_vigente.usado is True

    def test_resolver_rechaza_codigo_vencido(self, db, admin):
        auth = AutorizacionAccesoExterno.objects.create(
            placa="EXP-001", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() - timedelta(hours=4),
            valido_hasta=timezone.now() - timedelta(hours=1),
            codigo_acceso="VENCIDOCODE000001",
            activo=True, usado=False,
        )
        with pytest.raises(Exception, match="vencido|vencida"):
            resolver_codigo("VENCIDOCODE000001")

    def test_resolver_rechaza_codigo_pendiente(self, db, admin):
        auth = AutorizacionAccesoExterno.objects.create(
            placa="PEN-001", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() + timedelta(hours=2),
            valido_hasta=timezone.now() + timedelta(hours=5),
            codigo_acceso="PENDIENTECODE0001",
            activo=True, usado=False,
        )
        with pytest.raises(Exception, match="no válida|pendiente"):
            resolver_codigo("PENDIENTECODE0001")

    def test_resolver_rechaza_codigo_ya_usado(self, db, admin):
        AutorizacionAccesoExterno.objects.create(
            placa="USA-001", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() - timedelta(hours=1),
            valido_hasta=timezone.now() + timedelta(hours=3),
            codigo_acceso="USADOCODE00000001",
            activo=True, usado=True,
        )
        with pytest.raises(Exception, match="utilizada|no reconocido"):
            resolver_codigo("USADOCODE00000001")

    def test_optimistic_lock_previene_doble_uso(self, auth_vigente):
        """Dos guardias intentan usar el mismo código simultáneamente — solo uno pasa."""
        resolver_codigo("TESTCODE0000000001")
        with pytest.raises(Exception):
            resolver_codigo("TESTCODE0000000001")


# ── Tests de queries públicas ─────────────────────────────────────────────────

@pytest.mark.django_db
class TestVerificarAutorizacionPublica:

    def test_query_publica_sin_autenticacion(self, gql_client, db, admin):
        auth = AutorizacionAccesoExterno.objects.create(
            placa="PUB-001", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() - timedelta(minutes=10),
            valido_hasta=timezone.now() + timedelta(hours=2),
            codigo_acceso="PUBLICCODE000001",
            activo=True, usado=False,
        )
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "PUBLICCODE000001"})
        assert "errors" not in data, data.get("errors")
        r = data["data"]["verificarAutorizacionExterna"]
        assert r["placa"] == "PUB-001"
        assert r["vigente"] is True
        assert r["estado"] == "vigente"

    def test_codigo_inexistente_retorna_null(self, gql_client):
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "NOEXISTE0000000"})
        assert "errors" not in data
        assert data["data"]["verificarAutorizacionExterna"] is None

    def test_estado_calculado_correctamente(self, gql_client, db, admin):
        auth = AutorizacionAccesoExterno.objects.create(
            placa="EST-002", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() - timedelta(hours=3),
            valido_hasta=timezone.now() - timedelta(hours=1),
            codigo_acceso="VENCEDOCODE00002",
            activo=True, usado=False,
        )
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "VENCEDOCODE00002"})
        r = data["data"]["verificarAutorizacionExterna"]
        assert r["estado"] == "vencida"
        assert r["vigente"] is False


# ── Tests de revocación ───────────────────────────────────────────────────────

@pytest.mark.django_db
class TestRevocarAutorizacion:

    def test_admin_revoca_autorizacion(self, gql_admin, db, admin):
        auth = AutorizacionAccesoExterno.objects.create(
            placa="REV-001", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() + timedelta(hours=1),
            valido_hasta=timezone.now() + timedelta(hours=3),
            codigo_acceso="REVOCARCODE0001",
            activo=True, usado=False,
        )
        data = gql(gql_admin, REVOCAR_GQL, {"authId": auth.pk})
        assert "errors" not in data, data.get("errors")
        r = data["data"]["revocarAutorizacionExterna"]
        assert r["activo"] is False
        assert r["estado"] == "revocada"

    def test_estudiante_no_puede_revocar(self, gql_usuario_normal, db, admin):
        auth = AutorizacionAccesoExterno.objects.create(
            placa="REV-002", empresa="Test", motivo="Test",
            autorizado_por=admin,
            valido_desde=timezone.now() + timedelta(hours=1),
            valido_hasta=timezone.now() + timedelta(hours=3),
            codigo_acceso="REVOCARCODE0002",
            activo=True, usado=False,
        )
        data = gql(gql_usuario_normal, REVOCAR_GQL, {"authId": auth.pk})
        assert "errors" in data
