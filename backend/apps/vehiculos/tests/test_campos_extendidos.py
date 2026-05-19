"""Tests para los campos extendidos del modelo Vehiculo (B1)."""
import pytest
from apps.vehiculos.models import Vehiculo, DocumentoVehiculo
from conftest import graphql

REGISTRAR = """
mutation Registrar($input: CrearVehiculoInput!) {
  registrarVehiculo(input: $input) {
    id placa estado
    numeroMotor numeroChasis numPuertas cilindrada
    colorHex fotoVehiculo numeroSoat capacidadCarga
    documentos { id tipoDoc numero }
  }
}
"""


def _input_base(tipo_vehiculo, admin):
    return {
        "placa": "TST-9999",
        "tipoId": tipo_vehiculo.id,
        "propietarioId": admin.id,
        "marca": "Toyota",
        "modelo": "Corolla",
        "anio": 2022,
        "color": "blanco",
    }


@pytest.mark.django_db
def test_registrar_backward_compatible(gql_admin, tipo_vehiculo, admin):
    """Sin campos nuevos, la mutation sigue funcionando (backward compat)."""
    r = graphql(gql_admin, REGISTRAR, {"input": _input_base(tipo_vehiculo, admin)})
    assert "errors" not in r
    assert r["data"]["registrarVehiculo"]["placa"] == "TST-9999"


@pytest.mark.django_db
def test_color_hex_valido_se_guarda(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "colorHex": "#FF5733"}
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" not in r
    assert r["data"]["registrarVehiculo"]["colorHex"] == "#FF5733"


@pytest.mark.django_db
def test_color_hex_invalido_lanza_error(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "colorHex": "FF5733"}  # falta #
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" in r
    assert "color_hex" in r["errors"][0]["message"].lower() or "#RRGGBB" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_num_puertas_valido_se_guarda(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "numPuertas": 4}
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" not in r
    assert r["data"]["registrarVehiculo"]["numPuertas"] == 4


@pytest.mark.django_db
def test_num_puertas_invalido_lanza_error(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "numPuertas": 7}
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" in r
    assert "num_puertas" in r["errors"][0]["message"].lower() or "2, 3, 4" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_chasis_valido_se_guarda(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "numeroChasis": "ABC1234567890"}
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" not in r
    # El schema almacena en mayúsculas
    assert r["data"]["registrarVehiculo"]["numeroChasis"] == "ABC1234567890"


@pytest.mark.django_db
def test_chasis_muy_corto_lanza_error(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "numeroChasis": "AB1"}  # < 6 chars
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" in r
    assert "chasis" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_soat_sin_fecha_lanza_error(gql_admin, tipo_vehiculo, admin):
    inp = {**_input_base(tipo_vehiculo, admin), "numeroSoat": "SOA-123456"}
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" in r
    assert "soat_fecha_vencimiento" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_soat_con_fecha_crea_documento(gql_admin, tipo_vehiculo, admin):
    inp = {
        **_input_base(tipo_vehiculo, admin),
        "numeroSoat": "SOA-123456",
        "soatFechaVencimiento": "2027-06-30",
    }
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" not in r
    data = r["data"]["registrarVehiculo"]
    assert data["numeroSoat"] == "SOA-123456"
    # Debe haberse creado el documento SOAT automáticamente
    assert any(d["tipoDoc"] == "soat" and d["numero"] == "SOA-123456" for d in data["documentos"])


@pytest.mark.django_db
def test_soat_fecha_invalida_lanza_error(gql_admin, tipo_vehiculo, admin):
    inp = {
        **_input_base(tipo_vehiculo, admin),
        "numeroSoat": "SOA-123456",
        "soatFechaVencimiento": "no-es-fecha",
    }
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" in r
    assert "formato" in r["errors"][0]["message"].lower() or "inválido" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_todos_campos_extendidos_se_guardan(gql_admin, tipo_vehiculo, admin):
    inp = {
        **_input_base(tipo_vehiculo, admin),
        "numeroMotor": "MTR-XYZ789",
        "numeroChasis": "CHASIS123456",
        "numPuertas": 4,
        "cilindrada": "1.6L",
        "colorHex": "#1A2B3C",
        "capacidadCarga": "500kg",
    }
    r = graphql(gql_admin, REGISTRAR, {"input": inp})
    assert "errors" not in r
    d = r["data"]["registrarVehiculo"]
    assert d["numeroMotor"] == "MTR-XYZ789"
    assert d["numeroChasis"] == "CHASIS123456"
    assert d["numPuertas"] == 4
    assert d["cilindrada"] == "1.6L"
    assert d["colorHex"] == "#1A2B3C"
    assert d["capacidadCarga"] == "500kg"
