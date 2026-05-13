"""
Tests del módulo Notificaciones — Regla 1 + Regla 5 del prompt.

Cubre:
  - Auth en queries: mis_notificaciones, conteo_no_leidas, mis_preferencias
  - marcar_leida: solo las propias, idempotente
  - marcar_todas_leidas: retorna conteo correcto
  - eliminar_notificacion: solo la propia; ajena falla
  - eliminar_todas_leidas: limpia solo las leídas del usuario
  - actualizar_preferencia: canal inválido rechazado
"""
import pytest
from apps.notificaciones.models import Notificacion, TipoNotificacion, PreferenciaNotificacion
from conftest import graphql

MIS_NOTIFICACIONES = """
query MisNotif($soloNoLeidas: Boolean) {
  misNotificaciones(soloNoLeidas: $soloNoLeidas) { id titulo leido tipoCodigo }
}
"""

CONTEO = """
query Conteo { conteoNoLeidas }
"""

MARCAR_LEIDA = """
mutation MarcarLeida($id: Int!) {
  marcarLeida(notificacionId: $id) { id leido }
}
"""

MARCAR_TODAS = """
mutation MarcarTodas { marcarTodasLeidas }
"""

ELIMINAR = """
mutation Eliminar($id: Int!) {
  eliminarNotificacion(notificacionId: $id)
}
"""

ELIMINAR_LEIDAS = """
mutation EliminarLeidas { eliminarTodasLeidas }
"""

ACTUALIZAR_PREF = """
mutation ActPref($tipoId: Int!, $canal: String!, $activo: Boolean!) {
  actualizarPreferencia(tipoId: $tipoId, canal: $canal, activo: $activo) {
    id activo canal
  }
}
"""


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def tipo_notif(db):
    return TipoNotificacion.objects.create(
        codigo="test_tipo",
        nombre="Test",
        descripcion="Para tests",
        plantilla_titulo="Test",
        plantilla_cuerpo="Test",
    )


@pytest.fixture
def notif_no_leida(db, usuario_normal, tipo_notif):
    return Notificacion.objects.create(
        usuario=usuario_normal,
        tipo=tipo_notif,
        titulo="Test no leída",
        mensaje="Mensaje de prueba",
        leido=False,
    )


@pytest.fixture
def notif_leida(db, usuario_normal, tipo_notif):
    return Notificacion.objects.create(
        usuario=usuario_normal,
        tipo=tipo_notif,
        titulo="Test leída",
        mensaje="Ya fue leída",
        leido=True,
    )


