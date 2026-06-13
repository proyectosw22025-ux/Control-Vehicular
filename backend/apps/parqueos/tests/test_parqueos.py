"""Tests de sesiones de parqueo: iniciar, cerrar y validaciones de estado."""
import pytest
from apps.parqueos.models import SesionParqueo, EspacioParqueo
from conftest import graphql

INICIAR = """
mutation IniciarSesion($espacioId: Int!, $vehiculoId: Int!) {
  iniciarSesionParqueo(input: { espacioId: $espacioId, vehiculoId: $vehiculoId }) {
    id estado placaVehiculo espacio { numero }
  }
}
"""

CERRAR = """
mutation CerrarSesion($sesionId: Int!) {
  cerrarSesionParqueo(sesionId: $sesionId) {
    id estado horaSalida
  }
}
"""


@pytest.mark.django_db
def test_iniciar_sesion_exitosa(gql_admin, vehiculo_en_campus, espacio_disponible):
    r = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_en_campus.id,
    })
    assert "errors" not in r
    data = r["data"]["iniciarSesionParqueo"]
    assert data["estado"] == "activa"
    assert data["placaVehiculo"] == vehiculo_en_campus.placa

    # El espacio debe quedar ocupado
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "ocupado"


@pytest.mark.django_db
def test_no_iniciar_sesion_en_espacio_ocupado(gql_admin, vehiculo_en_campus, espacio_ocupado):
    r = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_ocupado.id,
        "vehiculoId": vehiculo_en_campus.id,
    })
    assert "errors" in r
    assert "no está disponible" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_vehiculo_no_puede_tener_dos_sesiones_activas(
    db, gql_admin, vehiculo_en_campus, zona, categoria_espacio
):
    e1 = EspacioParqueo.objects.create(zona=zona, categoria=categoria_espacio, numero="B01", estado="disponible")
    e2 = EspacioParqueo.objects.create(zona=zona, categoria=categoria_espacio, numero="B02", estado="disponible")

    graphql(gql_admin, INICIAR, {"espacioId": e1.id, "vehiculoId": vehiculo_en_campus.id})
    r = graphql(gql_admin, INICIAR, {"espacioId": e2.id, "vehiculoId": vehiculo_en_campus.id})

    assert "errors" in r
    assert "sesión de parqueo activa" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_cerrar_sesion_libera_espacio(gql_admin, vehiculo_en_campus, espacio_disponible):
    r_iniciar = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_en_campus.id,
    })
    sesion_id = r_iniciar["data"]["iniciarSesionParqueo"]["id"]

    r_cerrar = graphql(gql_admin, CERRAR, {"sesionId": sesion_id})
    assert "errors" not in r_cerrar
    assert r_cerrar["data"]["cerrarSesionParqueo"]["estado"] == "cerrada"
    assert r_cerrar["data"]["cerrarSesionParqueo"]["horaSalida"] is not None

    # El espacio debe volver a disponible
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "disponible"


@pytest.mark.django_db
def test_cerrar_sesion_inexistente(gql_admin):
    r = graphql(gql_admin, CERRAR, {"sesionId": 9999})
    assert "errors" in r
    assert "no encontrada" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_espacio_inexistente_lanza_error(gql_admin, vehiculo_en_campus):
    r = graphql(gql_admin, INICIAR, {"espacioId": 9999, "vehiculoId": vehiculo_en_campus.id})
    assert "errors" in r
    assert "no encontrado" in r["errors"][0]["message"]


# ── Coherencia acceso ↔ parqueo ───────────────────────────────────────────────

@pytest.mark.django_db
def test_no_estacionar_vehiculo_que_nunca_ingreso_al_campus(gql_admin, vehiculo_activo, espacio_disponible):
    """Un vehículo sin ningún registro de entrada no puede ocupar un espacio."""
    r = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_activo.id,
    })
    assert "errors" in r
    assert "no registra ingreso" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_no_estacionar_vehiculo_que_ya_salio_del_campus(gql_admin, vehiculo_en_campus, punto_acceso, espacio_disponible):
    """Si el último acceso del vehículo es una SALIDA, ya no está dentro — no puede estacionar."""
    from datetime import timedelta
    from django.utils import timezone
    from apps.acceso.models import RegistroAcceso
    salida = RegistroAcceso.objects.create(
        punto_acceso=punto_acceso, vehiculo=vehiculo_en_campus,
        tipo="salida", metodo_acceso="manual",
    )
    # auto_now_add puede empatar con la entrada del fixture — forzar posterioridad
    RegistroAcceso.objects.filter(pk=salida.pk).update(
        timestamp=timezone.now() + timedelta(seconds=5)
    )
    r = graphql(gql_admin, INICIAR, {
        "espacioId": espacio_disponible.id,
        "vehiculoId": vehiculo_en_campus.id,
    })
    assert "errors" in r
    assert "no registra ingreso" in r["errors"][0]["message"]


