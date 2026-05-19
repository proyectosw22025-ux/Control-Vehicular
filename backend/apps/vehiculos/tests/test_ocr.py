"""
Tests para OcrPlacaView — PaddleOCR mockeado para no descargar modelos en CI.

El mock simula el formato de salida real de PaddleOCR:
  result = [[
    [bbox_4puntos, ["TEXTO_DETECTADO", confianza_float]],
    ...
  ]]
"""
import base64
import io
import json
import pytest
from unittest.mock import patch, MagicMock
from PIL import Image


def _imagen_b64() -> str:
    """Genera una imagen JPEG mínima en base64 para las pruebas."""
    img = Image.new("RGB", (200, 50), color=(220, 220, 220))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def _ocr_mock(textos: list):
    """
    Construye un mock de PaddleOCR con la salida de result[0] dada.
    textos: lista de (texto, confianza).
    """
    bbox = [[0, 0], [100, 0], [100, 30], [0, 30]]
    m = MagicMock()
    m.ocr.return_value = [[[bbox, [t, c]] for t, c in textos]]
    return m


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
@patch("apps.vehiculos.ocr_view.OcrPlacaView._get_ocr")
def test_ocr_detecta_placa_con_guion(mock_get_ocr, gql_admin):
    mock_get_ocr.return_value = _ocr_mock([("SCZ-3456", 0.97)])
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    data = r.json()
    assert data["placa"] == "SCZ-3456"
    assert data["confianza"] >= 0.97


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.OcrPlacaView._get_ocr")
def test_ocr_normaliza_placa_sin_guion(mock_get_ocr, gql_admin):
    """SCZ3456 → SCZ-3456 (inserta guión automáticamente)."""
    mock_get_ocr.return_value = _ocr_mock([("SCZ3456", 0.93)])
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] == "SCZ-3456"


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.OcrPlacaView._get_ocr")
def test_ocr_retorna_mejor_candidato(mock_get_ocr, gql_admin):
    """Si hay múltiples detecciones, elige la de mayor confianza."""
    mock_get_ocr.return_value = _ocr_mock([
        ("ABC1234", 0.72),
        ("SCZ-3456", 0.95),
    ])
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] == "SCZ-3456"


# ── Sin detección ─────────────────────────────────────────────────────────

@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.OcrPlacaView._get_ocr")
def test_ocr_sin_placa_retorna_null(mock_get_ocr, gql_admin):
    mock_get_ocr.return_value = _ocr_mock([("TEXTO CUALQUIERA", 0.90)])
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] is None


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.OcrPlacaView._get_ocr")
def test_ocr_rechaza_baja_confianza(mock_get_ocr, gql_admin):
    """Detecciones con confianza < 0.70 se descartan."""
    mock_get_ocr.return_value = _ocr_mock([("SCZ3456", 0.65)])
    r = gql_admin.post(
        "/api/ocr/placa/",
        data=json.dumps({"imagen": _imagen_b64()}),
        content_type="application/json",
    )
    assert r.status_code == 200
    assert r.json()["placa"] is None


@pytest.mark.django_db
@patch("apps.vehiculos.ocr_view.OcrPlacaView._get_ocr")
def test_ocr_resultado_vacio_retorna_null(mock_get_ocr, gql_admin):
    mock_get_ocr.return_value = _ocr_mock([])
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
