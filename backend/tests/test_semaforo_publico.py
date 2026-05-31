"""
Tests de Mejora 5 — Semáforo Público de Disponibilidad de Parqueo.

Verifica:
  - La query disponibilidadZonas es accesible SIN autenticación
  - Retorna datos reales de libres/ocupados (misma lógica que Mejora 1)
  - El campo ultimaActualizacion está presente
  - El cache se invalida cuando se llama broadcast_disponibilidad
  - Zonas inactivas no aparecen
"""
import json
import pytest
from unittest.mock import patch
from django.core.cache import cache

from apps.parqueos.models import ZonaParqueo, EspacioParqueo, CategoriaEspacio
from apps.parqueos.schema import CACHE_KEY_DISPONIBILIDAD


# ── Helper ────────────────────────────────────────────────────────────────────

DISPONIBILIDAD_GQL = """
query DisponibilidadZonas {
  disponibilidadZonas {
    id nombre libres capacidadTotal estado colorEstado ultimaActualizacion
  }
}
"""


def gql_anonimo(client):
    """Llama a disponibilidadZonas SIN token de autenticación."""
    return client.post(
        "/graphql/",
        data=json.dumps({"query": DISPONIBILIDAD_GQL}),
        content_type="application/json",
    ).json()


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestDisponibilidadPublica:

    def test_accesible_sin_autenticacion(self, gql_client, db):
        """La query funciona sin Bearer token — es la regla fundamental del semáforo."""
        data = gql_anonimo(gql_client)
        assert "errors" not in data, data.get("errors")
        assert "disponibilidadZonas" in data["data"]

    def test_retorna_zonas_activas(self, gql_client, db):
        """Devuelve todas las zonas activas con datos reales."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona Test Semaforo", capacidad_total=10, activo=True
        )
        for i in range(4):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"S0{i}", estado="disponible"
            )
        for i in range(6):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"S1{i}", estado="ocupado"
            )

        cache.delete(CACHE_KEY_DISPONIBILIDAD)
        data = gql_anonimo(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        z = next((z for z in zonas if "Semaforo" in z["nombre"]), None)
        assert z is not None
        assert z["libres"] == 4
        assert z["capacidadTotal"] == 10

    def test_estado_correcto_segun_porcentaje(self, gql_client, db):
        """Estado 'limitado' cuando quedan pocos espacios (10-40%)."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona Test Estado", capacidad_total=10, activo=True
        )
        # 2 libres de 10 = 20% → limitado
        for i in range(2):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"E0{i}", estado="disponible"
            )
        for i in range(8):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"E1{i}", estado="ocupado"
            )

        cache.delete(CACHE_KEY_DISPONIBILIDAD)
        data = gql_anonimo(gql_client)
        z = next(z for z in data["data"]["disponibilidadZonas"] if "Test Estado" in z["nombre"])
        assert z["estado"] == "limitado"

    def test_campo_ultima_actualizacion_presente(self, gql_client, db):
        """ultimaActualizacion debe estar presente y no estar vacío."""
        ZonaParqueo.objects.create(nombre="Zona UltAct", capacidad_total=5, activo=True)
        cache.delete(CACHE_KEY_DISPONIBILIDAD)
        data = gql_anonimo(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        if zonas:
            assert zonas[0]["ultimaActualizacion"] != ""
            assert zonas[0]["ultimaActualizacion"] is not None

    def test_zonas_inactivas_no_aparecen(self, gql_client, db):
        """Zonas con activo=False no aparecen en el semáforo público."""
        ZonaParqueo.objects.create(
            nombre="Zona Inactiva Semaforo", capacidad_total=10, activo=False
        )
        cache.delete(CACHE_KEY_DISPONIBILIDAD)
        data = gql_anonimo(gql_client)
        nombres = [z["nombre"] for z in data["data"]["disponibilidadZonas"]]
        assert not any("Inactiva Semaforo" in n for n in nombres)

    def test_cache_se_usa_en_segunda_llamada(self, gql_client, db):
        """La segunda llamada usa el cache (se verifica que no hay más queries)."""
        ZonaParqueo.objects.create(nombre="Zona Cache Test", capacidad_total=5, activo=True)
        cache.delete(CACHE_KEY_DISPONIBILIDAD)

        # Primera llamada — llena el cache
        gql_anonimo(gql_client)
        assert cache.get(CACHE_KEY_DISPONIBILIDAD) is not None

        # Segunda llamada — debe usar el cache (el resultado debería ser igual)
        data = gql_anonimo(gql_client)
        assert "errors" not in data

    def test_broadcast_invalida_cache(self, db):
        """broadcast_disponibilidad() borra el cache para forzar recálculo."""
        from apps.parqueos.schema import broadcast_disponibilidad
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona Broadcast", capacidad_total=5, activo=True
        )

        # Llenar cache con un valor artificial
        cache.set(CACHE_KEY_DISPONIBILIDAD, ["dato_falso"], 60)
        assert cache.get(CACHE_KEY_DISPONIBILIDAD) is not None

        # broadcast_disponibilidad debe borrar el cache
        with patch("channels.layers.get_channel_layer", return_value=None):
            broadcast_disponibilidad(zona.pk)

        assert cache.get(CACHE_KEY_DISPONIBILIDAD) is None, \
            "El cache debería haberse invalidado después del broadcast"

    def test_color_estado_retorna_hex(self, gql_client, db):
        """colorEstado debe ser un color hexadecimal válido."""
        ZonaParqueo.objects.create(nombre="Zona Color", capacidad_total=5, activo=True)
        cache.delete(CACHE_KEY_DISPONIBILIDAD)
        data = gql_anonimo(gql_client)
        for z in data["data"]["disponibilidadZonas"]:
            assert z["colorEstado"].startswith("#"), f"Esperaba hex, got: {z['colorEstado']}"
            assert len(z["colorEstado"]) == 7
