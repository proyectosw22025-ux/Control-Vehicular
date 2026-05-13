"""
Tests de reservas con autorización — Regla 5 del prompt.
"""
import pytest
from django.utils import timezone
from datetime import timedelta
from conftest import graphql
from apps.parqueos.models import EspacioParqueo

CREAR_RESERVA = """
mutation CrearReserva($input: CrearReservaInput!) {
  crearReserva(input: $input) {
    id estado placaVehiculo
    espacio { id numero estado }
  }
}
"""

CANCELAR_RESERVA = """
mutation CancelarReserva($reservaId: Int!) {
  cancelarReserva(reservaId: $reservaId) {
    id estado
    espacio { id estado }
  }
}
"""


def _fechas_futuras(horas_inicio: int = 2, duracion_horas: int = 2) -> dict:
    """Genera fechas futuras en formato ISO sin timezone (naive → Bolivia)."""
    inicio = (timezone.now() + timedelta(hours=horas_inicio)).strftime('%Y-%m-%dT%H:%M:%S')
    fin    = (timezone.now() + timedelta(hours=horas_inicio + duracion_horas)).strftime('%Y-%m-%dT%H:%M:%S')
    return inicio, fin


def _input_reserva(espacio_id: int, vehiculo_id: int) -> dict:
    inicio, fin = _fechas_futuras()
    return {
        "input": {
            "espacioId":  espacio_id,
            "vehiculoId": vehiculo_id,
            "fechaInicio": inicio,
            "fechaFin":    fin,
        }
    }


# ── Autenticación ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_crear_reserva_requiere_autenticacion(gql_client, vehiculo_activo, espacio_disponible):
    r = graphql(gql_client, CREAR_RESERVA, _input_reserva(espacio_disponible.id, vehiculo_activo.id))
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_guardia_no_puede_reservar_vehiculo_ajeno(gql_guardia, vehiculo_activo, espacio_disponible):
    """El guardia no es propietario del vehículo — debe fallar."""
    r = graphql(gql_guardia, CREAR_RESERVA, _input_reserva(espacio_disponible.id, vehiculo_activo.id))
    assert "errors" in r
    assert "propio" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_admin_puede_reservar_cualquier_vehiculo(gql_admin, vehiculo_activo, espacio_disponible):
    r = graphql(gql_admin, CREAR_RESERVA, _input_reserva(espacio_disponible.id, vehiculo_activo.id))
    assert "errors" not in r
    assert r["data"]["crearReserva"]["estado"] == "pendiente"


# ── Estado del espacio ─────────────────────────────────────────────────────

@pytest.mark.django_db
def test_crear_reserva_cambia_espacio_a_reservado(db, gql_admin, vehiculo_activo, espacio_disponible):
    r = graphql(gql_admin, CREAR_RESERVA, _input_reserva(espacio_disponible.id, vehiculo_activo.id))
    assert "errors" not in r
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "reservado"


@pytest.mark.django_db
def test_cancelar_reserva_libera_espacio(db, gql_admin, vehiculo_activo, espacio_disponible):
    r_crear = graphql(gql_admin, CREAR_RESERVA, _input_reserva(espacio_disponible.id, vehiculo_activo.id))
    assert "errors" not in r_crear
    reserva_id = r_crear["data"]["crearReserva"]["id"]

    r_cancelar = graphql(gql_admin, CANCELAR_RESERVA, {"reservaId": reserva_id})
    assert "errors" not in r_cancelar
    assert r_cancelar["data"]["cancelarReserva"]["estado"] == "cancelada"

    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "disponible"


# ── Control de propietario ─────────────────────────────────────────────────

@pytest.mark.django_db
def test_cancelar_reserva_requiere_ser_propietario(db, gql_guardia, gql_admin,
                                                    zona, categoria_espacio, vehiculo_activo):
    """Guardia intenta cancelar reserva de un vehículo que no es suyo."""
    # Crear espacio fresco en este test para evitar conflicto de estado
    espacio = EspacioParqueo.objects.create(
        zona=zona, categoria=categoria_espacio, numero="Z99", estado="disponible"
    )
    r_crear = graphql(gql_admin, CREAR_RESERVA, _input_reserva(espacio.id, vehiculo_activo.id))
    assert "errors" not in r_crear
    reserva_id = r_crear["data"]["crearReserva"]["id"]

    r_cancelar = graphql(gql_guardia, CANCELAR_RESERVA, {"reservaId": reserva_id})
    assert "errors" in r_cancelar
    assert "propias" in r_cancelar["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_admin_puede_cancelar_cualquier_reserva(db, gql_admin, vehiculo_activo, zona, categoria_espacio):
    espacio = EspacioParqueo.objects.create(
        zona=zona, categoria=categoria_espacio, numero="Z98", estado="disponible"
    )
    r = graphql(gql_admin, CREAR_RESERVA, _input_reserva(espacio.id, vehiculo_activo.id))
    reserva_id = r["data"]["crearReserva"]["id"]
    r_c = graphql(gql_admin, CANCELAR_RESERVA, {"reservaId": reserva_id})
    assert "errors" not in r_c


# ── Validaciones de negocio ────────────────────────────────────────────────

@pytest.mark.django_db
def test_no_se_puede_reservar_espacio_ocupado(gql_admin, vehiculo_activo, espacio_ocupado):
    r = graphql(gql_admin, CREAR_RESERVA, _input_reserva(espacio_ocupado.id, vehiculo_activo.id))
    assert "errors" in r
    assert "disponible" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_no_se_puede_reservar_en_el_pasado(gql_admin, vehiculo_activo, espacio_disponible):
    """La fecha de inicio en el pasado lejano debe fallar siempre, sin ambigüedad de timezone."""
    r = graphql(gql_admin, CREAR_RESERVA, {
        "input": {
            "espacioId":   espacio_disponible.id,
            "vehiculoId":  vehiculo_activo.id,
            "fechaInicio": "2000-01-01T00:00:00",  # siempre en el pasado
            "fechaFin":    "2000-01-01T02:00:00",
        }
    })
    assert "errors" in r
    assert "futuro" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_fecha_fin_debe_ser_posterior_a_inicio(gql_admin, vehiculo_activo, espacio_disponible):
    inicio = (timezone.now() + timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S')
    fin    = (timezone.now() + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S')
    r = graphql(gql_admin, CREAR_RESERVA, {
        "input": {
            "espacioId":   espacio_disponible.id,
            "vehiculoId":  vehiculo_activo.id,
            "fechaInicio": inicio,
            "fechaFin":    fin,
        }
    })
    assert "errors" in r
    assert "posterior" in r["errors"][0]["message"].lower()
