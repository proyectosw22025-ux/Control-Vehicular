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


class TestPlacasCercanas:
    def test_un_caracter_sustituido(self):
        """El caso real del OCR: ZVX123 leído cuando era ZYX123 (V↔Y)."""
        cercanas = placas_cercanas("ZVX-123", ["ZYX-123", "ABC-1234", "LPZ-9999"])
        assert cercanas == ["ZYX-123"]

    def test_ignora_separadores_en_la_comparacion(self):
        cercanas = placas_cercanas("ZVX123", ["ZYX-123"])
        assert cercanas == ["ZYX-123"]

    def test_un_caracter_de_mas(self):
        """Letra extra: ABC1234 vs ABC-123."""
        assert "ABC-123" in placas_cercanas("ABC1234", ["ABC-123"])

    def test_dos_diferencias_no_sugiere(self):
        assert placas_cercanas("ZVZ-123", ["ZYX-123"]) == []

    def test_no_se_sugiere_a_si_misma(self):
        assert placas_cercanas("ZYX-123", ["ZYX-123"]) == []


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


# ── Sugerencia de placa cercana (query del guardia) ──────────────────────────

SUGERENCIAS = """
query Sugerencias($placa: String!) {
  sugerenciasPlaca(placa: $placa) { placa marca propietarioNombre }
}
"""


@pytest.mark.django_db
def test_sugerencia_placa_cercana_para_guardia(gql_guardia, tipo_vehiculo, usuario_normal):
    """El OCR leyó 'ZVX-123' (V por Y); el vehículo real 'ZYX-123' se sugiere."""
    Vehiculo.objects.create(
        placa="ZYX-123", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2021, color="blanco", estado="activo",
    )
    r = graphql(gql_guardia, SUGERENCIAS, {"placa": "ZVX-123"})
    assert "errors" not in r
    placas = [s["placa"] for s in r["data"]["sugerenciasPlaca"]]
    assert placas == ["ZYX-123"]


@pytest.mark.django_db
def test_sugerencia_requiere_personal(gql_usuario_normal, tipo_vehiculo, usuario_normal):
    Vehiculo.objects.create(
        placa="ZYX-123", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2021, color="blanco", estado="activo",
    )
    r = graphql(gql_usuario_normal, SUGERENCIAS, {"placa": "ZVX-123"})
    assert "errors" in r
