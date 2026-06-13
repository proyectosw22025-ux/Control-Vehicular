"""
Tests de normalización y unicidad de placas (formato canónico boliviano).

Regla de negocio: toda placa se almacena como "ABC-1234" (2-3 letras + guion
+ 3-4 dígitos + letra opcional), y la unicidad ignora separadores — "ZYX123"
y "ZYX-123" son EL MISMO vehículo físico y no pueden coexistir.
"""
import pytest
from apps.vehiculos.models import Vehiculo
from apps.vehiculos.utils import normalizar_placa, placa_comparable, placas_cercanas
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
    """Formato vigente: 3-4 números + 3 letras → '1234-ABC'."""

    def test_sin_guion_agrega_guion(self):
        assert normalizar_placa("1234ABC") == "1234-ABC"

    def test_con_guion_se_mantiene(self):
        assert normalizar_placa("1234-ABC") == "1234-ABC"

    def test_minusculas_y_espacios(self):
        assert normalizar_placa("  1234 abc ") == "1234-ABC"

    def test_tres_digitos(self):
        assert normalizar_placa("123XYZ") == "123-XYZ"

    def test_formato_invalido_lanza_error(self):
        # Inválidos: vacío, solo números, letras primero (formato viejo),
        # 2 letras, 5 dígitos.
        for invalida in ["", "123456", "ABC-1234", "1234AB", "12345ABC"]:
            with pytest.raises(ValueError):
                normalizar_placa(invalida)

    def test_comparable_quita_todo_separador(self):
        assert placa_comparable("1 2-3.4 ABC") == "1234ABC"


class TestPlacasCercanas:
    def test_un_caracter_sustituido(self):
        """El caso real del OCR: 1234-ABL leído cuando era 1234-ABC."""
        cercanas = placas_cercanas("1234-ABL", ["1234-ABC", "5678-XYZ"])
        assert cercanas == ["1234-ABC"]

    def test_ignora_separadores_en_la_comparacion(self):
        cercanas = placas_cercanas("1234ABL", ["1234-ABC"])
        assert cercanas == ["1234-ABC"]

    def test_un_caracter_de_mas(self):
        """Dígito de más: 12345-ABC vs 1234-ABC."""
        assert "1234-ABC" in placas_cercanas("12345ABC", ["1234-ABC"])

    def test_dos_diferencias_no_sugiere(self):
        assert placas_cercanas("9934-ABC", ["1234-XYZ"]) == []

    def test_no_se_sugiere_a_si_misma(self):
        assert placas_cercanas("1234-ABC", ["1234-ABC"]) == []


# ── Integración: la mutación de registro ─────────────────────────────────────

@pytest.mark.django_db
def test_placa_se_almacena_canonica(gql_admin, tipo_vehiculo, admin):
    """Entra '1234 abc', se guarda '1234-ABC'."""
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "1234 abc")})
    assert "errors" not in r
    assert r["data"]["registrarVehiculo"]["placa"] == "1234-ABC"


@pytest.mark.django_db
def test_duplicado_con_guion_distinto_rechazado(gql_admin, tipo_vehiculo, admin, usuario_normal):
    """'1234ABC' ya existe → '1234-ABC' NO puede registrarse como segundo vehículo."""
    Vehiculo.objects.create(
        placa="1234ABC",  # sin guion, directo a BD
        tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2021, color="blanco", estado="activo",
    )
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "1234-ABC")})
    assert "errors" in r
    assert "ya está registrada" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_formato_viejo_letras_primero_rechazado(gql_admin, tipo_vehiculo, admin):
    """El formato anterior (letras+números, 'ABC-1234') ya NO es válido."""
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "ABC-1234")})
    assert "errors" in r
    assert "Formato de placa inválido" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_formato_invalido_rechazado_con_mensaje_claro(gql_admin, tipo_vehiculo, admin):
    r = graphql(gql_admin, REGISTRAR, {"input": _input(tipo_vehiculo, admin, "PLACA-FALSA")})
    assert "errors" in r
    assert "Formato de placa inválido" in r["errors"][0]["message"]


# ── Sugerencia de placa cercana (query del guardia) ──────────────────────────

SUGERENCIAS = """
query Sugerencias($placa: String!) {
  sugerenciasPlaca(placa: $placa) { placa marca propietarioNombre }
}
"""


@pytest.mark.django_db
def test_sugerencia_placa_cercana_para_guardia(gql_guardia, tipo_vehiculo, usuario_normal):
    """El OCR leyó '1234-ABL' (L por C); el vehículo real '1234-ABC' se sugiere."""
    Vehiculo.objects.create(
        placa="1234-ABC", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2021, color="blanco", estado="activo",
    )
    r = graphql(gql_guardia, SUGERENCIAS, {"placa": "1234-ABL"})
    assert "errors" not in r
    placas = [s["placa"] for s in r["data"]["sugerenciasPlaca"]]
    assert placas == ["1234-ABC"]


@pytest.mark.django_db
def test_sugerencia_requiere_personal(gql_usuario_normal, tipo_vehiculo, usuario_normal):
    Vehiculo.objects.create(
        placa="1234-ABC", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2021, color="blanco", estado="activo",
    )
    r = graphql(gql_usuario_normal, SUGERENCIAS, {"placa": "1234-ABL"})
    assert "errors" in r
