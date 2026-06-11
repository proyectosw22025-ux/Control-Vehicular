"""
Tests de autorización en parqueos — verifica que solo
guardias y administradores pueden operar sesiones y espacios.
"""
import pytest
from conftest import graphql

INICIAR = """
mutation IniciarSesion($espacioId: Int!, $vehiculoId: Int!) {
  iniciarSesionParqueo(input: { espacioId: $espacioId, vehiculoId: $vehiculoId }) {
    id estado
  }
}
"""

CERRAR = """
mutation CerrarSesion($sesionId: Int!) {
  cerrarSesionParqueo(sesionId: $sesionId) { id estado }
}
"""

CREAR_ZONA = """
mutation CrearZona($nombre: String!, $capacidadTotal: Int!) {
  crearZona(input: { nombre: $nombre, capacidadTotal: $capacidadTotal }) { id nombre }
}
"""


@pytest.mark.django_db
def test_usuario_no_autenticado_no_puede_iniciar_sesion(gql_client, vehiculo_activo, espacio_disponible):
    """Un request sin token JWT no puede iniciar sesión de parqueo."""
    r = graphql(gql_client, INICIAR, {"espacioId": espacio_disponible.id, "vehiculoId": vehiculo_activo.id})
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower() or "autenticaci" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_guardia_puede_iniciar_sesion(gql_guardia, vehiculo_en_campus, espacio_disponible):
    """Un guardia autenticado puede iniciar sesión de parqueo."""
    r = graphql(gql_guardia, INICIAR, {"espacioId": espacio_disponible.id, "vehiculoId": vehiculo_en_campus.id})
    assert "errors" not in r
    assert r["data"]["iniciarSesionParqueo"]["estado"] == "activa"


@pytest.mark.django_db
def test_admin_puede_crear_zona(gql_admin):
    """Solo un administrador puede crear zonas de parqueo."""
    r = graphql(gql_admin, CREAR_ZONA, {"nombre": "Zona Test Auth", "capacidadTotal": 5})
    assert "errors" not in r
    assert r["data"]["crearZona"]["nombre"] == "Zona Test Auth"


@pytest.mark.django_db
def test_guardia_no_puede_crear_zona(gql_guardia):
    """Un guardia no puede crear zonas — solo admins."""
    r = graphql(gql_guardia, CREAR_ZONA, {"nombre": "Zona No Permitida", "capacidadTotal": 5})
    assert "errors" in r
    assert "administrador" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_vehiculo_sancionado_no_puede_estacionar(gql_guardia, vehiculo_sancionado, espacio_disponible):
    """Un vehículo sancionado no puede iniciar sesión de parqueo."""
    r = graphql(gql_guardia, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_sancionado.id,
    })
    assert "errors" in r
    assert "sancionado" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_cerrar_sesion_requiere_autenticacion(gql_client):
    """Cerrar sesión de parqueo requiere estar autenticado."""
    r = graphql(gql_client, CERRAR, {"sesionId": 1})
    assert "errors" in r


# ── Scoping de queries: placas y ubicaciones no se exponen a terceros ────────

HISTORIAL = """
query Historial($vehiculoId: Int!) {
  historialSesiones(vehiculoId: $vehiculoId) { id }
}
"""

SESIONES_ACTIVAS = "query { sesionesActivas { id placaVehiculo } }"


@pytest.mark.django_db
def test_historial_requiere_autenticacion(gql_client, vehiculo_activo):
    r = graphql(gql_client, HISTORIAL, {"vehiculoId": vehiculo_activo.id})
    assert "errors" in r


@pytest.mark.django_db
def test_propietario_puede_ver_su_propio_historial(gql_usuario_normal, vehiculo_activo):
    r = graphql(gql_usuario_normal, HISTORIAL, {"vehiculoId": vehiculo_activo.id})
    assert "errors" not in r


@pytest.mark.django_db
def test_usuario_no_puede_ver_historial_de_vehiculo_ajeno(gql_usuario_normal, guardia, tipo_vehiculo):
    """El historial de parqueo revela patrones de movimiento — solo el dueño o personal."""
    from apps.vehiculos.models import Vehiculo
    ajeno = Vehiculo.objects.create(
        placa="AJE-001", tipo=tipo_vehiculo, propietario=guardia,
        marca="Nissan", modelo="Versa", anio=2022, color="rojo", estado="activo",
    )
    r = graphql(gql_usuario_normal, HISTORIAL, {"vehiculoId": ajeno.id})
    assert "errors" in r
    assert "propios" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_sesiones_activas_solo_para_personal(gql_usuario_normal):
    """La vista global de placas+ubicaciones es operativa — solo Guardia/Admin."""
    r = graphql(gql_usuario_normal, SESIONES_ACTIVAS)
    assert "errors" in r
    assert "guardia" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_sesiones_activas_visible_para_guardia(gql_guardia):
    r = graphql(gql_guardia, SESIONES_ACTIVAS)
    assert "errors" not in r


# ── Regla de categorías aplicada en el servidor (no solo aviso en UI) ────────

INICIAR_CON_OVERRIDE = """
mutation IniciarSesion($espacioId: Int!, $vehiculoId: Int!, $permitir: Boolean) {
  iniciarSesionParqueo(input: {
    espacioId: $espacioId, vehiculoId: $vehiculoId,
    permitirCategoriaIncompatible: $permitir
  }) { id estado }
}
"""


@pytest.fixture
def espacio_docente(db, zona):
    from apps.parqueos.models import CategoriaEspacio, EspacioParqueo
    cat, _ = CategoriaEspacio.objects.get_or_create(nombre="Docente", defaults={"color": "#3B82F6"})
    return EspacioParqueo.objects.create(zona=zona, categoria=cat, numero="D01", estado="disponible")


@pytest.mark.django_db
def test_espacio_docente_rechaza_propietario_sin_rol(gql_guardia, vehiculo_en_campus, espacio_docente):
    """El dueño de vehiculo_activo no tiene rol Docente → asignación bloqueada."""
    r = graphql(gql_guardia, INICIAR, {
        "espacioId": espacio_docente.id, "vehiculoId": vehiculo_en_campus.id,
    })
    assert "errors" in r
    assert "Docente" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_guardia_puede_autorizar_excepcion_de_categoria(gql_guardia, vehiculo_en_campus, espacio_docente):
    """Con el override explícito, el guardia asigna y la excepción queda auditada."""
    from apps.acceso.models import AuditLog
    r = graphql(gql_guardia, INICIAR_CON_OVERRIDE, {
        "espacioId": espacio_docente.id, "vehiculoId": vehiculo_en_campus.id, "permitir": True,
    })
    assert "errors" not in r
    assert r["data"]["iniciarSesionParqueo"]["estado"] == "activa"
    log = AuditLog.objects.filter(accion="sesion_parqueo_iniciada").order_by("-id").first()
    assert log is not None and "excepción" in log.descripcion


@pytest.mark.django_db
def test_propietario_no_puede_usar_override_de_categoria(gql_usuario_normal, vehiculo_en_campus, espacio_docente):
    """El override es prerrogativa del personal: un propietario no puede auto-autorizarse."""
    r = graphql(gql_usuario_normal, INICIAR_CON_OVERRIDE, {
        "espacioId": espacio_docente.id, "vehiculoId": vehiculo_en_campus.id, "permitir": True,
    })
    assert "errors" in r
    assert "Docente" in r["errors"][0]["message"]
