"""
Tests para OcrPlacaView con pytesseract mockeado — sin instalación de Tesseract en CI.
"""
import base64
import io
import json
import pytest
from unittest.mock import patch
from PIL import Image


def _imagen_b64() -> str:
    img = Image.new("RGB", (300, 75), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


# ── Autenticación ─────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_ocr_sin_auth_devuelve_401(gql_client):
    r = gql_client.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 401


# ── Detección correcta ────────────────────────────────────────────────────

@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.pytesseract")
def test_ocr_detecta_placa_con_guion(mock_tess, gql_admin):
    mock_tess.image_to_string.return_value = "SCZ-3456"
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    data = r.json()
    assert data["placa"] == "SCZ-3456"
    assert data["confianza"] >= 0.85


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.pytesseract")
def test_ocr_normaliza_placa_sin_guion(mock_tess, gql_admin):
    """SCZ3456 → SCZ-3456 (inserta guión automáticamente)."""
    mock_tess.image_to_string.return_value = "SCZ3456"
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] == "SCZ-3456"


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.pytesseract")
def test_ocr_ignora_ruido_y_extrae_placa(mock_tess, gql_admin):
    """Texto con ruido alrededor → extrae solo la placa."""
    mock_tess.image_to_string.return_value = "...ABC 1234!!!"
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] == "ABC-1234"


# ── Sin detección ─────────────────────────────────────────────────────────

@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.pytesseract")
def test_ocr_sin_placa_retorna_null(mock_tess, gql_admin):
    mock_tess.image_to_string.return_value = "TEXTO SIN FORMATO"
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] is None


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.pytesseract")
def test_ocr_resultado_vacio_retorna_null(mock_tess, gql_admin):
    mock_tess.image_to_string.return_value = ""
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] is None


# ── Validaciones de entrada ───────────────────────────────────────────────

@pytest.mark.django_db
def test_ocr_sin_imagen_devuelve_400(gql_admin):
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": ""}),
        content_type="application/json",
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_ocr_base64_invalido_devuelve_400(gql_admin):
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": "NO_ES_BASE64!!!"}),
        content_type="application/json",
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_ocr_json_invalido_devuelve_400(gql_admin):
    r = gql_admin.post(
        "/api/ocr/placa/",
        data="esto no es json",
        content_type="application/json",
    )
    assert r.status_code == 400


# ── Confianza ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.pytesseract")
def test_ocr_confianza_alta_con_guion(mock_tess, gql_admin):
    """Placa con guión → confianza 0.85."""
    mock_tess.image_to_string.return_value = "CBB-4567"
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.json()["confianza"] == 0.85