@pytest.fixture
def gql_usuario_normal(usuario_normal):
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    token = str(RefreshToken.for_user(usuario_normal).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    return c


# ── Auth en queries ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_mis_notificaciones_requiere_auth(gql_client):
    r = graphql(gql_client, MIS_NOTIFICACIONES, {})
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_conteo_sin_auth_retorna_cero(gql_client):
    """conteoNoLeidas devuelve 0 para anónimos (no lanza excepción)."""
    r = graphql(gql_client, CONTEO, {})
    assert r["data"]["conteoNoLeidas"] == 0


# ── mis_notificaciones ───────────────────────────────────────────────────────

@pytest.mark.django_db
def test_mis_notificaciones_retorna_las_propias(db, gql_usuario_normal, notif_no_leida, notif_leida):
    r = graphql(gql_usuario_normal, MIS_NOTIFICACIONES, {})
    assert "errors" not in r
    ids = [n["id"] for n in r["data"]["misNotificaciones"]]
    assert notif_no_leida.id in ids
    assert notif_leida.id in ids


@pytest.mark.django_db
def test_mis_notificaciones_filtro_no_leidas(db, gql_usuario_normal, notif_no_leida, notif_leida):
    r = graphql(gql_usuario_normal, MIS_NOTIFICACIONES, {"soloNoLeidas": True})
    assert "errors" not in r
    ids = [n["id"] for n in r["data"]["misNotificaciones"]]
    assert notif_no_leida.id in ids
    assert notif_leida.id not in ids


@pytest.mark.django_db
def test_notificaciones_no_muestra_ajenas(db, gql_usuario_normal, admin, tipo_notif):
    """Las notificaciones de otro usuario no aparecen."""
    notif_ajena = Notificacion.objects.create(
        usuario=admin, tipo=tipo_notif, titulo="Ajena", mensaje="No debería verse", leido=False
    )
    r = graphql(gql_usuario_normal, MIS_NOTIFICACIONES, {})
    ids = [n["id"] for n in r["data"]["misNotificaciones"]]
    assert notif_ajena.id not in ids


# ── marcar_leida ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_marcar_leida_exitoso(db, gql_usuario_normal, notif_no_leida):
    r = graphql(gql_usuario_normal, MARCAR_LEIDA, {"id": notif_no_leida.id})
    assert "errors" not in r
    assert r["data"]["marcarLeida"]["leido"] is True
    notif_no_leida.refresh_from_db()
    assert notif_no_leida.leido is True


@pytest.mark.django_db
def test_marcar_leida_es_idempotente(db, gql_usuario_normal, notif_leida):
    """Marcar como leída una ya leída no lanza error."""
    r = graphql(gql_usuario_normal, MARCAR_LEIDA, {"id": notif_leida.id})
    assert "errors" not in r
    assert r["data"]["marcarLeida"]["leido"] is True


@pytest.mark.django_db
def test_marcar_leida_ajena_falla(db, gql_usuario_normal, admin, tipo_notif):
    notif_ajena = Notificacion.objects.create(
        usuario=admin, tipo=tipo_notif, titulo="Ajena", mensaje="Msg", leido=False
    )
    r = graphql(gql_usuario_normal, MARCAR_LEIDA, {"id": notif_ajena.id})
    assert "errors" in r
    assert "encontrada" in r["errors"][0]["message"].lower()


# ── marcar_todas_leidas ───────────────────────────────────────────────────────

@pytest.mark.django_db
def test_marcar_todas_retorna_conteo(db, gql_usuario_normal, usuario_normal, tipo_notif):
    Notificacion.objects.create(usuario=usuario_normal, tipo=tipo_notif, titulo="A", mensaje="", leido=False)
    Notificacion.objects.create(usuario=usuario_normal, tipo=tipo_notif, titulo="B", mensaje="", leido=False)
    Notificacion.objects.create(usuario=usuario_normal, tipo=tipo_notif, titulo="C", mensaje="", leido=True)
    r = graphql(gql_usuario_normal, MARCAR_TODAS, {})
    assert "errors" not in r
    assert r["data"]["marcarTodasLeidas"] == 2


# ── eliminar_notificacion ────────────────────────────────────────────────────

@pytest.mark.django_db
def test_eliminar_notificacion_propia(db, gql_usuario_normal, notif_no_leida):
    r = graphql(gql_usuario_normal, ELIMINAR, {"id": notif_no_leida.id})
    assert "errors" not in r
    assert r["data"]["eliminarNotificacion"] is True
    assert not Notificacion.objects.filter(pk=notif_no_leida.id).exists()


@pytest.mark.django_db
def test_eliminar_notificacion_ajena_falla(db, gql_usuario_normal, admin, tipo_notif):
    notif_ajena = Notificacion.objects.create(
        usuario=admin, tipo=tipo_notif, titulo="Ajena", mensaje="Msg", leido=False
    )
    r = graphql(gql_usuario_normal, ELIMINAR, {"id": notif_ajena.id})
    assert "errors" in r
    assert "encontrada" in r["errors"][0]["message"].lower()
    assert Notificacion.objects.filter(pk=notif_ajena.id).exists()


@pytest.mark.django_db
def test_eliminar_notificacion_requiere_auth(gql_client, notif_no_leida):
    r = graphql(gql_client, ELIMINAR, {"id": notif_no_leida.id})
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower()


# ── eliminar_todas_leidas ─────────────────────────────────────────────────────

@pytest.mark.django_db
def test_eliminar_todas_leidas(db, gql_usuario_normal, usuario_normal, tipo_notif):
    Notificacion.objects.create(usuario=usuario_normal, tipo=tipo_notif, titulo="L1", mensaje="", leido=True)
    Notificacion.objects.create(usuario=usuario_normal, tipo=tipo_notif, titulo="L2", mensaje="", leido=True)
    no_leida = Notificacion.objects.create(usuario=usuario_normal, tipo=tipo_notif, titulo="NL", mensaje="", leido=False)
    r = graphql(gql_usuario_normal, ELIMINAR_LEIDAS, {})
    assert "errors" not in r
    assert r["data"]["eliminarTodasLeidas"] == 2
    assert Notificacion.objects.filter(pk=no_leida.id).exists()


# ── actualizar_preferencia ────────────────────────────────────────────────────

@pytest.mark.django_db
def test_actualizar_preferencia_canal_invalido(db, gql_usuario_normal, tipo_notif):
    r = graphql(gql_usuario_normal, ACTUALIZAR_PREF, {
        "tipoId": tipo_notif.id, "canal": "telegram", "activo": True
    })
    assert "errors" in r
    assert "inválido" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_actualizar_preferencia_exitoso(db, gql_usuario_normal, tipo_notif):
    r = graphql(gql_usuario_normal, ACTUALIZAR_PREF, {
        "tipoId": tipo_notif.id, "canal": "email", "activo": False
    })
    assert "errors" not in r
    pref = r["data"]["actualizarPreferencia"]
    assert pref["canal"] == "email"
    assert pref["activo"] is False
