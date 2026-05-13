"""
Tests de transferencia de vehículo — cambio de propietario con historial.
"""
import pytest
from apps.vehiculos.models import Vehiculo, HistorialPropietario
from apps.usuarios.models import Usuario
from conftest import graphql

TRANSFERIR = """
mutation Transferir($vehiculoId: Int!, $nuevoPropietarioId: Int!) {
  transferirVehiculo(vehiculoId: $vehiculoId, nuevoPropietarioId: $nuevoPropietarioId) {
    id placa propietarioNombre
  }
}
"""


@pytest.fixture
def usuario_destino(db, password):
    return Usuario.objects.create_user(
        ci="DEST001", email="destino@test.com",
        nombre="Destino", apellido="Propietario", password=password,
    )


@pytest.mark.django_db
def test_transferencia_exitosa(gql_admin, vehiculo_activo, usuario_destino):
    """Admin puede transferir vehículo a otro propietario."""
    r = graphql(gql_admin, TRANSFERIR, {
        "vehiculoId": vehiculo_activo.id,
        "nuevoPropietarioId": usuario_destino.id,
    })
    assert "errors" not in r
    assert "Destino" in r["data"]["transferirVehiculo"]["propietarioNombre"]


@pytest.mark.django_db
def test_transferencia_crea_historial(db, gql_admin, vehiculo_activo, usuario_destino):
    """La transferencia cierra el historial anterior y crea uno nuevo."""
    from django.utils import timezone
    propietario_original = vehiculo_activo.propietario

    # Crear historial inicial del propietario original (como lo haría registrar_vehiculo)
    HistorialPropietario.objects.create(
        vehiculo=vehiculo_activo,
        usuario=propietario_original,
        fecha_inicio=timezone.now().date(),
    )

    graphql(gql_admin, TRANSFERIR, {
        "vehiculoId": vehiculo_activo.id,
        "nuevoPropietarioId": usuario_destino.id,
    })

    # Historial del propietario original debe tener fecha_fin
    hist_anterior = HistorialPropietario.objects.filter(
        vehiculo=vehiculo_activo, usuario=propietario_original
    ).first()
    assert hist_anterior is not None
    assert hist_anterior.fecha_fin is not None

    # Historial del nuevo propietario sin fecha_fin (dueño actual)
    hist_nuevo = HistorialPropietario.objects.filter(
        vehiculo=vehiculo_activo, usuario=usuario_destino, fecha_fin__isnull=True
    ).first()
    assert hist_nuevo is not None


@pytest.mark.django_db
def test_transferencia_actualiza_propietario_en_bd(gql_admin, vehiculo_activo, usuario_destino):
    """Después de la transferencia, el propietario del vehículo en BD es el nuevo."""
    graphql(gql_admin, TRANSFERIR, {
        "vehiculoId": vehiculo_activo.id,
        "nuevoPropietarioId": usuario_destino.id,
    })
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.propietario_id == usuario_destino.id


@pytest.mark.django_db
def test_guardia_no_puede_transferir(gql_guardia, vehiculo_activo, usuario_destino):
    """Solo administradores pueden transferir vehículos."""
    r = graphql(gql_guardia, TRANSFERIR, {
        "vehiculoId": vehiculo_activo.id,
        "nuevoPropietarioId": usuario_destino.id,
    })
    assert "errors" in r
    assert "administrador" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_transferencia_a_mismo_propietario_falla(gql_admin, vehiculo_activo):
    """Transferir al mismo propietario actual debe lanzar error."""
    r = graphql(gql_admin, TRANSFERIR, {
        "vehiculoId": vehiculo_activo.id,
        "nuevoPropietarioId": vehiculo_activo.propietario_id,
    })
    assert "errors" in r
    assert "ya pertenece" in r["errors"][0]["message"].lower()