# ── Mantenimiento de espacios desde la app ───────────────────────────────────

MANTENIMIENTO = """
mutation Mant($espacioId: Int!, $enMantenimiento: Boolean!) {
  cambiarEstadoEspacio(espacioId: $espacioId, enMantenimiento: $enMantenimiento) {
    id numero estado
  }
}
"""


@pytest.mark.django_db
def test_admin_pone_espacio_en_mantenimiento(gql_admin, espacio_disponible):
    r = graphql(gql_admin, MANTENIMIENTO, {"espacioId": espacio_disponible.id, "enMantenimiento": True})
    assert "errors" not in r
    assert r["data"]["cambiarEstadoEspacio"]["estado"] == "mantenimiento"


@pytest.mark.django_db
def test_reactivar_espacio_en_mantenimiento(gql_admin, espacio_disponible):
    graphql(gql_admin, MANTENIMIENTO, {"espacioId": espacio_disponible.id, "enMantenimiento": True})
    r = graphql(gql_admin, MANTENIMIENTO, {"espacioId": espacio_disponible.id, "enMantenimiento": False})
    assert r["data"]["cambiarEstadoEspacio"]["estado"] == "disponible"


@pytest.mark.django_db
def test_no_mantenimiento_con_vehiculo_dentro(gql_admin, vehiculo_en_campus, espacio_disponible):
    """No se puede sacar de servicio un espacio ocupado — se exige cerrar la sesión."""
    graphql(gql_admin, INICIAR, {"espacioId": espacio_disponible.id, "vehiculoId": vehiculo_en_campus.id})
    r = graphql(gql_admin, MANTENIMIENTO, {"espacioId": espacio_disponible.id, "enMantenimiento": True})
    assert "errors" in r
    assert "vehículo dentro" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_mantenimiento_solo_admin(gql_guardia, espacio_disponible):
    r = graphql(gql_guardia, MANTENIMIENTO, {"espacioId": espacio_disponible.id, "enMantenimiento": True})
    assert "errors" in r
    assert "administradores" in r["errors"][0]["message"].lower()


# ── Vehículos temporales ocupando espacios ───────────────────────────────────

OCUPAR_TEMPORAL = """
mutation Ocupar($espacioId: Int!, $vtId: Int!) {
  ocuparEspacioTemporal(espacioId: $espacioId, vehiculoTemporalId: $vtId) {
    id estado placaVehiculo esTemporal
  }
}
"""


def _crear_temporal(placa="PROV-1"):
    from django.utils import timezone
    from datetime import timedelta
    from apps.acceso.models import VehiculoTemporal
    return VehiculoTemporal.objects.create(
        placa=placa, tipo="proveedor", destino="Bloque A",
        hora_limite=timezone.now() + timedelta(hours=2),
    )


@pytest.mark.django_db
def test_temporal_ocupa_espacio(gql_guardia, espacio_disponible):
    vt = _crear_temporal()
    r = graphql(gql_guardia, OCUPAR_TEMPORAL, {"espacioId": espacio_disponible.id, "vtId": vt.id})
    assert "errors" not in r
    data = r["data"]["ocuparEspacioTemporal"]
    assert data["estado"] == "activa"
    assert data["placaVehiculo"] == "PROV-1"
    assert data["esTemporal"] is True
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "ocupado"


@pytest.mark.django_db
def test_salida_temporal_libera_espacio(gql_guardia, espacio_disponible):
    """Cuando el temporal registra salida, su espacio vuelve a estar disponible."""
    from conftest import graphql as _g
    vt = _crear_temporal("PROV-2")
    graphql(gql_guardia, OCUPAR_TEMPORAL, {"espacioId": espacio_disponible.id, "vtId": vt.id})

    salida = """
    mutation Salida($placa: String!) {
      registrarSalidaTemporal(placa: $placa) { id activo }
    }
    """
    r = _g(gql_guardia, salida, {"placa": "PROV-2"})
    assert "errors" not in r
    espacio_disponible.refresh_from_db()
    assert espacio_disponible.estado == "disponible"
