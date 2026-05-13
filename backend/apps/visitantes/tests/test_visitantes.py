"""
Tests del módulo Visitantes — Regla 1 + Regla 5 del prompt.

Cubre:
  - Auth en queries (datos personales protegidos)
  - Flujo completo de visita: registrar → iniciar → finalizar
  - Validación requiere_vehiculo en TipoVisita
  - cancelar_visita: anfitrión puede rechazar, extraño no
  - CI debe ser único y sin espacios
"""
import pytest
from apps.visitantes.models import Visitante, Visita, TipoVisita
from conftest import graphql

# ── Queries GraphQL ────────────────────────────────────────────────────────

REGISTRAR_VISITANTE = """
mutation RegVisitante($input: CrearVisitanteInput!) {
  registrarVisitante(input: $input) { id ci nombreCompleto }
}
"""

REGISTRAR_VISITA = """
mutation RegVisita($input: RegistrarVisitaInput!) {
  registrarVisita(input: $input) { id estado motivo anfitrionNombre duracionMinutos }
}
"""

INICIAR_VISITA = """
mutation Iniciar($id: Int!) {
  iniciarVisita(visitaId: $id) { id estado fechaEntrada }
}
"""

FINALIZAR_VISITA = """
mutation Finalizar($id: Int!, $obs: String) {
  finalizarVisita(visitaId: $id, observaciones: $obs) {
    id estado fechaSalida duracionMinutos
  }
}
"""

CANCELAR_VISITA = """
mutation Cancelar($id: Int!, $motivo: String) {
  cancelarVisita(visitaId: $id, motivoCancelacion: $motivo) { id estado }
}
"""

VISITAS_ACTIVAS = """
query VisitasActivas { visitas_activas: visitasActivas { id estado } }
"""

VISITANTE_POR_CI = """
query VisitantePorCI($ci: String!) {
  visitantePorCi(ci: $ci) { id ci nombreCompleto }
}
"""


# ── Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture
def tipo_proveedor(db):
    return TipoVisita.objects.create(
        nombre="Proveedor/Servicio",
        descripcion="Requiere vehículo para entregar mercancía",
        requiere_vehiculo=True,
    )


@pytest.fixture
def tipo_reunion(db):
    return TipoVisita.objects.create(
        nombre="Reunión institucional",
        descripcion="No requiere vehículo",
        requiere_vehiculo=False,
    )


@pytest.fixture
def visitante_registrado(db, gql_admin):
    r = graphql(gql_admin, REGISTRAR_VISITANTE, {
        "input": {"nombre": "Juan", "apellido": "Pérez", "ci": "11111111"}
    })
    return r["data"]["registrarVisitante"]


@pytest.fixture
def visita_pendiente(db, gql_guardia, visitante_registrado, admin, tipo_reunion):
    r = graphql(gql_guardia, REGISTRAR_VISITA, {
        "input": {
            "visitanteId": visitante_registrado["id"],
            "anfitrionId": admin.id,
            "motivo": "Reunión de prueba",
            "tipoVisitaId": tipo_reunion.id,
        }
    })
    assert "errors" not in r, r.get("errors")
    return r["data"]["registrarVisita"]


