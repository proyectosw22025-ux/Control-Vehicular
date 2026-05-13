"""
Tests del AccesoService — Regla 5 del prompt.

Nota técnica: los tests que llaman a resolver_codigo() usan
@pytest.mark.django_db porque el servicio usa
select_for_update(nowait=True), que requiere transacciones reales
(no savepoints) para funcionar correctamente en PostgreSQL.
"""
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.acceso.services import validar_estado_vehiculo, resolver_codigo
from apps.acceso.models import QrSesion, PaseTemporal
from apps.vehiculos.models import Vehiculo, generar_qr_dinamico


# ── validar_estado_vehiculo (no usa BD) ───────────────────────────────────

@pytest.mark.django_db
def test_vehiculo_activo_no_lanza_excepcion(vehiculo_activo):
    validar_estado_vehiculo(vehiculo_activo)


@pytest.mark.django_db
def test_vehiculo_sancionado_lanza_excepcion(vehiculo_sancionado):
    with pytest.raises(Exception, match="sancionado"):
        validar_estado_vehiculo(vehiculo_sancionado)


@pytest.mark.django_db
def test_vehiculo_pendiente_lanza_excepcion(vehiculo_pendiente):
    with pytest.raises(Exception, match="pendiente"):
        validar_estado_vehiculo(vehiculo_pendiente)


@pytest.mark.django_db
def test_vehiculo_inactivo_lanza_excepcion(db, usuario_normal, tipo_vehiculo):
    v = Vehiculo.objects.create(
        placa="INA-T01", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Test", modelo="Inactivo", anio=2020, color="gris",
        estado="inactivo",
    )
    with pytest.raises(Exception, match="nactivo"):
        validar_estado_vehiculo(v)


# ── TOTP: lógica matemática pura (sin BD) ────────────────────────────────

@pytest.mark.django_db
def test_vehiculo_activo_tiene_qr_secret(vehiculo_activo):
    """Todo vehículo activo debe tener qr_secret generado automáticamente."""
    assert vehiculo_activo.qr_secret
    assert len(vehiculo_activo.qr_secret) == 64


@pytest.mark.django_db
def test_generar_y_validar_totp_vehiculo(vehiculo_activo):
    """El código TOTP generado debe validarse correctamente."""
    from apps.vehiculos.models import validar_qr_dinamico
    codigo, segundos = generar_qr_dinamico(vehiculo_activo.qr_secret)
    assert codigo.isdigit() and len(codigo) == 8
    assert 1 <= segundos <= 30
    assert validar_qr_dinamico(vehiculo_activo.qr_secret, codigo)


@pytest.mark.django_db
def test_totp_de_vehiculo_a_no_valida_vehiculo_b(vehiculo_activo, vehiculo_sancionado):
    """El QR de un vehículo no puede usarse para otro."""
    from apps.vehiculos.models import validar_qr_dinamico
    codigo_a, _ = generar_qr_dinamico(vehiculo_activo.qr_secret)
    assert not validar_qr_dinamico(vehiculo_sancionado.qr_secret, codigo_a)


# ── resolver_codigo con TOTP ───────────────────────────────────────────────

@pytest.mark.django_db
def test_resolver_codigo_totp_exitoso(vehiculo_activo):
    codigo, _ = generar_qr_dinamico(vehiculo_activo.qr_secret)
    resultado = resolver_codigo(codigo)
    assert resultado.vehiculo.pk == vehiculo_activo.pk
    assert resultado.metodo_acceso == "qr_dinamico"


@pytest.mark.django_db
def test_resolver_codigo_totp_invalido_falla():
    """Código que no pertenece a ningún vehículo → no reconocido."""
    with pytest.raises(Exception, match="no reconocido"):
        resolver_codigo("00000000")


