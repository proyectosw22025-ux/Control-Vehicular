"""
Los reportes PDF son agregados de TODOS los usuarios — deben exigir el mismo
rol (Administrador) que las queries GraphQL equivalentes. Antes cualquier
usuario autenticado los descargaba: back door sin la misma cerradura.
"""
import pytest

RUTAS = [
    "/api/pdf/vehiculos/",
    "/api/pdf/sesiones/",
    "/api/pdf/visitas/",
    "/api/pdf/infracciones/",
]


@pytest.mark.django_db
@pytest.mark.parametrize("ruta", RUTAS)
def test_pdf_sin_auth_prohibido(gql_client, ruta):
    assert gql_client.get(ruta).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("ruta", RUTAS)
def test_pdf_usuario_normal_prohibido(gql_usuario_normal, ruta):
    """Un estudiante autenticado NO puede descargar reportes administrativos."""
    assert gql_usuario_normal.get(ruta).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("ruta", RUTAS)
def test_pdf_guardia_prohibido(gql_guardia, ruta):
    """Tampoco el guardia: son reportes de administración."""
    assert gql_guardia.get(ruta).status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("ruta", RUTAS)
def test_pdf_admin_permitido(gql_admin, ruta):
    resp = gql_admin.get(ruta)
    assert resp.status_code == 200
    assert resp["Content-Type"] == "application/pdf"
