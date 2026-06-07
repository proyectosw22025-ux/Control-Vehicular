"""
Tests del motor OCR de placas vehiculares v3 — FastALPR + fallback pytesseract.

Verifica:
  - Normalización de placas bolivianas (varios formatos)
  - Clasificación de niveles de confianza (alto/medio/bajo)
  - Endpoint POST /api/ocr/placa/ acepta base64 y retorna placa+confianza+nivel
  - Modo multi-frame: acepta array de imágenes y vota el resultado
  - Fallback: si FastALPR no está disponible, pytesseract responde
  - Autenticación requerida para el endpoint
"""
import base64
import io
import json
import pytest
from unittest.mock import patch, MagicMock

from apps.vehiculos.ocr_view import (
    _normalizar_placa,
    _nivel_confianza,
    _generar_imagen_prueba,
)


# ── Tests de normalización ────────────────────────────────────────────────────

class TestNormalizarPlaca:

    def test_placa_con_guion(self):
        assert _normalizar_placa("SCZ-3456") == "SCZ-3456"

    def test_placa_sin_guion_agrega_guion(self):
        assert _normalizar_placa("SCZ3456") == "SCZ-3456"

    def test_placa_con_espacios_y_ruido(self):
        assert _normalizar_placa("  SCZ 3456  ") == "SCZ-3456"

    def test_placa_lowercase_normaliza(self):
        assert _normalizar_placa("scz-3456") == "SCZ-3456"

    def test_placa_cbba(self):
        assert _normalizar_placa("CBBA-1234") is not None

    def test_texto_sin_placa_retorna_none(self):
        assert _normalizar_placa("HOLA MUNDO") is None
        assert _normalizar_placa("") is None
        assert _normalizar_placa("12345") is None

    def test_placa_con_letra_final(self):
        resultado = _normalizar_placa("SCZ-3456A")
        assert resultado is not None
        assert "SCZ" in resultado


# ── Tests de nivel de confianza ───────────────────────────────────────────────

class TestNivelConfianza:

    def test_alto_desde_085(self):
        assert _nivel_confianza(0.85) == "alto"
        assert _nivel_confianza(0.95) == "alto"
        assert _nivel_confianza(1.0)  == "alto"

    def test_medio_entre_060_y_084(self):
        assert _nivel_confianza(0.60) == "medio"
        assert _nivel_confianza(0.75) == "medio"
        assert _nivel_confianza(0.84) == "medio"

    def test_bajo_menos_de_060(self):
        assert _nivel_confianza(0.59) == "bajo"
        assert _nivel_confianza(0.30) == "bajo"
        assert _nivel_confianza(0.0)  == "bajo"


# ── Tests del endpoint HTTP ───────────────────────────────────────────────────

@pytest.mark.django_db
class TestEndpointOcrPlaca:

    def _imagen_b64(self, texto="SCZ-3456") -> str:
        return base64.b64encode(_generar_imagen_prueba(texto)).decode()

    def test_requiere_autenticacion(self, gql_client):
        resp = gql_client.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": self._imagen_b64()}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_retorna_placa_y_confianza_con_fastalpr(self, gql_admin):
        """Con FastALPR mockeado, el endpoint retorna estructura correcta."""
        mock_result = MagicMock()
        mock_result.ocr.text       = "SCZ-3456"
        mock_result.ocr.confidence = 0.92
        mock_result.detection.confidence = 0.95

        with patch("apps.vehiculos.ocr_view._get_fast_alpr") as mock_alpr_fn:
            mock_alpr = MagicMock()
            mock_alpr.predict.return_value = [mock_result]
            mock_alpr_fn.return_value = mock_alpr

            resp = gql_admin.post(
                "/api/ocr/placa/",
                data=json.dumps({"imagen": self._imagen_b64()}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["placa"]     == "SCZ-3456"
        assert data["confianza"] == 0.92
        assert data["nivel"]     == "alto"
        assert data["metodo"]    == "fast-alpr-yolov9"
        assert "ms" in data

    def test_fallback_pytesseract_cuando_fastalpr_no_disponible(self, gql_admin):
        """Cuando FastALPR retorna None, usa pytesseract."""
        with patch("apps.vehiculos.ocr_view._get_fast_alpr", return_value=None):
            with patch("apps.vehiculos.ocr_view._reconocer_pytesseract") as mock_tess:
                mock_tess.return_value = {
                    "placa": "CBB-1234", "confianza": 0.80,
                    "metodo": "pytesseract", "ms": 350,
                }
                resp = gql_admin.post(
                    "/api/ocr/placa/",
                    data=json.dumps({"imagen": self._imagen_b64("CBB-1234")}),
                    content_type="application/json",
                )

        assert resp.status_code == 200
        data = resp.json()
        assert data["placa"]  == "CBB-1234"
        assert data["metodo"] == "pytesseract"
        assert data["nivel"]  == "medio"

    def test_retorna_null_cuando_no_detecta_placa(self, gql_admin):
        """Sin placa detectada, retorna placa=null sin romper."""
        with patch("apps.vehiculos.ocr_view._get_fast_alpr") as mock_fn:
            mock_alpr = MagicMock()
            mock_alpr.predict.return_value = []  # sin detecciones
            mock_fn.return_value = mock_alpr

            resp = gql_admin.post(
                "/api/ocr/placa/",
                data=json.dumps({"imagen": self._imagen_b64()}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["placa"] is None
        assert data["confianza"] == 0.0

    def test_json_invalido_retorna_400(self, gql_admin):
        resp = gql_admin.post(
            "/api/ocr/placa/",
            data="no-es-json",
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_base64_invalido_retorna_400(self, gql_admin):
        resp = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagen": "esto-no-es-base64!!!"}),
            content_type="application/json",
        )
        assert resp.status_code == 400


# ── Tests del modo multi-frame ────────────────────────────────────────────────

@pytest.mark.django_db
class TestModoMultiframe:

    def test_multiframe_vota_placa_mas_frecuente(self, gql_admin):
        """Con 3 frames, vota la placa que más veces aparece."""
        call_count = [0]

        def mock_fastalpr_predict(frame):
            call_count[0] += 1
            # Frames 1 y 3 → SCZ-3456, Frame 2 → LPZ-9999
            m = MagicMock()
            if call_count[0] == 2:
                m.ocr.text       = "LPZ-9999"
                m.ocr.confidence = 0.88
            else:
                m.ocr.text       = "SCZ-3456"
                m.ocr.confidence = 0.91
            m.detection.confidence = 0.95
            return [m]

        with patch("apps.vehiculos.ocr_view._get_fast_alpr") as mock_fn:
            mock_alpr = MagicMock()
            mock_alpr.predict.side_effect = mock_fastalpr_predict
            mock_fn.return_value = mock_alpr

            b64 = base64.b64encode(_generar_imagen_prueba("SCZ-3456")).decode()
            resp = gql_admin.post(
                "/api/ocr/placa/",
                data=json.dumps({"imagenes": [b64, b64, b64]}),
                content_type="application/json",
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["placa"] == "SCZ-3456"  # ganó por 2 votos vs 1
        assert "frames_procesados" in data

    def test_multiframe_vacio_retorna_400(self, gql_admin):
        """Array de imágenes vacío (sin imagen ni imagenes) → 400 Bad Request."""
        # imagenes=[] es falsy → cae al bloque de imagen single-frame
        # que tampoco tiene dato → 400. Comportamiento correcto.
        resp = gql_admin.post(
            "/api/ocr/placa/",
            data=json.dumps({"imagenes": []}),
            content_type="application/json",
        )
        assert resp.status_code == 400
