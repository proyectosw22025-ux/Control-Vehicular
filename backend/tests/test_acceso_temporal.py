"""
Tests de Mejora 4 — Acceso Temporal para Proveedores y Vehículos Externos.

Verifica:
  - Guardia puede registrar acceso temporal con placa, tipo y duración
  - No permite dos accesos activos simultáneos para la misma placa
  - Duración máxima de 8 horas, mínima de 30 min
  - Guardia puede registrar salida temporal por placa
  - La salida marca hora_salida y activo=False
  - Vehiculos_temporales_activos solo retorna los activos
  - Estudiante no puede registrar acceso temporal
"""
import json
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.acceso.models import VehiculoTemporal


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


REGISTRAR_TEMPORAL_GQL = """
mutation RegistrarAccesoTemporal(
  $placa: String! $tipo: String! $destino: String!
  $duracionHoras: Float! $responsable: String
) {
  registrarAccesoTemporal(
    placa: $placa tipo: $tipo destino: $destino
    duracionHoras: $duracionHoras responsable: $responsable
  ) {
    id placa tipo tipoDisplay destino activo minutosRestantes
  }
}
"""

REGISTRAR_SALIDA_GQL = """
mutation RegistrarSalidaTemporal($placa: String!) {
  registrarSalidaTemporal(placa: $placa) {
    id placa activo horaSalida
  }
}
"""

VEHICULOS_ACTIVOS_GQL = """
query VehiculosTemporalesActivos {
  vehiculosTemporalesActivos {
    id placa tipo destino activo minutosRestantes vencido
  }
}
"""


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestRegistroAccesoTemporal:

    def test_guardia_registra_acceso_temporal(self, gql_guardia):
        """El guardia puede registrar un vehículo externo correctamente."""
        data = gql(gql_guardia, REGISTRAR_TEMPORAL_GQL, {
            "placa": "EXT-001", "tipo": "proveedor",
            "destino": "Cafetería Central", "duracionHoras": 2.0,
            "responsable": "Jefe de Administración",
        })
        assert "errors" not in data, data.get("errors")
        r = data["data"]["registrarAccesoTemporal"]
        assert r["placa"] == "EXT-001"
        assert r["activo"] is True
        assert r["tipoDisplay"] == "Proveedor / Entrega"
        assert r["minutosRestantes"] > 100  # ~120 min

        vt = VehiculoTemporal.objects.get(pk=r["id"])
        assert vt.placa == "EXT-001"
        assert vt.tipo  == "proveedor"

    def test_placa_se_normaliza_a_mayusculas(self, gql_guardia):
        """La placa se convierte a mayúsculas automáticamente."""
        data = gql(gql_guardia, REGISTRAR_TEMPORAL_GQL, {
            "placa": "ext-099", "tipo": "visitante",
            "destino": "Decanatura", "duracionHoras": 1.0,
        })
        r = data["data"]["registrarAccesoTemporal"]
        assert r["placa"] == "EXT-099"

    def test_duracion_maxima_8_horas(self, gql_guardia):
        """La duración se limita a 8 horas máximo."""
        data = gql(gql_guardia, REGISTRAR_TEMPORAL_GQL, {
            "placa": "MAX-001", "tipo": "otro",
            "destino": "Test", "duracionHoras": 99.0,
        })
        r = data["data"]["registrarAccesoTemporal"]
        assert r["minutosRestantes"] <= 480 + 1  # max 8h = 480 min (con margen de 1 min por latencia)

    def test_duracion_minima_30_minutos(self, gql_guardia):
        """La duración mínima es 30 minutos."""
        data = gql(gql_guardia, REGISTRAR_TEMPORAL_GQL, {
            "placa": "MIN-001", "tipo": "emergencia",
            "destino": "Enfermería", "duracionHoras": 0.1,
        })
        r = data["data"]["registrarAccesoTemporal"]
        assert r["minutosRestantes"] >= 28  # 30 min con margen

    def test_no_permite_acceso_duplicado_activo(self, gql_guardia):
        """No puede haber dos accesos temporales activos para la misma placa."""
        gql(gql_guardia, REGISTRAR_TEMPORAL_GQL, {
            "placa": "DUP-001", "tipo": "visitante",
            "destino": "Secretaría", "duracionHoras": 1.0,
        })
        data = gql(gql_guardia, REGISTRAR_TEMPORAL_GQL, {
            "placa": "DUP-001", "tipo": "proveedor",
            "destino": "Otro lugar", "duracionHoras": 2.0,
        })
        assert "errors" in data
        assert "acceso temporal activo" in data["errors"][0]["message"].lower()

    def test_estudiante_no_puede_registrar_temporal(self, gql_usuario_normal):
        """Un estudiante no tiene acceso a esta funcionalidad."""
        data = gql(gql_usuario_normal, REGISTRAR_TEMPORAL_GQL, {
            "placa": "EST-001", "tipo": "visitante",
            "destino": "Test", "duracionHoras": 1.0,
        })
        assert "errors" in data


