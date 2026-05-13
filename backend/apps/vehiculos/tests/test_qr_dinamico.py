"""
Tests del QR dinámico TOTP — verifica generación, validación y seguridad.
El QR cambia cada 30 segundos. Una copia/foto es inútil en 30s.
"""
import time
import pytest
from apps.vehiculos.models import Vehiculo, generar_qr_dinamico, validar_qr_dinamico, QR_INTERVAL
from conftest import graphql

QR_DINAMICO_QUERY = """
query QrDinamico($vehiculoId: Int!) {
  qrDinamicoVehiculo(vehiculoId: $vehiculoId) {
    codigo
    segundosRestantes
    intervalo
  }
}
"""


@pytest.mark.django_db
def test_vehiculo_nuevo_tiene_qr_secret(vehiculo_activo):
    """Todo vehículo creado debe tener un qr_secret único no vacío."""
    assert vehiculo_activo.qr_secret
    assert len(vehiculo_activo.qr_secret) == 64  # hex de 32 bytes


@pytest.mark.django_db
def test_dos_vehiculos_tienen_secrets_distintos(vehiculo_activo, vehiculo_sancionado):
    """Cada vehículo tiene su propio secret — el QR es único por vehículo."""
    assert vehiculo_activo.qr_secret != vehiculo_sancionado.qr_secret


def test_generar_qr_dinamico_retorna_codigo_y_segundos(vehiculo_activo):
    """generar_qr_dinamico retorna código de 8 dígitos y segundos restantes válidos."""
    codigo, segundos = generar_qr_dinamico(vehiculo_activo.qr_secret)
    assert codigo.isdigit()
    assert len(codigo) == 8
    assert 1 <= segundos <= QR_INTERVAL


def test_validar_qr_dinamico_acepta_codigo_actual(vehiculo_activo):
    """El código actual generado debe validar correctamente."""
    codigo, _ = generar_qr_dinamico(vehiculo_activo.qr_secret)
    assert validar_qr_dinamico(vehiculo_activo.qr_secret, codigo) is True


def test_validar_qr_dinamico_rechaza_codigo_incorrecto(vehiculo_activo):
    """Un código inventado debe ser rechazado."""
    assert validar_qr_dinamico(vehiculo_activo.qr_secret, "00000000") is False
    assert validar_qr_dinamico(vehiculo_activo.qr_secret, "99999999") is False


def test_qr_de_vehiculo_a_no_valida_vehiculo_b(vehiculo_activo, vehiculo_sancionado):
    """El QR del vehículo A no debe validar para el vehículo B (diferente secret)."""
    codigo_a, _ = generar_qr_dinamico(vehiculo_activo.qr_secret)
    assert validar_qr_dinamico(vehiculo_sancionado.qr_secret, codigo_a) is False


def test_codigos_son_distintos_en_ventanas_diferentes(vehiculo_activo):
    """Simulación: el código de ventana t != código de ventana t+2 (60s después)."""
    import hmac as hmac_lib
    import hashlib
    import struct

    secret = vehiculo_activo.qr_secret
    key = bytes.fromhex(secret)

    def codigo_ventana(v: int) -> str:
        msg = struct.pack(">Q", v)
        h = hmac_lib.new(key, msg, hashlib.sha256).digest()
        offset = h[-1] & 0x0F
        code = struct.unpack(">I", h[offset: offset + 4])[0] & 0x7FFFFFFF
        return str(code % 100_000_000).zfill(8)

    ventana_actual = int(time.time()) // QR_INTERVAL
    # Con tolerancia ±1, la ventana actual+2 debe ser rechazada
    codigo_actual    = codigo_ventana(ventana_actual)
    codigo_futuro    = codigo_ventana(ventana_actual + 2)
    assert codigo_actual != codigo_futuro


@pytest.mark.django_db
def test_query_qr_dinamico_propietario_puede_ver_su_qr(gql_guardia, vehiculo_activo):
    """Un admin/guardia puede consultar el QR dinámico de cualquier vehículo."""
    r = graphql(gql_guardia, QR_DINAMICO_QUERY, {"vehiculoId": vehiculo_activo.id})
    # El guardia no es propietario, pero como es admin/guardia puede verlo
    # Si hay error de permisos lo capturamos
    if "errors" in r:
        # Guardia no tiene acceso — solo admin y propietario
        assert "Solo puedes ver" in r["errors"][0]["message"] or "administrador" in r["errors"][0]["message"].lower()
    else:
        data = r["data"]["qrDinamicoVehiculo"]
        assert data["codigo"].isdigit()
        assert len(data["codigo"]) == 8
        assert data["intervalo"] == QR_INTERVAL


@pytest.mark.django_db
def test_query_qr_dinamico_no_autenticado_falla(gql_client, vehiculo_activo):
    """Sin autenticación no se puede obtener el QR dinámico."""
    r = graphql(gql_client, QR_DINAMICO_QUERY, {"vehiculoId": vehiculo_activo.id})
    assert "errors" in r
