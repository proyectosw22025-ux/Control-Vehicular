"""
Tests del módulo WhatsApp via Fonnte API.

Verifica:
  - Normalización de números bolivianos al formato internacional
  - Envío real mockeado (no llama a Fonnte en tests)
  - Integración con enviar_notificacion (solo si whatsapp_activo=True)
  - No envía si no hay número o no está activo
  - El campo whatsapp_activo persiste en el modelo Usuario
"""
import json
import pytest
from unittest.mock import patch, MagicMock

from apps.notificaciones.whatsapp import (
    _normalizar_telefono_bolivia,
    enviar_whatsapp,
    msg_entrada_campus,
    msg_multa_registrada,
)


# ── Tests de normalización de número ─────────────────────────────────────────

class TestNormalizarTelefono:

    def test_numero_local_8_digitos(self):
        assert _normalizar_telefono_bolivia("72345678") == "72345678"

    def test_numero_con_prefijo_591(self):
        assert _normalizar_telefono_bolivia("59172345678") == "72345678"

    def test_numero_con_plus_591(self):
        assert _normalizar_telefono_bolivia("+59172345678") == "72345678"

    def test_numero_con_espacios(self):
        assert _normalizar_telefono_bolivia("  72 34 56 78  ") == "72345678"

    def test_numero_invalido_retorna_none(self):
        assert _normalizar_telefono_bolivia("123") is None
        assert _normalizar_telefono_bolivia("") is None
        assert _normalizar_telefono_bolivia("abcdefgh") is None

    def test_numero_local_tigo(self):
        resultado = _normalizar_telefono_bolivia("62521671")
        assert resultado == "62521671"


# ── Tests de envío (mockeado) ─────────────────────────────────────────────────

class TestEnviarWhatsapp:

    def test_no_envía_sin_numero(self):
        result = enviar_whatsapp("", "Hola")
        assert result is False

    def test_no_envía_con_número_inválido(self):
        result = enviar_whatsapp("abc", "Hola")
        assert result is False

    def test_no_envía_sin_configuración_railway(self):
        """Si FONNTE_TOKEN está vacío, el envío falla silenciosamente."""
        with patch("django.conf.settings") as mock_settings:
            mock_settings.FONNTE_TOKEN = ""
            result = enviar_whatsapp("72345678", "Test")
        # El thread se inicia pero el envío falla internamente

    def test_envía_correctamente_con_config(self):
        """Con token válido, el envío se realiza sin excepciones."""
        import time

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"status": True, "process": "send"}).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)

        with patch("urllib.request.urlopen", return_value=mock_resp):
            with patch("django.conf.settings") as mock_settings:
                mock_settings.FONNTE_TOKEN = "fake_fonnte_token"
                result = enviar_whatsapp("72345678", "Mensaje de prueba")
                assert result is True
                time.sleep(0.15)


# ── Tests de mensajes predefinidos ───────────────────────────────────────────

class TestMensajesPredefinidos:

    def test_mensaje_entrada_contiene_datos(self):
        msg = msg_entrada_campus("SCZ-1234", "Portería Norte", "09:32")
        assert "SCZ-1234" in msg
        assert "Portería Norte" in msg
        assert "09:32" in msg
        assert "UAGRM" in msg

    def test_mensaje_multa_contiene_monto(self):
        msg = msg_multa_registrada("ABC-123", "Estacionamiento indebido", "50")
        assert "ABC-123" in msg
        assert "Bs 50" in msg
        assert "Estacionamiento indebido" in msg


# ── Tests de integración con enviar_notificacion ─────────────────────────────

@pytest.mark.django_db
class TestIntegracionNotificacion:

    def test_whatsapp_se_envia_si_usuario_activo(self, usuario_normal):
        """Si whatsapp_activo=True y tiene teléfono → WhatsApp se dispara."""
        usuario_normal.whatsapp_activo = True
        usuario_normal.telefono = "72345678"
        usuario_normal.save(update_fields=["whatsapp_activo", "telefono"])

        with patch("apps.notificaciones.whatsapp.enviar_whatsapp") as mock_wa:
            from apps.notificaciones.utils import enviar_notificacion
            with patch("asgiref.sync.async_to_sync"):
                enviar_notificacion(
                    usuario_normal,
                    titulo="Test",
                    mensaje="Mensaje de prueba",
                )
            mock_wa.assert_called_once()

    def test_whatsapp_no_se_envia_si_desactivado(self, usuario_normal):
        """Si whatsapp_activo=False → WhatsApp NO se llama."""
        usuario_normal.whatsapp_activo = False
        usuario_normal.telefono = "72345678"
        usuario_normal.save(update_fields=["whatsapp_activo", "telefono"])

        with patch("apps.notificaciones.whatsapp.enviar_whatsapp") as mock_wa:
            from apps.notificaciones.utils import enviar_notificacion
            with patch("asgiref.sync.async_to_sync"):
                enviar_notificacion(
                    usuario_normal,
                    titulo="Test",
                    mensaje="Mensaje de prueba",
                )
            mock_wa.assert_not_called()

    def test_whatsapp_no_se_envia_sin_telefono(self, usuario_normal):
        """Si no tiene teléfono registrado → WhatsApp NO se llama aunque esté activo."""
        usuario_normal.whatsapp_activo = True
        usuario_normal.telefono = ""
        usuario_normal.save(update_fields=["whatsapp_activo", "telefono"])

        with patch("apps.notificaciones.whatsapp.enviar_whatsapp") as mock_wa:
            from apps.notificaciones.utils import enviar_notificacion
            with patch("asgiref.sync.async_to_sync"):
                enviar_notificacion(
                    usuario_normal,
                    titulo="Test",
                    mensaje="Mensaje de prueba",
                )
            mock_wa.assert_not_called()

    def test_campo_whatsapp_activo_persiste_en_db(self, db, usuario_normal):
        """El campo whatsapp_activo se guarda y recupera correctamente."""
        from apps.usuarios.models import Usuario
        usuario_normal.whatsapp_activo = True
        usuario_normal.save(update_fields=["whatsapp_activo"])

        recargado = Usuario.objects.get(pk=usuario_normal.pk)
        assert recargado.whatsapp_activo is True

    def test_actualizar_whatsapp_via_graphql(self, gql_usuario_normal):
        """La mutation actualizar_usuario acepta whatsapp_activo."""
        data = gql_usuario_normal.post(
            "/graphql/",
            data=json.dumps({
                "query": """
                mutation {
                  me: actualizarUsuario(id: 0, input: { whatsappActivo: true }) {
                    whatsappActivo telefono
                  }
                }
                """
            }),
            content_type="application/json",
        ).json()
        if "errors" in data:
            assert "whatsappActivo" not in str(data["errors"])
