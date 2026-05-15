"""Tests del login: credenciales, usuario inactivo, rate limiting y audit log."""
import pytest
from django.core.cache import cache
from apps.acceso.models import AuditLog
from conftest import graphql

LOGIN = """
mutation Login($ci: String!, $password: String!) {
  login(input: { ci: $ci, password: $password }) {
    access
    refresh
    usuario { id ci nombreCompleto }
  }
}
"""


@pytest.fixture(autouse=True)
def limpiar_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_login_exitoso(gql_client, usuario_normal, password):
    r = graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert "errors" not in r
    assert r["data"]["login"]["access"]
    assert r["data"]["login"]["usuario"]["ci"] == usuario_normal.ci


@pytest.mark.django_db
def test_login_credenciales_invalidas(gql_client):
    r = graphql(gql_client, LOGIN, {"ci": "99999", "password": "mal"})
    assert "errors" in r
    assert "inválidas" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_login_usuario_inactivo(gql_client, usuario_normal, password):
    usuario_normal.is_active = False
    usuario_normal.save()
    r = graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert "errors" in r
    assert "inactivo" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_rate_limiting_bloquea_al_6to_intento(gql_client):
    for _ in range(5):
        graphql(gql_client, LOGIN, {"ci": "00000", "password": "mal"})
    r = graphql(gql_client, LOGIN, {"ci": "00000", "password": "mal"})
    assert "errors" in r
    assert "Demasiados intentos" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_rate_limiting_se_resetea_con_login_exitoso(gql_client, usuario_normal, password):
    # 4 intentos fallidos
    for _ in range(4):
        graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": "mal"})
    # login exitoso: debe resetear el contador
    r = graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert "errors" not in r
    assert r["data"]["login"]["access"]


@pytest.mark.django_db
def test_login_exitoso_genera_audit_log(gql_client, usuario_normal, password):
    graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert AuditLog.objects.filter(accion="login_exitoso").exists()


@pytest.mark.django_db
def test_login_fallido_genera_audit_log(gql_client):
    graphql(gql_client, LOGIN, {"ci": "00000", "password": "mal"})
    assert AuditLog.objects.filter(accion="login_fallido").exists()


# ── Tests de doble factor (2FA / TOTP) ─────────────────────────────────────

LOGIN_CON_TOTP = """
mutation Login($ci: String!, $password: String!, $codigo: String) {
  login(input: { ci: $ci, password: $password, codigoTotp: $codigo }) {
    access
    usuario { id ci }
  }
}
"""

INICIAR_2FA = """
mutation {
  iniciarConfiguracion2fa { otpauthUrl secretBase32 }
}
"""

VERIFICAR_2FA = """
mutation Verificar($codigo: String!) {
  verificarConfiguracion2fa(codigo: $codigo) { ok mensaje }
}
"""

DESACTIVAR_2FA = """
mutation Desactivar($codigo: String!) {
  desactivar2fa(codigo: $codigo) { ok mensaje }
}
"""


@pytest.mark.django_db
def test_login_sin_2fa_funciona_normal(gql_client, usuario_normal, password):
    """Un usuario sin 2FA activo inicia sesión normalmente con CI+password."""
    r = graphql(gql_client, LOGIN_CON_TOTP, {"ci": usuario_normal.ci, "password": password, "codigo": None})
    assert "errors" not in r
    assert r["data"]["login"]["access"]


@pytest.mark.django_db
def test_login_con_2fa_activo_pide_codigo(gql_client, usuario_normal, password):
    """Si el usuario tiene 2FA activo y no envía código, el backend responde 2FA_REQUIRED."""
    import pyotp
    usuario_normal.totp_secret = pyotp.random_base32()
    usuario_normal.totp_activo = True
    usuario_normal.save()

    r = graphql(gql_client, LOGIN_CON_TOTP, {"ci": usuario_normal.ci, "password": password, "codigo": None})
    assert "errors" in r
    assert "2FA_REQUIRED" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_login_con_2fa_codigo_correcto(gql_client, usuario_normal, password):
    """Con el código TOTP correcto, el login completa y emite JWT."""
    import pyotp
    secret = pyotp.random_base32()
    usuario_normal.totp_secret = secret
    usuario_normal.totp_activo = True
    usuario_normal.save()

    codigo_valido = pyotp.TOTP(secret).now()
    r = graphql(gql_client, LOGIN_CON_TOTP, {"ci": usuario_normal.ci, "password": password, "codigo": codigo_valido})
    assert "errors" not in r
    assert r["data"]["login"]["access"]


@pytest.mark.django_db
def test_login_con_2fa_codigo_incorrecto(gql_client, usuario_normal, password):
    """Con código TOTP incorrecto, el login falla."""
    import pyotp
    usuario_normal.totp_secret = pyotp.random_base32()
    usuario_normal.totp_activo = True
    usuario_normal.save()

    r = graphql(gql_client, LOGIN_CON_TOTP, {"ci": usuario_normal.ci, "password": password, "codigo": "000000"})
    assert "errors" in r
    assert "incorrecto" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_activar_y_desactivar_2fa(gql_admin, admin):
    """Flujo completo: iniciar → verificar con código real → desactivar."""
    import pyotp

    # Paso 1: obtener QR y secreto
    r1 = graphql(gql_admin, INICIAR_2FA, {})
    assert "errors" not in r1
    secreto = r1["data"]["iniciarConfiguracion2fa"]["secretBase32"]
    assert len(secreto) > 0

    # Paso 2: verificar con código TOTP generado del secreto real
    codigo = pyotp.TOTP(secreto).now()
    r2 = graphql(gql_admin, VERIFICAR_2FA, {"codigo": codigo})
    assert "errors" not in r2
    assert r2["data"]["verificarConfiguracion2fa"]["ok"] is True

    # El admin ahora tiene 2FA activo
    admin.refresh_from_db()
    assert admin.totp_activo is True

    # Paso 3: desactivar con código válido
    codigo2 = pyotp.TOTP(admin.totp_secret).now()
    r3 = graphql(gql_admin, DESACTIVAR_2FA, {"codigo": codigo2})
    assert "errors" not in r3
    admin.refresh_from_db()
    assert admin.totp_activo is False
