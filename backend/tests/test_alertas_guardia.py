"""
Tests de Mejora 3 — Panel de Alertas en Tiempo Real para el Guardia.

Verifica:
  - Detección de frecuencia excesiva (>3 entradas en 2 horas)
  - Detección de multas pendientes → alerta crítica
  - alertas_activas_panel devuelve alertas no revisadas de las últimas 24h
  - Guardia puede marcar alertas como revisadas
  - La detección no genera alertas duplicadas en la misma ventana de tiempo
"""
import json
import pytest
from django.utils import timezone
from datetime import timedelta
from unittest.mock import patch

from apps.acceso.models import AlertaAcceso, PuntoAcceso, RegistroAcceso
from apps.acceso.schema import _detectar_anomalias_acceso


# ── Helper ────────────────────────────────────────────────────────────────────

def gql(client, query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    return client.post(
        "/graphql/",
        data=json.dumps(payload),
        content_type="application/json",
    ).json()


ALERTAS_PANEL_GQL = """
query AlertasActivasPanel($limite: Int) {
  alertasActivasPanel(limite: $limite) {
    id tipoAnomalia severidad descripcion revisada vehiculoPlaca
  }
}
"""

MARCAR_REVISADA_GQL = """
mutation MarcarAlertaRevisada($alertaId: Int!) {
  marcarAlertaRevisada(alertaId: $alertaId) { id revisada }
}
"""


# ── Tests de detección de anomalías ──────────────────────────────────────────

@pytest.mark.django_db
class TestDeteccionAnomalias:

    def test_detecta_frecuencia_excesiva(self, db, vehiculo_activo, punto_acceso, guardia):
        """Más de 3 entradas en 2 horas genera alerta advertencia."""
        # Crear 3 registros de entrada en la última hora
        for _ in range(3):
            RegistroAcceso.objects.create(
                vehiculo=vehiculo_activo,
                punto_acceso=punto_acceso,
                tipo="entrada",
                metodo_acceso="qr_dinamico",
                registrado_por=guardia,
                timestamp=timezone.now() - timedelta(minutes=30),
            )

        with patch("apps.acceso.schema._broadcast_alerta_ws"):
            alertas = _detectar_anomalias_acceso(vehiculo_activo, "entrada")

        assert len(alertas) >= 1
        frecuencia = next((a for a in alertas if a.tipo_anomalia == "frecuencia_excesiva"), None)
        assert frecuencia is not None
        assert frecuencia.severidad == "advertencia"
        assert vehiculo_activo.placa in frecuencia.descripcion

    def test_no_detecta_frecuencia_si_menos_de_3(self, db, vehiculo_activo, punto_acceso, guardia):
        """Con 2 entradas en 2 horas NO genera alerta de frecuencia."""
        for _ in range(2):
            RegistroAcceso.objects.create(
                vehiculo=vehiculo_activo,
                punto_acceso=punto_acceso,
                tipo="entrada",
                metodo_acceso="qr_dinamico",
                registrado_por=guardia,
            )
        with patch("apps.acceso.schema._broadcast_alerta_ws"):
            alertas = _detectar_anomalias_acceso(vehiculo_activo, "entrada")

        frecuencia = [a for a in alertas if a.tipo_anomalia == "frecuencia_excesiva"]
        assert len(frecuencia) == 0

    def test_detecta_multa_pendiente(self, db, vehiculo_activo):
        """Vehículo con multa pendiente genera alerta crítica."""
        from apps.multas.models import Multa, TipoMulta
        tipo_multa, _ = TipoMulta.objects.get_or_create(
            nombre="Test", defaults={"monto_base": 50.0}
        )
        Multa.objects.create(
            vehiculo=vehiculo_activo,
            tipo=tipo_multa,
            descripcion="Test multa",
            monto=50.0,
            estado="pendiente",
        )

        with patch("apps.acceso.schema._broadcast_alerta_ws"):
            alertas = _detectar_anomalias_acceso(vehiculo_activo, "entrada")

        multa_alerta = next((a for a in alertas if a.tipo_anomalia == "vehiculo_sancionado"), None)
        assert multa_alerta is not None
        assert multa_alerta.severidad == "critica"

    def test_no_crea_alerta_duplicada_en_ventana(self, db, vehiculo_activo, punto_acceso, guardia):
        """No crea alerta duplicada si ya existe una no revisada en la misma ventana."""
        for _ in range(3):
            RegistroAcceso.objects.create(
                vehiculo=vehiculo_activo, punto_acceso=punto_acceso,
                tipo="entrada", metodo_acceso="qr_dinamico",
                timestamp=timezone.now() - timedelta(minutes=10),
            )
        with patch("apps.acceso.schema._broadcast_alerta_ws"):
            alertas_1 = _detectar_anomalias_acceso(vehiculo_activo, "entrada")
            alertas_2 = _detectar_anomalias_acceso(vehiculo_activo, "entrada")

        frec_1 = [a for a in alertas_1 if a.tipo_anomalia == "frecuencia_excesiva"]
        frec_2 = [a for a in alertas_2 if a.tipo_anomalia == "frecuencia_excesiva"]
        assert len(frec_1) == 1, "Primera detección debe crear la alerta"
        assert len(frec_2) == 0, "Segunda detección no debe crear duplicado"

    def test_salida_no_genera_alertas(self, db, vehiculo_activo):
        """Las salidas no deben generar alertas de frecuencia (solo entradas)."""
        with patch("apps.acceso.schema._broadcast_alerta_ws"):
            alertas = _detectar_anomalias_acceso(vehiculo_activo, "salida")
        assert len(alertas) == 0


# ── Tests de queries y mutations ─────────────────────────────────────────────

@pytest.mark.django_db
class TestAlertasPanel:

    @pytest.fixture
    def alerta_activa(self, db, vehiculo_activo):
        return AlertaAcceso.objects.create(
            vehiculo=vehiculo_activo,
            tipo_anomalia="vehiculo_sancionado",
            severidad="critica",
            descripcion="Vehículo con multas pendientes",
            fecha_analisis=timezone.localdate(),
            revisada=False,
        )

    def test_guardia_puede_ver_alertas(self, gql_guardia, alerta_activa):
        """El guardia puede consultar el panel de alertas activas."""
        data = gql(gql_guardia, ALERTAS_PANEL_GQL, {"limite": 10})
        assert "errors" not in data, data.get("errors")
        alertas = data["data"]["alertasActivasPanel"]
        assert len(alertas) >= 1
        ids = [a["id"] for a in alertas]
        assert alerta_activa.pk in ids

    def test_usuario_normal_no_puede_ver_alertas(self, gql_usuario_normal, alerta_activa):
        """Un estudiante NO puede ver el panel de alertas del guardia."""
        data = gql(gql_usuario_normal, ALERTAS_PANEL_GQL, {"limite": 10})
        assert "errors" in data

    def test_alertas_ordenadas_critica_primero(self, db, gql_guardia, vehiculo_activo):
        """Las alertas críticas aparecen antes que las de advertencia."""
        AlertaAcceso.objects.create(
            vehiculo=vehiculo_activo, tipo_anomalia="frecuencia_excesiva",
            severidad="advertencia", descripcion="Advertencia test",
            fecha_analisis=timezone.localdate(), revisada=False,
        )
        AlertaAcceso.objects.create(
            vehiculo=vehiculo_activo, tipo_anomalia="vehiculo_sancionado",
            severidad="critica", descripcion="Critica test",
            fecha_analisis=timezone.localdate(), revisada=False,
        )
        data = gql(gql_guardia, ALERTAS_PANEL_GQL, {"limite": 10})
        alertas = data["data"]["alertasActivasPanel"]
        assert len(alertas) >= 2
        assert alertas[0]["severidad"] == "critica"

    def test_alertas_revisadas_no_aparecen(self, db, gql_guardia, vehiculo_activo):
        """Las alertas ya revisadas NO aparecen en el panel."""
        alerta_rev = AlertaAcceso.objects.create(
            vehiculo=vehiculo_activo, tipo_anomalia="frecuencia_excesiva",
            severidad="advertencia", descripcion="Ya revisada",
            fecha_analisis=timezone.localdate(), revisada=True,
        )
        data = gql(gql_guardia, ALERTAS_PANEL_GQL, {"limite": 10})
        alertas = data["data"]["alertasActivasPanel"]
        ids = [a["id"] for a in alertas]
        assert alerta_rev.pk not in ids

    def test_guardia_puede_marcar_revisada(self, gql_guardia, alerta_activa):
        """El guardia puede marcar una alerta como revisada."""
        data = gql(gql_guardia, MARCAR_REVISADA_GQL, {"alertaId": alerta_activa.pk})
        assert "errors" not in data, data.get("errors")
        result = data["data"]["marcarAlertaRevisada"]
        assert result["revisada"] is True

        # Verificar en BD
        alerta_activa.refresh_from_db()
        assert alerta_activa.revisada is True

    def test_alertas_mas_de_24h_no_aparecen(self, db, gql_guardia, vehiculo_activo):
        """Alertas de hace más de 24 horas no aparecen en el panel."""
        vieja = AlertaAcceso.objects.create(
            vehiculo=vehiculo_activo, tipo_anomalia="frecuencia_excesiva",
            severidad="advertencia", descripcion="Alerta vieja",
            fecha_analisis=(timezone.now() - timedelta(hours=25)).date(),
            revisada=False,
        )
        # Forzar fecha antigua
        AlertaAcceso.objects.filter(pk=vieja.pk).update(
            fecha=timezone.now() - timedelta(hours=25)
        )
        data = gql(gql_guardia, ALERTAS_PANEL_GQL, {"limite": 10})
        alertas = data["data"]["alertasActivasPanel"]
        ids = [a["id"] for a in alertas]
        assert vieja.pk not in ids
