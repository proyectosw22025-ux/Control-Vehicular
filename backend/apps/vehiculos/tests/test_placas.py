"""
Tests de normalización y unicidad de placas (formato canónico boliviano).

Regla de negocio: toda placa se almacena como "ABC-1234" (2-3 letras + guion
+ 3-4 dígitos + letra opcional), y la unicidad ignora separadores — "ZYX123"
y "ZYX-123" son EL MISMO vehículo físico y no pueden coexistir.
"""
import pytest
from apps.vehiculos.models import Vehiculo
from apps.vehiculos.utils import normalizar_placa, placa_comparable
from conftest import graphql

REGISTRAR = """
mutation Registrar($input: CrearVehiculoInput!) {
  registrarVehiculo(input: $input) { id placa estado }
}
"""


def _input(tipo_vehiculo, admin, placa):
    return {
        "placa": placa,
        "tipoId": tipo_vehiculo.id,
        "propietarioId": admin.id,
        "marca": "Toyota",
        "modelo": "Corolla",
        "anio": 2022,
        "color": "blanco",
    }


# ── Unidad: el helper ─────────────────────────────────────────────────────────

class TestNormalizarPlaca:
    def test_sin_guion_agrega_guion(self):
        assert normalizar_placa("ZYX123") == "ZYX-123"

    def test_con_guion_se_mantiene(self):
        assert normalizar_placa("ABC-1234") == "ABC-1234"

    def test_minusculas_y_espacios(self):
        assert normalizar_placa("  scz 3456 ") == "SCZ-3456"

    def test_letra_final_se_conserva(self):
        assert normalizar_placa("LP1234A") == "LP-1234A"

    def test_formato_invalido_lanza_error(self):
        for invalida in ["", "123456", "ABCDE", "A-1", "ABCD-12345"]:
            with pytest.raises(ValueError):
                normalizar_placa(invalida)

    def test_comparable_quita_todo_separador(self):
        assert placa_comparable("Z y-X. 12 3") == "ZYX123"


# ── Integración: la mutación de registro ─────────────────────────────────────

@pytest.mark.django_db
def test_placa_se_almacena_canonica(gql_admin, tipo_vehiculo, admin):
    """Entra 'zyx 123', se guarda 'ZYX-123'."""
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "zyx 123")})
    assert "errors" not in r
    assert r["data"]["registrarVehiculo"]["placa"] == "ZYX-123"


@pytest.mark.django_db
def test_duplicado_con_guion_distinto_rechazado(gql_admin, tipo_vehiculo, admin, usuario_normal):
    """El escenario del plan: 'ZYX123' ya existe → 'ZYX-123' NO puede registrarse
    como segundo vehículo. Antes ambas variantes coexistían con dueños distintos."""
    Vehiculo.objects.create(
        placa="ZYX123",  # formato viejo, sin canonicalizar (directo a BD)
        tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2021, color="blanco", estado="activo",
    )
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "ZYX-123")})
    assert "errors" in r
    assert "ya está registrada" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_formato_invalido_rechazado_con_mensaje_claro(gql_admin, tipo_vehiculo, admin):
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "PLACA-FALSA")})
    assert "errors" in r
    assert "Formato de placa inválido" in r["errors"][0]["message"]
