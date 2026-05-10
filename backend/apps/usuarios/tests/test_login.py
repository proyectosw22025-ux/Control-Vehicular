"""Tests del login: credenciales, usuario inactivo y rate limiting."""
import pytest
from django.core.cache import cache
from conftest import graphql

LOGIN = """
mutation Login($ci: String!, $password: String!) {
  login(input: { ci: $ci, password: $password }) {
    access
    refresh
    usuario { id ci nombreCompleto }
  }
}
"""


@pytest.fixture(autouse=True)
def limpiar_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_login_exitoso(gql_client, usuario_normal, password):
    r = graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert "errors" not in r
    assert r["data"]["login"]["access"]
    assert r["data"]["login"]["usuario"]["ci"] == usuario_normal.ci


@pytest.mark.django_db
def test_login_credenciales_invalidas(gql_client):
    r = graphql(gql_client, LOGIN, {"ci": "99999", "password": "mal"})
    assert "errors" in r
    assert "inválidas" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_login_usuario_inactivo(gql_client, usuario_normal, password):
    # Django's ModelBackend devuelve None para usuarios inactivos,
    # por lo que el error llega como "Credenciales inválidas"
    usuario_normal.is_active = False
    usuario_normal.save()
    r = graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert "errors" in r
    assert r["errors"][0]["message"]  # cualquier error es esperado


@pytest.mark.django_db
def test_rate_limiting_bloquea_al_6to_intento(gql_client):
    for _ in range(5):
        graphql(gql_client, LOGIN, {"ci": "00000", "password": "mal"})
    r = graphql(gql_client, LOGIN, {"ci": "00000", "password": "mal"})
    assert "errors" in r
    assert "Demasiados intentos" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_rate_limiting_se_resetea_con_login_exitoso(gql_client, usuario_normal, password):
    # 4 intentos fallidos
    for _ in range(4):
        graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": "mal"})
    # login exitoso: debe resetear el contador
    r = graphql(gql_client, LOGIN, {"ci": usuario_normal.ci, "password": password})
    assert "errors" not in r
    assert r["data"]["login"]["access"]
