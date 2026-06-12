"""
Tests para OcrPlacaView con pytesseract mockeado — sin instalación de Tesseract en CI.
"""
import base64
import io
import json
import sys
import pytest
from unittest.mock import patch, MagicMock
from PIL import Image


def _patch_fallback_pytesseract(texto_ocr: str):
    """Fuerza el camino pytesseract: FastALPR fuera + modulo pytesseract mockeado.
    El import de pytesseract es lazy (dentro de la funcion), asi que el parche
    debe ir a sys.modules — parchear el atributo del modulo ya no funciona."""
    mock_tess = MagicMock()
    mock_tess.image_to_string.return_value = texto_ocr
    class _Ctx:
        def __enter__(self):
            self.p1 = patch("apps.vehiculos.ocr_view._get_fast_alpr", return_value=None)
            self.p2 = patch.dict(sys.modules, {"pytesseract": mock_tess})
            self.p1.start(); self.p2.start()
            return mock_tess
        def __exit__(self, *a):
            self.p2.stop(); self.p1.stop()
    return _Ctx()


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
def test_ocr_detecta_placa_con_guion(gql_admin):
    with _patch_fallback_pytesseract("SCZ-3456"):
        r = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": _imagen_b64()}),
            content_type="application/json",
        )
    assert r.status_code == 200
    data = r.json()
    assert data["placa"] == "SCZ-3456"
    assert data["confianza"] >= 0.80  # formato valido -> confianza del fallback


@pytest.mark.django_db
def test_ocr_normaliza_placa_sin_guion(gql_admin):
    """SCZ3456 → SCZ-3456 (inserta guión automáticamente)."""
    with _patch_fallback_pytesseract("SCZ3456"):
        r = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": _imagen_b64()}),
            content_type="application/json",
        )
    assert r.status_code == 200
    assert r.json()["placa"] == "SCZ-3456"


@pytest.mark.django_db
def test_ocr_ignora_ruido_y_extrae_placa(gql_admin):
    """Texto con ruido alrededor → extrae solo la placa."""
    with _patch_fallback_pytesseract("...ABC 1234!!!"):
        r = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": _imagen_b64()}),
            content_type="application/json",
        )
    assert r.status_code == 200
    assert r.json()["placa"] == "ABC-1234"


# ── Sin detección ─────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_ocr_sin_placa_retorna_null(gql_admin):
    with _patch_fallback_pytesseract("TEXTO SIN FORMATO"):
        r = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": _imagen_b64()}),
            content_type="application/json",
        )
    assert r.status_code == 200
    assert r.json()["placa"] is None


@pytest.mark.django_db
def test_ocr_resultado_vacio_retorna_null(gql_admin):
    with _patch_fallback_pytesseract(""):
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
def test_ocr_confianza_alta_con_guion(gql_admin):
    """Placa con formato válido → confianza 0.80 del fallback pytesseract."""
    with _patch_fallback_pytesseract("CBB-4567"):
        r = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": _imagen_b64()}),
            content_type="application/json",
        )
    assert r.json()["confianza"] == 0.80