# ── Auth en queries ────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_visitante_por_ci_requiere_auth(gql_client):
    r = graphql(gql_client, VISITANTE_POR_CI, {"ci": "11111111"})
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_visitas_activas_requiere_ser_personal(db, usuario_normal):
    """Un propietario normal no puede ver las visitas activas del sistema."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(usuario_normal).access_token)}"
    r = graphql(c, VISITAS_ACTIVAS, {})
    assert "errors" in r
    assert "guardia" in r["errors"][0]["message"].lower()


# ── Registrar visitante ────────────────────────────────────────────────────

@pytest.mark.django_db
def test_registrar_visitante_exitoso(gql_guardia):
    r = graphql(gql_guardia, REGISTRAR_VISITANTE, {
        "input": {"nombre": "María", "apellido": "López", "ci": "22222222"}
    })
    assert "errors" not in r
    assert r["data"]["registrarVisitante"]["ci"] == "22222222"


@pytest.mark.django_db
def test_registrar_visitante_ci_duplicado_falla(db, gql_guardia, visitante_registrado):
    r = graphql(gql_guardia, REGISTRAR_VISITANTE, {
        "input": {"nombre": "Otro", "apellido": "Test", "ci": "11111111"}
    })
    assert "errors" in r
    assert "11111111" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_registrar_visitante_ci_con_espacios_normalizado(gql_guardia):
    """El CI se limpia con strip() — espacios no crean duplicados."""
    r = graphql(gql_guardia, REGISTRAR_VISITANTE, {
        "input": {"nombre": "Test", "apellido": "Strip", "ci": "  33333333  "}
    })
    assert "errors" not in r
    assert r["data"]["registrarVisitante"]["ci"] == "33333333"


@pytest.mark.django_db
def test_propietario_no_puede_registrar_visitante(db, usuario_normal):
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(usuario_normal).access_token)}"
    r = graphql(c, REGISTRAR_VISITANTE, {
        "input": {"nombre": "Test", "apellido": "No", "ci": "99999999"}
    })
    assert "errors" in r
    assert "guardia" in r["errors"][0]["message"].lower()


# ── Registrar visita ───────────────────────────────────────────────────────

@pytest.mark.django_db
def test_registrar_visita_exitosa(db, gql_guardia, visitante_registrado, admin, tipo_reunion):
    r = graphql(gql_guardia, REGISTRAR_VISITA, {
        "input": {
            "visitanteId": visitante_registrado["id"],
            "anfitrionId": admin.id,
            "motivo": "Entrega de documentos",
            "tipoVisitaId": tipo_reunion.id,
        }
    })
    assert "errors" not in r
    assert r["data"]["registrarVisita"]["estado"] == "pendiente"


@pytest.mark.django_db
def test_registrar_visita_motivo_vacio_falla(db, gql_guardia, visitante_registrado, admin):
    r = graphql(gql_guardia, REGISTRAR_VISITA, {
        "input": {"visitanteId": visitante_registrado["id"], "anfitrionId": admin.id, "motivo": "   "}
    })
    assert "errors" in r
    assert "obligatorio" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_tipo_visita_requiere_vehiculo_sin_vehiculo_falla(
    db, gql_guardia, visitante_registrado, admin, tipo_proveedor
):
    """Si el tipo exige vehículo y no se provee, debe lanzar excepción."""
    r = graphql(gql_guardia, REGISTRAR_VISITA, {
        "input": {
            "visitanteId": visitante_registrado["id"],
            "anfitrionId": admin.id,
            "motivo": "Entrega de materiales",
            "tipoVisitaId": tipo_proveedor.id,
            # sin vehiculo_id
        }
    })
    assert "errors" in r
    assert "vehículo" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_tipo_visita_requiere_vehiculo_con_vehiculo_exitoso(
    db, gql_guardia, visitante_registrado, admin, tipo_proveedor, vehiculo_activo
):
    r = graphql(gql_guardia, REGISTRAR_VISITA, {
        "input": {
            "visitanteId": visitante_registrado["id"],
            "anfitrionId": admin.id,
            "motivo": "Entrega con camioneta",
            "tipoVisitaId": tipo_proveedor.id,
            "vehiculoId": vehiculo_activo.id,
        }
    })
    assert "errors" not in r


# ── Flujo completo: pendiente → activa → completada ────────────────────────

@pytest.mark.django_db
def test_flujo_completo_visita(db, gql_guardia, visita_pendiente):
    visita_id = visita_pendiente["id"]

    # Iniciar
    r_iniciar = graphql(gql_guardia, INICIAR_VISITA, {"id": visita_id})
    assert "errors" not in r_iniciar
    assert r_iniciar["data"]["iniciarVisita"]["estado"] == "activa"
    assert r_iniciar["data"]["iniciarVisita"]["fechaEntrada"] is not None

    # Finalizar
    r_fin = graphql(gql_guardia, FINALIZAR_VISITA, {"id": visita_id, "obs": "Salida sin novedad"})
    assert "errors" not in r_fin
    assert r_fin["data"]["finalizarVisita"]["estado"] == "completada"
    assert r_fin["data"]["finalizarVisita"]["fechaSalida"] is not None


@pytest.mark.django_db
def test_iniciar_visita_ya_activa_falla(db, gql_guardia, visita_pendiente):
    visita_id = visita_pendiente["id"]
    graphql(gql_guardia, INICIAR_VISITA, {"id": visita_id})
    # Segunda vez — ya está activa, no pendiente
    r = graphql(gql_guardia, INICIAR_VISITA, {"id": visita_id})
    assert "errors" in r
    assert "pendiente" in r["errors"][0]["message"].lower()


# ── cancelar_visita ────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_guardia_puede_cancelar_visita(db, gql_guardia, visita_pendiente):
    r = graphql(gql_guardia, CANCELAR_VISITA, {
        "id": visita_pendiente["id"], "motivo": "Visitante no autorizado"
    })
    assert "errors" not in r
    assert r["data"]["cancelarVisita"]["estado"] == "cancelada"


@pytest.mark.django_db
def test_tercero_no_puede_cancelar_visita_ajena(db, visita_pendiente, usuario_normal):
    """Un usuario que no es anfitrión ni personal no puede cancelar."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(usuario_normal).access_token)}"
    r = graphql(c, CANCELAR_VISITA, {"id": visita_pendiente["id"], "motivo": "test"})
    assert "errors" in r
    assert "anfitrión" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_cancelar_visita_completada_falla(db, gql_guardia, visita_pendiente):
    """No se puede cancelar una visita ya completada."""
    visita_id = visita_pendiente["id"]
    graphql(gql_guardia, INICIAR_VISITA, {"id": visita_id})
    graphql(gql_guardia, FINALIZAR_VISITA, {"id": visita_id, "obs": ""})
    r = graphql(gql_guardia, CANCELAR_VISITA, {"id": visita_id, "motivo": "tarde"})
    assert "errors" in r
    assert "cancelar" in r["errors"][0]["message"].lower()
