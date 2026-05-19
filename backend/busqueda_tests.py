"""Tests para búsqueda global — Sprint C2."""
import pytest
from conftest import graphql

BUSQUEDA = """
query Buscar($termino: String!, $limite: Int) {
  busquedaGlobal(termino: $termino, limite: $limite) {
    tipo id titulo subtitulo estado url meta
  }
}
"""


@pytest.mark.django_db
def test_busqueda_requiere_autenticacion(gql_client):
    r = graphql(gql_client, BUSQUEDA, {"termino": "ABC"})
    assert "errors" in r


@pytest.mark.django_db
def test_busqueda_por_placa(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "ABC"})
    assert "errors" not in r
    tipos = [x["tipo"] for x in r["data"]["busquedaGlobal"]]
    assert "vehiculo" in tipos


@pytest.mark.django_db
def test_busqueda_por_nombre_propietario(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "Juan"})
    assert "errors" not in r
    resultados = r["data"]["busquedaGlobal"]
    assert any(x["tipo"] in ["vehiculo", "usuario"] for x in resultados)


@pytest.mark.django_db
def test_busqueda_termino_muy_corto_retorna_vacio(gql_admin):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "A"})
    assert "errors" not in r
    assert r["data"]["busquedaGlobal"] == []


@pytest.mark.django_db
def test_prefijo_v_solo_vehiculos(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "v: ABC"})
    assert "errors" not in r
    tipos = [x["tipo"] for x in r["data"]["busquedaGlobal"]]
    assert all(t == "vehiculo" for t in tipos)


@pytest.mark.django_db
def test_prefijo_u_solo_usuarios(gql_admin, usuario_normal):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "u: Juan"})
    assert "errors" not in r
    tipos = [x["tipo"] for x in r["data"]["busquedaGlobal"]]
    assert all(t == "usuario" for t in tipos)


@pytest.mark.django_db
def test_prefijo_m_solo_multas(gql_admin):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "m: ABC"})
    assert "errors" not in r
    tipos = [x["tipo"] for x in r["data"]["busquedaGlobal"]]
    assert all(t == "multa" for t in tipos)


@pytest.mark.django_db
def test_busqueda_respeta_limite(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "ABC", "limite": 1})
    assert "errors" not in r
    assert len(r["data"]["busquedaGlobal"]) <= 1


@pytest.mark.django_db
def test_resultado_tiene_url_navegacion(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, BUSQUEDA, {"termino": "ABC"})
    assert "errors" not in r
    for res in r["data"]["busquedaGlobal"]:
        assert res["url"].startswith("/")
