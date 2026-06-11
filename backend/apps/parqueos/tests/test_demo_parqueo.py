"""
Tests de integración para el módulo de Guía de Parqueo (demo + producción).

Verifican que el flujo completo funciona:
  1. Consultar zonas disponibles con disponibilidad real
  2. Consultar espacios disponibles por zona
  3. Iniciar sesión desde el demo (crea SesionParqueo real)
  4. Verificar que el espacio queda ocupado
  5. Cerrar sesión y liberar espacio
  6. Verificar los nuevos campos propietario_ci y propietario_roles
"""
import pytest
from apps.parqueos.models import ZonaParqueo, EspacioParqueo, SesionParqueo
from conftest import graphql

# ── Queries usadas en el demo ─────────────────────────────────────────────

ZONAS_QUERY = """
query Zonas($soloActivas: Boolean) {
  zonas(soloActivas: $soloActivas) {
    id nombre descripcion ubicacion capacidadTotal activo
    espaciosDisponibles totalRegistrados espaciosOcupados
  }
}
"""

ESPACIOS_POR_ZONA = """
query EspaciosPorZona($zonaId: Int!) {
  espaciosPorZona(zonaId: $zonaId) {
    id numero estado placaVehiculoActivo sesionActivaId
    zona { id nombre }
    categoria { id nombre esDiscapacidad }
  }
}
"""

INICIAR_SESION = """
mutation IniciarSesion($input: IniciarSesionInput!) {
  iniciarSesionParqueo(input: $input) {
    id horaEntrada estado duracionMinutos placaVehiculo
    espacio { numero zona { nombre } }
  }
}
"""

CERRAR_SESION = """
mutation CerrarSesion($sesionId: Int!) {
  cerrarSesionParqueo(sesionId: $sesionId) {
    id horaSalida estado duracionMinutos placaVehiculo
    espacio { numero zona { nombre } }
  }
}
"""

VEHICULOS_QUERY = """
query Vehiculos($estado: String, $porPagina: Int) {
  vehiculos(estado: $estado, porPagina: $porPagina) {
    items {
      id placa marca modelo propietarioNombre propietarioCi propietarioRoles
    }
  }
}
"""

SESIONES_ACTIVAS = """
query SesionesActivas {
  sesionesActivas {
    id horaEntrada estado duracionMinutos placaVehiculo
    espacio { id numero zona { nombre } }
  }
}
"""


# ── Fixtures locales ─────────────────────────────────────────────────────

@pytest.fixture
def categoria_general(db):
    from apps.parqueos.models import CategoriaEspacio
    c, _ = CategoriaEspacio.objects.get_or_create(
        nombre="General", defaults={"descripcion": "General", "es_discapacidad": False, "color": "#64748b"}
    )
    return c


@pytest.fixture
def zona_activa(db):
    from apps.parqueos.models import ZonaParqueo
    z, _ = ZonaParqueo.objects.get_or_create(
        nombre="Zona B — Bloque Facultades",
        defaults={"descripcion": "Zona central", "ubicacion": "La Poza", "capacidad_total": 80, "activo": True}
    )
    return z


@pytest.fixture
def espacio_libre(db, zona_activa, categoria_general):
    from apps.parqueos.models import EspacioParqueo
    e, _ = EspacioParqueo.objects.get_or_create(
        zona=zona_activa, numero="B-01",
        defaults={"categoria": categoria_general, "estado": "disponible"}
    )
    e.estado = "disponible"
    e.save(update_fields=["estado"])
    return e


# ── Tests de geolocalización y disponibilidad ─────────────────────────────

@pytest.mark.django_db
def test_zonas_query_retorna_disponibilidad(gql_admin):
    """La query de zonas devuelve los campos necesarios para el mapa."""
    r = graphql(gql_admin, ZONAS_QUERY, {"soloActivas": True})
    assert "errors" not in r
    zonas = r["data"]["zonas"]
    for z in zonas:
        assert "id" in z
        assert "nombre" in z
        assert "espaciosDisponibles" in z
        assert "totalRegistrados" in z


@pytest.mark.django_db
def test_espacios_por_zona_retorna_estado_y_placa(gql_admin, zona_activa, espacio_libre):
    """Los espacios devuelven estado, placaVehiculoActivo y sesionActivaId para el mapa."""
    r = graphql(gql_admin, ESPACIOS_POR_ZONA, {"zonaId": zona_activa.id})
    assert "errors" not in r
    espacios = r["data"]["espaciosPorZona"]
    assert len(espacios) >= 1
    for e in espacios:
        assert "estado" in e
        assert "placaVehiculoActivo" in e   # null cuando libre
        assert "sesionActivaId" in e         # null cuando libre
        assert "categoria" in e
        assert "zona" in e
    # El espacio libre tiene estado=disponible
    disp = [e for e in espacios if e["numero"] == espacio_libre.numero]
    assert len(disp) == 1
    assert disp[0]["estado"] == "disponible"
    assert disp[0]["placaVehiculoActivo"] is None


