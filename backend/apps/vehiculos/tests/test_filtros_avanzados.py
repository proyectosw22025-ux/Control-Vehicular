"""Tests para los filtros avanzados de la query vehiculos() — Sprint C1."""
import pytest
from datetime import timedelta
from django.utils import timezone
from apps.vehiculos.models import Vehiculo, TipoVehiculo, DocumentoVehiculo
from conftest import graphql

VEHICULOS_FILTRADOS = """
query V(
  $tipoId: Int
  $fechaDesde: String
  $fechaHasta: String
  $tieneMultas: Boolean
  $tieneDocumentosVencidos: Boolean
  $ordenarPor: String
  $color: String
  $estado: String
) {
  vehiculos(
    tipoId: $tipoId
    fechaDesde: $fechaDesde
    fechaHasta: $fechaHasta
    tieneMultas: $tieneMultas
    tieneDocumentosVencidos: $tieneDocumentosVencidos
    ordenarPor: $ordenarPor
    color: $color
    estado: $estado
  ) {
    items { id placa color }
    total
  }
}
"""


@pytest.fixture
def tipo_moto(db):
    t, _ = TipoVehiculo.objects.get_or_create(nombre="Moto", defaults={"descripcion": "Motocicleta"})
    return t


@pytest.fixture
def vehiculo_rojo(db, usuario_normal, tipo_vehiculo):
    return Vehiculo.objects.create(
        placa="ROJ-001", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Honda", modelo="CB300", anio=2021, color="rojo", estado="activo",
    )


@pytest.fixture
def vehiculo_azul(db, usuario_normal, tipo_moto):
    return Vehiculo.objects.create(
        placa="AZU-001", tipo=tipo_moto, propietario=usuario_normal,
        marca="Suzuki", modelo="GN125", anio=2020, color="azul", estado="activo",
    )


@pytest.mark.django_db
def test_filtro_tipo_id(gql_admin, vehiculo_rojo, vehiculo_azul):
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tipoId": vehiculo_azul.tipo_id})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "AZU-001" in placas
    assert "ROJ-001" not in placas


@pytest.mark.django_db
def test_filtro_color(gql_admin, vehiculo_rojo, vehiculo_azul):
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"color": "rojo"})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" in placas
    assert "AZU-001" not in placas


@pytest.mark.django_db
def test_filtro_fecha_desde_excluye_anteriores(gql_admin, vehiculo_rojo):
    manana = (timezone.now() + timedelta(days=1)).date().isoformat()
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"fechaDesde": manana})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" not in placas


@pytest.mark.django_db
def test_filtro_fecha_hasta_incluye_hoy(gql_admin, vehiculo_rojo):
    hoy = timezone.now().date().isoformat()
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"fechaHasta": hoy})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" in placas


@pytest.mark.django_db
def test_filtro_tiene_multas_sin_multas(gql_admin, vehiculo_rojo):
    """vehiculo_rojo no tiene multas → filtrar por tieneMultas=False lo incluye."""
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tieneMultas": False})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" in placas


@pytest.mark.django_db
def test_filtro_tiene_multas_con_multa(gql_admin, vehiculo_rojo, tipo_vehiculo):
    """vehiculo_rojo con multa pendiente → aparece con tieneMultas=True."""
    from apps.multas.models import Multa, TipoMulta
    tipo_m, _ = TipoMulta.objects.get_or_create(nombre="Velocidad", defaults={"monto_base": "50.00"})
    Multa.objects.create(
        vehiculo=vehiculo_rojo, tipo=tipo_m,
        descripcion="Test", monto="50.00", estado="pendiente",
    )
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tieneMultas": True})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" in placas


@pytest.mark.django_db
def test_filtro_docs_vencidos(gql_admin, vehiculo_rojo):
    """vehiculo_rojo con SOAT vencido → aparece con tieneDocumentosVencidos=True."""
    ayer = (timezone.now().date() - timedelta(days=1))
    DocumentoVehiculo.objects.create(
        vehiculo=vehiculo_rojo, tipo_doc="soat",
        numero="SOA-VENCIDO", fecha_vencimiento=ayer,
    )
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tieneDocumentosVencidos": True})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" in placas


@pytest.mark.django_db
def test_filtro_docs_no_vencidos_excluye_con_vencidos(gql_admin, vehiculo_rojo, vehiculo_azul):
    ayer = (timezone.now().date() - timedelta(days=1))
    DocumentoVehiculo.objects.create(
        vehiculo=vehiculo_rojo, tipo_doc="soat",
        numero="SOA-VENCIDO", fecha_vencimiento=ayer,
    )
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tieneDocumentosVencidos": False})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" not in placas


@pytest.mark.django_db
def test_ordenar_por_placa_ascendente(gql_admin, vehiculo_rojo, vehiculo_azul):
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"ordenarPor": "placa"})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert placas == sorted(placas)


@pytest.mark.django_db
def test_ordenar_por_placa_descendente(gql_admin, vehiculo_rojo, vehiculo_azul):
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"ordenarPor": "-placa"})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert placas == sorted(placas, reverse=True)


@pytest.mark.django_db
def test_filtros_combinados_tipo_y_color(gql_admin, vehiculo_rojo, vehiculo_azul):
    """Solo vehiculo_azul es Moto azul; vehiculo_rojo es Auto rojo."""
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {
        "tipoId": vehiculo_azul.tipo_id,
        "color": "azul",
    })
    assert "errors" not in r
    items = r["data"]["vehiculos"]["items"]
    assert len(items) == 1
    assert items[0]["placa"] == "AZU-001"