@pytest.mark.django_db
def test_resolver_codigo_sancionado_no_encontrado_via_totp(vehiculo_sancionado):
    """
    Por diseño, el servicio solo busca TOTP en vehículos activos.
    Un vehículo sancionado da 'no reconocido' vía TOTP — validar_estado_vehiculo
    se usa cuando el guardia escanea el QR de un vehículo que conoce.
    """
    codigo, _ = generar_qr_dinamico(vehiculo_sancionado.qr_secret)
    with pytest.raises(Exception, match="no reconocido"):
        resolver_codigo(codigo)


# ── resolver_codigo con QR delegación ─────────────────────────────────────

@pytest.mark.django_db
def test_resolver_qr_delegacion_exitoso(vehiculo_activo, admin):
    qr = QrSesion.objects.create(
        vehiculo=vehiculo_activo,
        codigo_hash="DELEG_OK_HASH",
        motivo="Test",
        fecha_expiracion=timezone.now() + timedelta(hours=2),
        generado_por=admin,
    )
    resultado = resolver_codigo("DELEG_OK_HASH")
    assert resultado.metodo_acceso == "qr_delegacion"
    qr.refresh_from_db()
    assert qr.usado is True


@pytest.mark.django_db
def test_resolver_qr_delegacion_ya_usado_falla(vehiculo_activo, admin):
    QrSesion.objects.create(
        vehiculo=vehiculo_activo,
        codigo_hash="DELEG_USADO_HASH",
        motivo="Test ya usado",
        fecha_expiracion=timezone.now() + timedelta(hours=1),
        usado=True,
        generado_por=admin,
    )
    with pytest.raises(Exception, match="no reconocido"):
        resolver_codigo("DELEG_USADO_HASH")


@pytest.mark.django_db
def test_resolver_qr_delegacion_expirado_falla(vehiculo_activo, admin):
    QrSesion.objects.create(
        vehiculo=vehiculo_activo,
        codigo_hash="DELEG_EXP_HASH",
        motivo="Test expirado",
        fecha_expiracion=timezone.now() - timedelta(hours=1),
        generado_por=admin,
    )
    with pytest.raises(Exception, match="expirado"):
        resolver_codigo("DELEG_EXP_HASH")


# ── resolver_codigo con Pase temporal ─────────────────────────────────────

@pytest.mark.django_db
def test_resolver_pase_temporal_exitoso(vehiculo_activo, admin):
    pase = PaseTemporal.objects.create(
        vehiculo=vehiculo_activo,
        codigo="PASE_OK_01",
        valido_desde=timezone.now() - timedelta(hours=1),
        valido_hasta=timezone.now() + timedelta(hours=4),
        usos_max=2,
        generado_por=admin,
    )
    resultado = resolver_codigo("PASE_OK_01")
    assert resultado.metodo_acceso == "pase_temporal"
    pase.refresh_from_db()
    assert pase.usos_actual == 1


@pytest.mark.django_db
def test_resolver_pase_temporal_agotado_falla(vehiculo_activo, admin):
    PaseTemporal.objects.create(
        vehiculo=vehiculo_activo,
        codigo="PASE_AGT_01",
        valido_desde=timezone.now() - timedelta(hours=1),
        valido_hasta=timezone.now() + timedelta(hours=4),
        usos_max=1, usos_actual=1,
        generado_por=admin,
    )
    with pytest.raises(Exception, match="agotado"):
        resolver_codigo("PASE_AGT_01")


@pytest.mark.django_db
def test_resolver_pase_fuera_de_ventana_falla(vehiculo_activo, admin):
    PaseTemporal.objects.create(
        vehiculo=vehiculo_activo,
        codigo="PASE_FUT_01",
        valido_desde=timezone.now() + timedelta(hours=2),
        valido_hasta=timezone.now() + timedelta(hours=4),
        usos_max=2,
        generado_por=admin,
    )
    with pytest.raises(Exception, match="ventana horaria"):
        resolver_codigo("PASE_FUT_01")


@pytest.mark.django_db
def test_codigo_desconocido_falla():
    with pytest.raises(Exception, match="no reconocido"):
        resolver_codigo("XXXXXXXXXXX")