@pytest.mark.django_db
def test_iniciar_sesion_desde_demo(gql_admin, vehiculo_en_campus, espacio_libre):
    """El demo crea una SesionParqueo real y marca el espacio como ocupado."""
    r = graphql(gql_admin, INICIAR_SESION, {
        "input": {"espacioId": espacio_libre.id, "vehiculoId": vehiculo_en_campus.id}
    })
    assert "errors" not in r, r.get("errors")
    data = r["data"]["iniciarSesionParqueo"]
    assert data["estado"] == "activa"
    assert data["placaVehiculo"] == vehiculo_en_campus.placa
    assert data["espacio"]["numero"] == espacio_libre.numero

    espacio_libre.refresh_from_db()
    assert espacio_libre.estado == "ocupado"


@pytest.mark.django_db
def test_sesion_demo_aparece_en_sesiones_activas(gql_admin, vehiculo_en_campus, espacio_libre):
    """Una sesión creada desde el demo aparece en sesionesActivas."""
    graphql(gql_admin, INICIAR_SESION, {
        "input": {"espacioId": espacio_libre.id, "vehiculoId": vehiculo_en_campus.id}
    })
    r = graphql(gql_admin, SESIONES_ACTIVAS, {})
    assert "errors" not in r
    placas = [s["placaVehiculo"] for s in r["data"]["sesionesActivas"]]
    assert vehiculo_en_campus.placa in placas


@pytest.mark.django_db
def test_cerrar_sesion_libera_espacio(gql_admin, vehiculo_en_campus, espacio_libre):
    """Al cerrar la sesión del demo el espacio vuelve a 'disponible'."""
    r_inicio = graphql(gql_admin, INICIAR_SESION, {
        "input": {"espacioId": espacio_libre.id, "vehiculoId": vehiculo_en_campus.id}
    })
    sesion_id = r_inicio["data"]["iniciarSesionParqueo"]["id"]

    r_cierre = graphql(gql_admin, CERRAR_SESION, {"sesionId": sesion_id})
    assert "errors" not in r_cierre
    data = r_cierre["data"]["cerrarSesionParqueo"]
    assert data["estado"] in ("cerrada", "finalizada")
    assert data["placaVehiculo"] == vehiculo_en_campus.placa

    espacio_libre.refresh_from_db()
    assert espacio_libre.estado == "disponible"


@pytest.mark.django_db
def test_vehiculo_expone_propietario_ci_y_roles(gql_admin, vehiculo_activo):
    """Los campos nuevos propietarioCi y propietarioRoles están disponibles para el modal de parqueo."""
    r = graphql(gql_admin, VEHICULOS_QUERY, {"estado": "activo", "porPagina": 10})
    assert "errors" not in r
    items = r["data"]["vehiculos"]["items"]
    assert len(items) > 0
    for v in items:
        assert "propietarioCi" in v         # CI para verificar identidad
        assert "propietarioNombre" in v     # Nombre completo
        assert "propietarioRoles" in v      # Lista de roles para validar categoría


@pytest.mark.django_db
def test_espacio_ocupa_sesion_activa_id_correcto(gql_admin, vehiculo_en_campus, zona_activa, espacio_libre):
    """El campo sesionActivaId retorna el ID correcto para cerrar desde el botón 'Salida'."""
    r_inicio = graphql(gql_admin, INICIAR_SESION, {
        "input": {"espacioId": espacio_libre.id, "vehiculoId": vehiculo_en_campus.id}
    })
    sesion_id_esperado = r_inicio["data"]["iniciarSesionParqueo"]["id"]

    r_esp = graphql(gql_admin, ESPACIOS_POR_ZONA, {"zonaId": zona_activa.id})
    espacios = r_esp["data"]["espaciosPorZona"]
    esp_data = next((e for e in espacios if e["id"] == espacio_libre.id), None)
    assert esp_data is not None
    assert esp_data["sesionActivaId"] == sesion_id_esperado
    assert esp_data["placaVehiculoActivo"] == vehiculo_en_campus.placa

    graphql(gql_admin, CERRAR_SESION, {"sesionId": sesion_id_esperado})


@pytest.mark.django_db
def test_no_se_pueden_crear_dos_sesiones_mismo_espacio(gql_admin, vehiculo_en_campus, espacio_libre):
    """Un espacio ocupado no acepta una segunda sesión activa."""
    r1 = graphql(gql_admin, INICIAR_SESION, {
        "input": {"espacioId": espacio_libre.id, "vehiculoId": vehiculo_en_campus.id}
    })
    assert "errors" not in r1
    sesion_id = r1["data"]["iniciarSesionParqueo"]["id"]

    # Segunda sesión con el mismo espacio — debe fallar
    r2 = graphql(gql_admin, INICIAR_SESION, {
        "input": {"espacioId": espacio_libre.id, "vehiculoId": vehiculo_en_campus.id}
    })
    assert "errors" in r2

    graphql(gql_admin, CERRAR_SESION, {"sesionId": sesion_id})
