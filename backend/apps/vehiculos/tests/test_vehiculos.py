"""Tests de vehículos: aprobación, rechazo, visibilidad de pendientes y audit log."""
import pytest
from apps.vehiculos.models import Vehiculo, DocumentoVehiculo
from apps.acceso.models import AuditLog
from conftest import graphql

AGREGAR_DOCUMENTO = """
mutation AgregarDoc($input: AgregarDocumentoInput!) {
  agregarDocumento(input: $input) {
    id tipoDoc numero fechaVencimiento estado diasParaVencer archivoUrl
  }
}
"""

VEHICULOS_CON_DOCS = """
query VehiculosConDocs($propietarioId: Int) {
  vehiculos(propietarioId: $propietarioId) {
    items {
      id placa estadoDocumentacion
      documentos { id tipoDoc numero fechaVencimiento estado diasParaVencer archivoUrl }
    }
  }
}
"""

APROBAR = """
mutation Aprobar($id: Int!) {
  aprobarVehiculo(vehiculoId: $id) {
    id estado placa
  }
}
"""

RECHAZAR = """
mutation Rechazar($id: Int!, $motivo: String!) {
  rechazarVehiculo(vehiculoId: $id, motivo: $motivo) {
    id estado placa
  }
}
"""

VEHICULOS = """
query Vehiculos($propietarioId: Int) {
  vehiculos(propietarioId: $propietarioId) {
    items { id placa estado }
  }
}
"""


@pytest.mark.django_db
def test_aprobar_vehiculo_cambia_estado(gql_admin, vehiculo_pendiente):
    r = graphql(gql_admin, APROBAR, {"id": vehiculo_pendiente.id})
    assert "errors" not in r
    assert r["data"]["aprobarVehiculo"]["estado"] == "activo"
    vehiculo_pendiente.refresh_from_db()
    assert vehiculo_pendiente.estado == "activo"


@pytest.mark.django_db
def test_rechazar_vehiculo_cambia_estado_a_inactivo(gql_admin, vehiculo_pendiente):
    r = graphql(gql_admin, RECHAZAR, {"id": vehiculo_pendiente.id, "motivo": "Documentación incompleta"})
    assert "errors" not in r
    assert r["data"]["rechazarVehiculo"]["estado"] == "inactivo"
    vehiculo_pendiente.refresh_from_db()
    assert vehiculo_pendiente.estado == "inactivo"


@pytest.mark.django_db
def test_aprobar_vehiculo_no_pendiente_lanza_error(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, APROBAR, {"id": vehiculo_activo.id})
    assert "errors" in r
    assert "nválida" in r["errors"][0]["message"]  # máquina de estados: activo→activo no permitido


@pytest.mark.django_db
def test_aprobar_vehiculo_genera_audit_log(gql_admin, vehiculo_pendiente):
    graphql(gql_admin, APROBAR, {"id": vehiculo_pendiente.id})
    assert AuditLog.objects.filter(accion="vehiculo_aprobado").exists()


@pytest.mark.django_db
def test_rechazar_vehiculo_genera_audit_log(gql_admin, vehiculo_pendiente):
    graphql(gql_admin, RECHAZAR, {"id": vehiculo_pendiente.id, "motivo": "Test"})
    assert AuditLog.objects.filter(accion="vehiculo_rechazado").exists()


