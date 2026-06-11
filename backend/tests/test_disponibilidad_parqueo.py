"""
Tests de Mejora 1 — Cupos de Parqueo Dinámicos con Alertas de Saturación.

Verifica que `disponibilidadZonas` retorna conteos REALES desde la BD,
calcula el estado correcto según las reglas de negocio y no cuenta espacios
en mantenimiento como libres.
"""
import json
import pytest
from apps.parqueos.models import (
    ZonaParqueo, EspacioParqueo, CategoriaEspacio, SesionParqueo,
)
from apps.parqueos.schema import _calcular_estado, _color_estado


# ── Helper ────────────────────────────────────────────────────────────────────

def gql_disponibilidad(client):
    # El cache de 30s (LocMem) persiste entre tests del mismo proceso — sin esto,
    # un test puede recibir la lista de zonas cacheada por el test anterior.
    from django.core.cache import cache
    from apps.parqueos.schema import CACHE_KEY_DISPONIBILIDAD
    cache.delete(CACHE_KEY_DISPONIBILIDAD)
    resp = client.post(
        "/graphql/",
        data=json.dumps({"query": """
            query {
              disponibilidadZonas {
                id nombre libres sesionesActivas enMantenimiento
                porcentajeLibre estado colorEstado capacidadTotal
              }
            }
        """}),
        content_type="application/json",
    )
    return resp.json()


# ── Tests de lógica de negocio pura (sin BD) ─────────────────────────────────

class TestCalcularEstado:
    """Verifica las reglas de estado sin tocar la BD."""

    def test_disponible_cuando_mas_del_40_porciento_libre(self):
        assert _calcular_estado(libres=50, total_util=100) == "disponible"
        assert _calcular_estado(libres=41, total_util=100) == "disponible"

    def test_limitado_entre_10_y_40_porciento(self):
        assert _calcular_estado(libres=40, total_util=100) == "limitado"
        assert _calcular_estado(libres=20, total_util=100) == "limitado"
        assert _calcular_estado(libres=11, total_util=100) == "limitado"

    def test_saturado_menor_10_porciento(self):
        assert _calcular_estado(libres=10, total_util=100) == "saturado"
        assert _calcular_estado(libres=5,  total_util=100) == "saturado"
        assert _calcular_estado(libres=1,  total_util=100) == "saturado"

    def test_lleno_cuando_cero_libres(self):
        assert _calcular_estado(libres=0, total_util=100) == "lleno"
        assert _calcular_estado(libres=0, total_util=10)  == "lleno"

    def test_sin_datos_cuando_total_util_cero(self):
        assert _calcular_estado(libres=0, total_util=0) == "sin_datos"

    def test_colores_correctos_por_estado(self):
        assert _color_estado("disponible") == "#22c55e"
        assert _color_estado("limitado")   == "#f59e0b"
        assert _color_estado("saturado")   == "#f97316"
        assert _color_estado("lleno")      == "#ef4444"
        assert _color_estado("sin_datos")  == "#94a3b8"


# ── Tests de integración con BD ───────────────────────────────────────────────

@pytest.mark.django_db
class TestDisponibilidadZonasQuery:

    @pytest.fixture
    def zona_con_espacios(self, db):
        """Zona con 10 espacios: 6 disponibles, 2 ocupados, 1 mantenimiento, 1 reservado."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona A — Test", capacidad_total=10, activo=True
        )
        for i in range(6):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"T0{i+1}", estado="disponible"
            )
        EspacioParqueo.objects.create(zona=zona, categoria=cat, numero="T07", estado="ocupado")
        EspacioParqueo.objects.create(zona=zona, categoria=cat, numero="T08", estado="ocupado")
        EspacioParqueo.objects.create(zona=zona, categoria=cat, numero="T09", estado="mantenimiento")
        EspacioParqueo.objects.create(zona=zona, categoria=cat, numero="T10", estado="reservado")
        return zona

    def test_libres_retorna_solo_disponibles(self, gql_client, zona_con_espacios):
        """libres debe ser 6 (no cuenta mantenimiento ni reservado)."""
        data = gql_disponibilidad(gql_client)
        assert "errors" not in data, data.get("errors")
        zonas = data["data"]["disponibilidadZonas"]
        z = next((z for z in zonas if "Zona A" in z["nombre"]), None)
        assert z is not None, "Zona A — Test no encontrada en el response"
        assert z["libres"] == 6

    def test_mantenimiento_no_cuenta_como_libre(self, gql_client, zona_con_espacios):
        """El espacio en mantenimiento (T09) NO debe aparecer como libre."""
        data = gql_disponibilidad(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        z = next(z for z in zonas if "Zona A" in z["nombre"])
        assert z["enMantenimiento"] == 1
        # total_util = 10 - 1 (mant) - 1 (reserv) = 8
        # libres = 6 → porcentaje = 6/8 = 75% → disponible
        assert z["estado"] == "disponible"

    def test_estado_limitado_con_pocos_libres(self, db, gql_client):
        """Con 2 libres de 10 usables → 20% → limitado."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona B — LimitTest", capacidad_total=10, activo=True
        )
        for i in range(2):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"L0{i+1}", estado="disponible"
            )
        for i in range(8):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"L{i+10}", estado="ocupado"
            )
        data = gql_disponibilidad(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        z = next(z for z in zonas if "LimitTest" in z["nombre"])
        assert z["libres"] == 2
        assert z["estado"] == "limitado"

    def test_estado_lleno_con_cero_libres(self, db, gql_client):
        """Con 0 disponibles → lleno. La zona no debería seleccionarse."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona C — FullTest", capacidad_total=5, activo=True
        )
        for i in range(5):
            EspacioParqueo.objects.create(
                zona=zona, categoria=cat, numero=f"F0{i+1}", estado="ocupado"
            )
        data = gql_disponibilidad(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        z = next(z for z in zonas if "FullTest" in z["nombre"])
        assert z["libres"] == 0
        assert z["estado"] == "lleno"
        assert z["colorEstado"] == "#ef4444"

    def test_zonas_inactivas_no_aparecen(self, db, gql_client):
        """Zonas con activo=False no deben aparecer en disponibilidadZonas."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona_inactiva = ZonaParqueo.objects.create(
            nombre="Zona Inactiva — HiddenTest", capacidad_total=10, activo=False
        )
        data = gql_disponibilidad(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        nombres = [z["nombre"] for z in zonas]
        assert not any("HiddenTest" in n for n in nombres)

    def test_sesiones_activas_contadas_correctamente(self, db, gql_client, vehiculo_activo):
        """sesionesActivas debe reflejar el conteo real de SesionParqueo activas."""
        cat, _ = CategoriaEspacio.objects.get_or_create(
            nombre="General", defaults={"color": "#4ade80"}
        )
        zona = ZonaParqueo.objects.create(
            nombre="Zona D — SessionTest", capacidad_total=5, activo=True
        )
        esp1 = EspacioParqueo.objects.create(
            zona=zona, categoria=cat, numero="S01", estado="ocupado"
        )
        esp2 = EspacioParqueo.objects.create(
            zona=zona, categoria=cat, numero="S02", estado="disponible"
        )
        # Crear sesión activa en esp1
        SesionParqueo.objects.create(espacio=esp1, vehiculo=vehiculo_activo, estado="activa")

        data = gql_disponibilidad(gql_client)
        zonas = data["data"]["disponibilidadZonas"]
        z = next(z for z in zonas if "SessionTest" in z["nombre"])
        assert z["sesionesActivas"] == 1
        assert z["libres"] == 1  # solo esp2 está disponible
