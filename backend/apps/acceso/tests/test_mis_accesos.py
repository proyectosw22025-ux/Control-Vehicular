"""
Tests de la query mis_accesos.

Verifica que un usuario autenticado pueda consultar su propio historial
de entradas/salidas al campus, filtrado exclusivamente por sus vehículos.
"""
import pytest
from apps.acceso.models import RegistroAcceso, PuntoAcceso
from apps.vehiculos.models import Vehiculo, TipoVehiculo
from conftest import graphql


MIS_ACCESOS = """
query MisAccesos($limite: Int, $tipo: String) {
  misAccesos(limite: $limite, tipo: $tipo) {
    id
    tipo
    timestamp
    puntoNombre
    placaVehiculo
    tipoVehiculo
    marcaModelo
    metodoAcceso
  }
}
"""

MIS_ACCESOS_SIN_FILTRO = """
query {
  misAccesos {
    id tipo timestamp placaVehiculo
  }
}
"""


def _crear_registro(vehiculo, punto, tipo):
    """Crea un RegistroAcceso directamente en BD."""
    return RegistroAcceso.objects.create(
        vehiculo=vehiculo,
        punto_acceso=punto,
        tipo=tipo,
        metodo_acceso="qr_permanente",
        observacion="",
    )


@pytest.mark.django_db
def test_mis_accesos_usuario_ve_solo_sus_registros(
    gql_usuario_normal, vehiculo_activo, punto_acceso
):
    """Un usuario solo recibe los registros de sus propios vehículos."""
    _crear_registro(vehiculo_activo, punto_acceso, "entrada")
    _crear_registro(vehiculo_activo, punto_acceso, "salida")

    r = graphql(gql_usuario_normal, MIS_ACCESOS_SIN_FILTRO)
    assert "errors" not in r
    accesos = r["data"]["misAccesos"]
    assert len(accesos) == 2
    # Ambos deben pertenecer a la placa del vehículo del usuario
    for a in accesos:
        assert a["placaVehiculo"] == vehiculo_activo.placa


@pytest.mark.django_db
def test_mis_accesos_no_retorna_registros_de_otros(
    gql_usuario_normal, usuario_normal, punto_acceso, tipo_vehiculo, password
):
    """El historial no incluye registros de vehículos de otros propietarios."""
    from apps.usuarios.models import Usuario
    otro_usuario = Usuario.objects.create_user(
        ci="99999999", email="otro@test.com",
        nombre="Otro", apellido="Usuario", password=password,
    )
    vehiculo_ajeno = Vehiculo.objects.create(
        placa="AJE-999", tipo=tipo_vehiculo, propietario=otro_usuario,
        marca="Ford", modelo="Ka", anio=2018, color="gris", estado="activo",
    )
    _crear_registro(vehiculo_ajeno, punto_acceso, "entrada")

    r = graphql(gql_usuario_normal, MIS_ACCESOS_SIN_FILTRO)
    assert "errors" not in r
    assert r["data"]["misAccesos"] == []


@pytest.mark.django_db
def test_mis_accesos_sin_autenticacion_lanza_error(gql_client):
    """Un cliente sin token recibe error de autenticación."""
    r = graphql(gql_client, MIS_ACCESOS_SIN_FILTRO)
    assert "errors" in r
    assert "autenticación" in r["errors"][0]["message"].lower() or \
           "autenticacion" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_mis_accesos_filtro_por_tipo_entrada(
    gql_usuario_normal, vehiculo_activo, punto_acceso
):
    """Filtrar por tipo='entrada' retorna solo entradas."""
    _crear_registro(vehiculo_activo, punto_acceso, "entrada")
    _crear_registro(vehiculo_activo, punto_acceso, "salida")
    _crear_registro(vehiculo_activo, punto_acceso, "entrada")

    r = graphql(gql_usuario_normal, MIS_ACCESOS, {"tipo": "entrada"})
    assert "errors" not in r
    accesos = r["data"]["misAccesos"]
    assert len(accesos) == 2
    assert all(a["tipo"] == "entrada" for a in accesos)


@pytest.mark.django_db
def test_mis_accesos_filtro_por_tipo_salida(
    gql_usuario_normal, vehiculo_activo, punto_acceso
):
    """Filtrar por tipo='salida' retorna solo salidas."""
    _crear_registro(vehiculo_activo, punto_acceso, "entrada")
    _crear_registro(vehiculo_activo, punto_acceso, "salida")

    r = graphql(gql_usuario_normal, MIS_ACCESOS, {"tipo": "salida"})
    assert "errors" not in r
    accesos = r["data"]["misAccesos"]
    assert len(accesos) == 1
    assert accesos[0]["tipo"] == "salida"


@pytest.mark.django_db
def test_mis_accesos_retorna_vacio_sin_registros(
    gql_usuario_normal, vehiculo_activo
):
    """Si el usuario no tiene accesos, retorna lista vacía sin error."""
    r = graphql(gql_usuario_normal, MIS_ACCESOS_SIN_FILTRO)
    assert "errors" not in r
    assert r["data"]["misAccesos"] == []


@pytest.mark.django_db
def test_mis_accesos_respeta_limite(
    gql_usuario_normal, vehiculo_activo, punto_acceso
):
    """El parámetro limite trunca correctamente el resultado."""
    for tipo in ["entrada", "salida"] * 5:
        _crear_registro(vehiculo_activo, punto_acceso, tipo)

    r = graphql(gql_usuario_normal, MIS_ACCESOS, {"limite": 3})
    assert "errors" not in r
    assert len(r["data"]["misAccesos"]) == 3


@pytest.mark.django_db
def test_mis_accesos_incluye_campos_vehiculo(
    gql_usuario_normal, vehiculo_activo, punto_acceso
):
    """Los campos tipoVehiculo y marcaModelo están presentes en cada registro."""
    _crear_registro(vehiculo_activo, punto_acceso, "entrada")

    r = graphql(gql_usuario_normal, MIS_ACCESOS)
    assert "errors" not in r
    a = r["data"]["misAccesos"][0]
    assert a["placaVehiculo"] == vehiculo_activo.placa
    # tipoVehiculo puede ser None si el tipo no tiene nombre, pero no debe lanzar error
    assert "tipoVehiculo" in a
    assert "marcaModelo" in a


@pytest.mark.django_db
def test_mis_accesos_admin_ve_solo_sus_propios_vehiculos(
    gql_admin, vehiculo_activo, punto_acceso
):
    """Incluso un admin solo ve los accesos de sus vehículos propios, no todos."""
    _crear_registro(vehiculo_activo, punto_acceso, "entrada")

    r = graphql(gql_admin, MIS_ACCESOS_SIN_FILTRO)
    assert "errors" not in r
    # El admin fixture no es propietario de vehiculo_activo → lista vacía
    assert r["data"]["misAccesos"] == []