@pytest.mark.django_db
def test_propietario_ve_su_propio_vehiculo_pendiente(gql_guardia, usuario_normal, vehiculo_pendiente):
    """El dueño debe ver su vehículo pendiente en la lista aunque no sea admin."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    client = Client()
    token = str(RefreshToken.for_user(usuario_normal).access_token)
    client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    r = graphql(client, VEHICULOS, {"propietarioId": usuario_normal.id})
    assert "errors" not in r
    placas = [v["placa"] for v in r["data"]["vehiculos"]["items"]]
    assert vehiculo_pendiente.placa in placas


@pytest.mark.django_db
def test_no_admin_no_ve_pendientes_ajenos(gql_guardia, vehiculo_pendiente, usuario_normal):
    """Un guardia no debe ver vehículos pendientes de otros propietarios."""
    from apps.usuarios.models import Usuario
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    otro = Usuario.objects.create_user(
        ci="99999999", email="otro@test.com",
        nombre="Otro", apellido="Usuario", password="pass123"
    )
    client = Client()
    token = str(RefreshToken.for_user(otro).access_token)
    client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    r = graphql(client, VEHICULOS, {"propietarioId": usuario_normal.id})
    assert "errors" not in r
    # Otro usuario no debe ver el pendiente de usuario_normal
    placas = [v["placa"] for v in r["data"]["vehiculos"]["items"]]
    assert vehiculo_pendiente.placa not in placas


# ── Tests de documentos (semáforo + Cloudinary) ─────────────────────────────

@pytest.mark.django_db
def test_agregar_documento_exitoso(db, gql_admin, vehiculo_activo):
    """El propietario/admin puede agregar un documento con los nuevos campos."""
    from datetime import date, timedelta
    fecha_futura = (date.today() + timedelta(days=60)).isoformat()
    r = graphql(gql_admin, AGREGAR_DOCUMENTO, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoDoc": "soat",
            "numero": "TEST-001",
            "fechaVencimiento": fecha_futura,
        }
    })
    assert "errors" not in r, r.get("errors")
    doc = r["data"]["agregarDocumento"]
    assert doc["tipoDoc"] == "soat"
    assert doc["numero"] == "TEST-001"
    assert doc["estado"] == "valido"          # 60 días → válido
    assert doc["diasParaVencer"] == 60
    assert doc["archivoUrl"] is None          # sin archivo → None


@pytest.mark.django_db
def test_documento_estado_por_vencer(db, gql_admin, vehiculo_activo):
    """Documento con ≤30 días → estado 'por_vencer'."""
    from datetime import date, timedelta
    fecha_proxima = (date.today() + timedelta(days=10)).isoformat()
    r = graphql(gql_admin, AGREGAR_DOCUMENTO, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoDoc": "tecnica",
            "numero": "TEC-001",
            "fechaVencimiento": fecha_proxima,
        }
    })
    assert "errors" not in r
    doc = r["data"]["agregarDocumento"]
    assert doc["estado"] == "por_vencer"   # 10 días ≤ 30 → por_vencer
    assert 0 < doc["diasParaVencer"] <= 10


@pytest.mark.django_db
def test_documento_vencido_estado(db, gql_admin, vehiculo_activo):
    """Documento con fecha pasada → estado 'vencido' y diasParaVencer negativo."""
    r = graphql(gql_admin, AGREGAR_DOCUMENTO, {
        "input": {
            "vehiculoId": vehiculo_activo.id,
            "tipoDoc": "soat",
            "numero": "VENC-001",
            "fechaVencimiento": "2020-01-01",
        }
    })
    assert "errors" not in r
    doc = r["data"]["agregarDocumento"]
    assert doc["estado"] == "vencido"
    assert doc["diasParaVencer"] < 0


@pytest.mark.django_db
def test_estado_documentacion_vehiculo_critico(db, gql_admin, vehiculo_activo):
    """Vehículo con SOAT vencido → estadoDocumentacion='critico'."""
    DocumentoVehiculo.objects.create(
        vehiculo=vehiculo_activo,
        tipo_doc="soat",
        numero="VENC-SOAT",
        fecha_vencimiento=__import__('datetime').date(2020, 1, 1),
    )
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    from apps.usuarios.models import Usuario
    admin = Usuario.objects.filter(is_superuser=True).first()
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(admin).access_token)}"
    r = graphql(c, VEHICULOS_CON_DOCS, {"propietarioId": vehiculo_activo.propietario_id})
    assert "errors" not in r
    items = r["data"]["vehiculos"]["items"]
    v = next(i for i in items if i["id"] == vehiculo_activo.id)
    assert v["estadoDocumentacion"] == "critico"


# ── Rendimiento: el listado no debe degradar con N+1 ─────────────────────────

VEHICULOS_LISTADO_COMPLETO = """
query VehiculosListado($propietarioId: Int) {
  vehiculos(propietarioId: $propietarioId, porPagina: 20) {
    items {
      id placa estado estadoDocumentacion propietarioNombre propietarioRoles
      tipo { nombre }
      documentos { id tipoDoc numero fechaVencimiento estado }
    }
  }
}
"""


@pytest.mark.django_db
def test_listado_vehiculos_no_escala_con_n_mas_1(django_assert_max_num_queries, gql_admin, usuario_normal, tipo_vehiculo):
    """
    El listado de vehículos resuelve `documentos`, `estadoDocumentacion` y
    `propietarioRoles` para cada item — campos que antes disparaban consultas
    nuevas por vehículo (N+1: una para `documentos`, otra duplicada para
    `estadoDocumentacion`, y otra para `propietarioRoles`).

    Con `prefetch_related("documentos", "propietario__usuario_roles__rol")`
    el número total de consultas debe permanecer acotado sin importar cuántos
    vehículos tenga el propietario — NO debe crecer linealmente con N.
    """
    import datetime as dt

    def crear_vehiculos(cantidad, prefijo):
        for i in range(cantidad):
            v = Vehiculo.objects.create(
                placa=f"{prefijo}-{i:03d}", tipo=tipo_vehiculo, propietario=usuario_normal,
                marca="Toyota", modelo="Corolla", anio=2020, color="blanco", estado="activo",
            )
            DocumentoVehiculo.objects.create(
                vehiculo=v, tipo_doc="soat", numero=f"SOAT-{prefijo}-{i}",
                fecha_vencimiento=dt.date.today() + dt.timedelta(days=200),
            )

    # Caso A: 1 vehículo — mide el costo "base" del listado
    crear_vehiculos(1, "UNO")
    with django_assert_max_num_queries(15) as base:
        r1 = graphql(gql_admin, VEHICULOS_LISTADO_COMPLETO, {"propietarioId": usuario_normal.id})
    assert "errors" not in r1
    assert len(r1["data"]["vehiculos"]["items"]) == 1
    consultas_un_vehiculo = len(base.captured_queries)

    # Caso B: 4 vehículos más (5 en total) del MISMO propietario — si hubiera
    # N+1, esto dispararía ~3 consultas adicionales POR vehículo nuevo.
    crear_vehiculos(4, "CIN")
    with django_assert_max_num_queries(15) as cinco:
        r2 = graphql(gql_admin, VEHICULOS_LISTADO_COMPLETO, {"propietarioId": usuario_normal.id})
    assert "errors" not in r2
    assert len(r2["data"]["vehiculos"]["items"]) == 5
    consultas_cinco_vehiculos = len(cinco.captured_queries)

    # El número de consultas no debe crecer con la cantidad de vehículos
    # (a lo sumo una pequeña variación constante, nunca proporcional a N).
    assert consultas_cinco_vehiculos <= consultas_un_vehiculo + 2, (
        f"El listado parece tener un problema N+1: {consultas_un_vehiculo} consultas "
        f"con 1 vehículo vs {consultas_cinco_vehiculos} con 5 — debería mantenerse "
        f"prácticamente constante gracias a prefetch_related."
    )
