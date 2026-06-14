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
  $tieneInfraccionesActivas: Boolean
  $tieneDocumentosVencidos: Boolean
  $ordenarPor: String
  $color: String
  $estado: String
) {
  vehiculos(
    tipoId: $tipoId
    fechaDesde: $fechaDesde
    fechaHasta: $fechaHasta
    tieneInfraccionesActivas: $tieneInfraccionesActivas
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
def test_filtro_tiene_infracciones_activas_sin_infracciones(gql_admin, vehiculo_rojo):
    """vehiculo_rojo sin infracciones → filtrar por tieneInfraccionesActivas=False lo incluye."""
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tieneInfraccionesActivas": False})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "ROJ-001" in placas


@pytest.mark.django_db
def test_filtro_tiene_infracciones_activas_con_sancion_pendiente(gql_admin, vehiculo_rojo, tipo_vehiculo):
    """vehiculo_rojo con sanción pendiente → aparece con tieneInfraccionesActivas=True."""
    from apps.multas.models import Infraccion, TipoInfraccion, Sancion
    tipo_i, _ = TipoInfraccion.objects.get_or_create(nombre="Velocidad", defaults={"monto_base": "50.00"})
    infraccion = Infraccion.objects.create(
        vehiculo=vehiculo_rojo, tipo=tipo_i, descripcion="Test", estado="registrada",
    )
    Sancion.objects.create(
        infraccion=infraccion, tipo_sancion="multa_economica", monto="50.00", estado="pendiente",
    )
    r = graphql(gql_admin, VEHICULOS_FILTRADOS, {"tieneInfraccionesActivas": True})
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


# ── Búsqueda de placa tolerante a separadores ─────────────────────────────────
# Regresión: el OCR puede devolver la placa con guion, con espacio o sin nada.
# Las tres formas deben encontrar la misma placa almacenada "622-RXA".

_BUSCAR_PLACA = """
query B($buscar: String!) {
  vehiculos(buscar: $buscar, estado: "activo") {
    items { id placa }
    total
  }
}
"""


@pytest.fixture
def vehiculo_622(db, usuario_normal, tipo_vehiculo):
    return Vehiculo.objects.create(
        placa="622-RXA", tipo=tipo_vehiculo, propietario=usuario_normal,
        marca="Toyota", modelo="Corolla", anio=2026, color="celeste", estado="activo",
    )


@pytest.mark.django_db
@pytest.mark.parametrize("termino", ["622-RXA", "622RXA", "622 RXA", "622rxa"])
def test_buscar_placa_tolerante_a_separadores(gql_admin, vehiculo_622, termino):
    r = graphql(gql_admin, _BUSCAR_PLACA, {"buscar": termino})
    assert "errors" not in r
    placas = [i["placa"] for i in r["data"]["vehiculos"]["items"]]
    assert "622-RXA" in placas, f"'{termino}' no encontró la placa 622-RXA"