@pytest.mark.django_db
class TestSalidaTemporal:

    @pytest.fixture
    def vt_activo(self, db, guardia):
        return VehiculoTemporal.objects.create(
            placa="SAL-001",
            tipo="proveedor",
            destino="Almacén",
            hora_limite=timezone.now() + timedelta(hours=2),
            activo=True,
            registrado_por=guardia,
        )

    def test_guardia_registra_salida(self, gql_guardia, vt_activo):
        """El guardia puede registrar la salida de un vehículo temporal."""
        data = gql(gql_guardia, REGISTRAR_SALIDA_GQL, {"placa": "SAL-001"})
        assert "errors" not in data, data.get("errors")
        r = data["data"]["registrarSalidaTemporal"]
        assert r["activo"] is False
        assert r["horaSalida"] is not None

        vt_activo.refresh_from_db()
        assert not vt_activo.activo
        assert vt_activo.hora_salida is not None

    def test_salida_placa_inexistente_da_error(self, gql_guardia):
        """Registrar salida de placa que no existe da error claro."""
        data = gql(gql_guardia, REGISTRAR_SALIDA_GQL, {"placa": "NOE-999"})
        assert "errors" in data

    def test_vehiculo_ya_salido_da_error(self, gql_guardia, vt_activo):
        """Registrar salida dos veces da error en la segunda."""
        gql(gql_guardia, REGISTRAR_SALIDA_GQL, {"placa": "SAL-001"})
        data = gql(gql_guardia, REGISTRAR_SALIDA_GQL, {"placa": "SAL-001"})
        assert "errors" in data


@pytest.mark.django_db
class TestVehiculosTemporalesActivos:

    def test_query_retorna_solo_activos(self, db, gql_guardia, guardia):
        """La query solo retorna vehículos con activo=True."""
        VehiculoTemporal.objects.create(
            placa="ACT-001", tipo="visitante", destino="SAI",
            hora_limite=timezone.now() + timedelta(hours=1),
            activo=True, registrado_por=guardia,
        )
        VehiculoTemporal.objects.create(
            placa="SAL-002", tipo="otro", destino="Test",
            hora_limite=timezone.now() - timedelta(hours=1),
            activo=False, registrado_por=guardia,
        )
        data = gql(gql_guardia, VEHICULOS_ACTIVOS_GQL)
        activos = data["data"]["vehiculosTemporalesActivos"]
        placas = [v["placa"] for v in activos]
        assert "ACT-001" in placas
        assert "SAL-002" not in placas

    def test_vencido_true_cuando_hora_limite_pasada(self, db, gql_guardia, guardia):
        """vencido=True cuando hora_limite ya pasó y sigue activo."""
        VehiculoTemporal.objects.create(
            placa="VEN-001", tipo="proveedor", destino="Test",
            hora_limite=timezone.now() - timedelta(minutes=10),
            activo=True, registrado_por=guardia,
        )
        data = gql(gql_guardia, VEHICULOS_ACTIVOS_GQL)
        vencido = next(v for v in data["data"]["vehiculosTemporalesActivos"] if v["placa"] == "VEN-001")
        assert vencido["vencido"] is True
        assert vencido["minutosRestantes"] == 0
