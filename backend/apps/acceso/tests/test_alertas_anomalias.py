"""Tests para AlertaAcceso y detección de anomalías — Sprint D2."""
import pytest
from datetime import timedelta
from django.utils import timezone
from apps.acceso.models import AlertaAcceso, RegistroAcceso, PuntoAcceso
from apps.vehiculos.models import Vehiculo
from conftest import graphql

ALERTAS_QUERY = """
query Alertas($revisadas: Boolean) {
  alertasAcceso(revisadas: $revisadas) {
    id tipoAnomalia severidad descripcion revisada vehiculoPlaca
  }
}
"""

CONTEO_QUERY = """
query {
  conteoAlertasAcceso
}
"""

MARCAR_REVISADA = """
mutation Marcar($id: Int!) {
  marcarAlertaRevisada(alertaId: $id) {
    id revisada
  }
}
"""


@pytest.fixture
def alerta_frecuencia(db, vehiculo_activo):
    return AlertaAcceso.objects.create(
        vehiculo=vehiculo_activo,
        tipo_anomalia="frecuencia_excesiva",
        severidad="advertencia",
        descripcion="Test: 8 accesos en un día",
        fecha_analisis=timezone.now().date(),
    )


@pytest.fixture
def alerta_critica(db, vehiculo_activo):
    return AlertaAcceso.objects.create(
        vehiculo=vehiculo_activo,
        tipo_anomalia="vehiculo_sancionado",
        severidad="critica",
        descripcion="Vehículo sancionado con acceso",
        fecha_analisis=timezone.now().date(),
    )


@pytest.mark.django_db
def test_query_alertas_solo_admin(gql_guardia, alerta_frecuencia):
    r = graphql(gql_guardia, ALERTAS_QUERY, {"revisadas": False})
    assert "errors" in r


@pytest.mark.django_db
def test_query_alertas_admin_ve_pendientes(gql_admin, alerta_frecuencia, alerta_critica):
    r = graphql(gql_admin, ALERTAS_QUERY, {"revisadas": False})
    assert "errors" not in r
    ids = [a["id"] for a in r["data"]["alertasAcceso"]]
    assert alerta_frecuencia.id in ids
    assert alerta_critica.id in ids


@pytest.mark.django_db
def test_conteo_alertas_admin(gql_admin, alerta_frecuencia, alerta_critica):
    r = graphql(gql_admin, CONTEO_QUERY, {})
    assert "errors" not in r
    assert r["data"]["conteoAlertasAcceso"] >= 2


@pytest.mark.django_db
def test_marcar_alerta_revisada(gql_admin, alerta_frecuencia):
    r = graphql(gql_admin, MARCAR_REVISADA, {"id": alerta_frecuencia.id})
    assert "errors" not in r
    assert r["data"]["marcarAlertaRevisada"]["revisada"] is True
    alerta_frecuencia.refresh_from_db()
    assert alerta_frecuencia.revisada is True


@pytest.mark.django_db
def test_marcar_revisada_solo_admin(gql_guardia, alerta_frecuencia):
    r = graphql(gql_guardia, MARCAR_REVISADA, {"id": alerta_frecuencia.id})
    assert "errors" in r
    alerta_frecuencia.refresh_from_db()
    assert alerta_frecuencia.revisada is False


@pytest.mark.django_db
def test_alertas_revisadas_no_aparecen_en_pendientes(gql_admin, alerta_frecuencia):
    alerta_frecuencia.revisada = True
    alerta_frecuencia.save(update_fields=["revisada"])
    r = graphql(gql_admin, ALERTAS_QUERY, {"revisadas": False})
    assert "errors" not in r
    ids = [a["id"] for a in r["data"]["alertasAcceso"]]
    assert alerta_frecuencia.id not in ids


def _crear_accesos_ayer(vehiculo, punto_acceso, cantidad):
    """Crea registros de acceso con timestamp = ayer (override via update)."""
    ayer = timezone.now() - timedelta(days=1)
    ids = []
    for i in range(cantidad):
        r = RegistroAcceso.objects.create(
            vehiculo=vehiculo,
            punto_acceso=punto_acceso,
            tipo="entrada" if i % 2 == 0 else "salida",
        )
        ids.append(r.pk)
    RegistroAcceso.objects.filter(pk__in=ids).update(timestamp=ayer)
    return ayer.date()


@pytest.mark.django_db
def test_task_frecuencia_excesiva_crea_alerta(vehiculo_activo, punto_acceso):
    """Simula 8 accesos ayer → tarea crea alerta de frecuencia excesiva."""
    from apps.notificaciones.tasks import detectar_anomalias_acceso
    _crear_accesos_ayer(vehiculo_activo, punto_acceso, 8)
    count_antes = AlertaAcceso.objects.filter(
        vehiculo=vehiculo_activo, tipo_anomalia="frecuencia_excesiva"
    ).count()
    detectar_anomalias_acceso()
    count_despues = AlertaAcceso.objects.filter(
        vehiculo=vehiculo_activo, tipo_anomalia="frecuencia_excesiva"
    ).count()
    assert count_despues > count_antes


@pytest.mark.django_db
def test_task_vehiculo_sancionado_crea_alerta(vehiculo_sancionado, punto_acceso):
    """Simula acceso de vehículo sancionado ayer → alerta crítica."""
    from apps.notificaciones.tasks import detectar_anomalias_acceso
    ayer = timezone.now() - timedelta(days=1)
    r = RegistroAcceso.objects.create(
        vehiculo=vehiculo_sancionado, punto_acceso=punto_acceso, tipo="entrada",
    )
    RegistroAcceso.objects.filter(pk=r.pk).update(timestamp=ayer)
    detectar_anomalias_acceso()
    assert AlertaAcceso.objects.filter(
        vehiculo=vehiculo_sancionado, tipo_anomalia="vehiculo_sancionado"
    ).exists()


@pytest.mark.django_db
def test_task_no_duplica_alertas(vehiculo_activo, punto_acceso):
    """Segunda ejecución de la tarea no duplica alertas del mismo día."""
    from apps.notificaciones.tasks import detectar_anomalias_acceso
    ayer = _crear_accesos_ayer(vehiculo_activo, punto_acceso, 8)
    detectar_anomalias_acceso()
    detectar_anomalias_acceso()  # segunda ejecución
    count = AlertaAcceso.objects.filter(
        vehiculo=vehiculo_activo, tipo_anomalia="frecuencia_excesiva",
        fecha_analisis=ayer,
    ).count()
    assert count == 1  # no se duplicó
