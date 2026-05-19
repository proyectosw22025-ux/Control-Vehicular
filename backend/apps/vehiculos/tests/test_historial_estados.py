"""Tests para VehiculoEstadoHistorial y la señal post_save — Sprint D3."""
import pytest
from apps.vehiculos.models import Vehiculo, VehiculoEstadoHistorial
from conftest import graphql

HISTORIAL_ESTADOS = """
query HistorialEstados($vehiculoId: Int!) {
  historialEstadosVehiculo(vehiculoId: $vehiculoId) {
    id estadoAnterior estadoNuevo motivo fecha usuarioNombre
  }
}
"""

APROBAR = """
mutation Aprobar($id: Int!) {
  aprobarVehiculo(vehiculoId: $id) { id estado }
}
"""


@pytest.mark.django_db
def test_crear_vehiculo_genera_historial(vehiculo_activo):
    """Al crear un vehículo se crea automáticamente un registro de historial."""
    historial = VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_activo)
    assert historial.exists()
    primer_registro = historial.order_by("fecha").first()
    assert primer_registro.estado_nuevo == "activo"
    assert primer_registro.estado_anterior == ""


@pytest.mark.django_db
def test_cambio_estado_genera_historial(gql_admin, vehiculo_pendiente):
    """Al aprobar un vehículo (pendiente→activo) se crea un historial."""
    count_antes = VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_pendiente).count()
    graphql(gql_admin, APROBAR, {"id": vehiculo_pendiente.id})
    count_despues = VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_pendiente).count()
    assert count_despues == count_antes + 1

    ultimo = VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_pendiente).order_by("-fecha").first()
    assert ultimo.estado_anterior == "pendiente"
    assert ultimo.estado_nuevo == "activo"


@pytest.mark.django_db
def test_save_sin_cambio_estado_no_genera_historial(vehiculo_activo):
    """Guardar solo campos no-estado no genera entrada de historial extra."""
    count_antes = VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_activo).count()
    vehiculo_activo.marca = "Cambio de marca"
    vehiculo_activo.save(update_fields=["marca"])
    count_despues = VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_activo).count()
    assert count_despues == count_antes


@pytest.mark.django_db
def test_query_historial_estados_propietario(gql_guardia, vehiculo_pendiente, guardia):
    """El propietario NO puede ver historial de un vehículo ajeno."""
    r = graphql(gql_guardia, HISTORIAL_ESTADOS, {"vehiculoId": vehiculo_pendiente.id})
    assert "errors" in r


@pytest.mark.django_db
def test_query_historial_estados_admin_accede(gql_admin, vehiculo_activo):
    """El admin puede ver el historial de cualquier vehículo."""
    r = graphql(gql_admin, HISTORIAL_ESTADOS, {"vehiculoId": vehiculo_activo.id})
    assert "errors" not in r
    historial = r["data"]["historialEstadosVehiculo"]
    assert len(historial) >= 1
    assert historial[0]["estadoNuevo"] == "activo"


@pytest.mark.django_db
def test_historial_retroactivo_en_vehiculo_existente(vehiculo_activo):
    """Los vehículos migrados tienen al menos un registro retroactivo."""
    assert VehiculoEstadoHistorial.objects.filter(vehiculo=vehiculo_activo).exists()


@pytest.mark.django_db
def test_multiples_cambios_de_estado(gql_admin, vehiculo_pendiente):
    """Aprobar + rechazar genera historial con múltiples entradas."""
    graphql(gql_admin, APROBAR, {"id": vehiculo_pendiente.id})
    # Sancionamos manualmente
    vehiculo_pendiente.refresh_from_db()
    vehiculo_pendiente.estado = "sancionado"
    vehiculo_pendiente.save(update_fields=["estado"])

    historial = list(
        VehiculoEstadoHistorial.objects
        .filter(vehiculo=vehiculo_pendiente)
        .order_by("fecha")
    )
    estados = [h.estado_nuevo for h in historial]
    assert "activo" in estados
    assert "sancionado" in estados
