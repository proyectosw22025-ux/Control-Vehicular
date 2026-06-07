"""
Tests de autorización y validaciones del módulo Infracciones — Regla 1 + Regla 5.

Verifica:
  - Solo propietario puede apelar/pagar sus propias infracciones y sanciones
  - Solo personal autorizado puede registrar infracciones
  - Infracciones de vehículos ajenos no son visibles a terceros
  - Validaciones: monto > 0, descripción no vacía, motivo no vacío
  - Atomicidad: infracción + sanción + estado del vehículo van juntos
"""
import pytest
from apps.multas.models import Infraccion, Sancion
from conftest import graphql

REGISTRAR = """
mutation Registrar($input: RegistrarInfraccionInput!) {
  registrarInfraccion(input: $input) {
    id estado placaVehiculo
    sancion { id tipoSancion monto estado }
  }
}
"""

PAGAR = """
mutation Pagar($input: PagarSancionInput!) {
  pagarSancion(input: $input) {
    id metodoPago montoPagado
  }
}
"""

APELAR = """
mutation Apelar($input: ApelarInfraccionInput!) {
  apelarInfraccion(input: $input) {
    id estado motivo
  }
}
"""

RESOLVER = """
mutation Resolver($input: ResolverApelacionInput!) {
  resolverApelacion(input: $input) {
    id estado resueltoPorNombre
  }
}
"""

INFRACCIONES_VEHICULO = """
query InfraccionesVehiculo($vehiculoId: Int!) {
  infraccionesVehiculo(vehiculoId: $vehiculoId) { id estado }
}
"""


@pytest.fixture
def infraccion_pendiente(db, vehiculo_activo, tipo_infraccion, admin):
    """Crea una infracción con sanción económica pendiente para el vehiculo_activo."""
    infraccion = Infraccion.objects.create(
        vehiculo=vehiculo_activo, tipo=tipo_infraccion,
        descripcion="Infracción test", registrado_por=admin,
    )
    Sancion.objects.create(
        infraccion=infraccion, tipo_sancion="multa_economica",
        monto=tipo_infraccion.monto_base, estado="pendiente",
    )
    vehiculo_activo.estado = "sancionado"
    vehiculo_activo.save()
    return infraccion


# ── Registrar infracción ───────────────────────────────────────────────────

@pytest.mark.django_db
def test_registrar_infraccion_requiere_autenticacion(gql_client, vehiculo_activo, tipo_infraccion):
    r = graphql(gql_client, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id,
                  "descripcion": "Test"}
    })
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_propietario_no_puede_registrar_infraccion(gql_guardia, vehiculo_activo, tipo_infraccion):
    """Solo guardia/admin puede registrar infracciones — propietario no."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    propietario = vehiculo_activo.propietario
    token = str(RefreshToken.for_user(propietario).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    r = graphql(c, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id,
                  "descripcion": "Intento ilegal"}
    })
    assert "errors" in r
    assert "guardia" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_registrar_infraccion_monto_negativo_falla(gql_admin, vehiculo_activo, tipo_infraccion):
    r = graphql(gql_admin, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id,
                  "descripcion": "Test", "montoOverride": "-50.00"}
    })
    assert "errors" in r
    assert "cero" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_registrar_infraccion_descripcion_vacia_falla(gql_admin, vehiculo_activo, tipo_infraccion):
    r = graphql(gql_admin, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id, "descripcion": "   "}
    })
    assert "errors" in r
    assert "obligatoria" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_registrar_infraccion_sanciona_vehiculo(db, gql_admin, vehiculo_activo, tipo_infraccion):
    """Registrar infracción con sanción económica debe cambiar el vehículo a 'sancionado' atómicamente."""
    r = graphql(gql_admin, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_infraccion.id,
                  "descripcion": "Infracción en zona prohibida"}
    })
    assert "errors" not in r
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "sancionado"


# ── Pagar sanción ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_pagar_sancion_solo_propietario(db, infraccion_pendiente):
    """Un usuario tercero (ni propietario ni admin) no puede pagar sanciones ajenas."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    from apps.usuarios.models import Usuario
    tercero = Usuario.objects.create_user(
        ci="TERCERO001", email="tercero_pago@test.com",
        nombre="Tercero", apellido="Pago", password="Test1234!",
    )
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(tercero).access_token)}"
    r = graphql(c, PAGAR, {"input": {"sancionId": infraccion_pendiente.sancion.id, "metodoPago": "efectivo"}})
    assert "errors" in r
    assert "propietario" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_admin_puede_pagar_cualquier_sancion(db, gql_admin, infraccion_pendiente, vehiculo_activo):
    """El admin puede pagar sanciones sin ser propietario."""
    r = graphql(gql_admin, PAGAR, {
        "input": {"sancionId": infraccion_pendiente.sancion.id, "metodoPago": "efectivo"}
    })
    assert "errors" not in r


@pytest.mark.django_db
def test_pagar_sancion_metodo_invalido_falla(db, gql_admin, infraccion_pendiente):
    r = graphql(gql_admin, PAGAR, {
        "input": {"sancionId": infraccion_pendiente.sancion.id, "metodoPago": "cripto"}
    })
    assert "errors" in r
    assert "nválido" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_pagar_ultima_sancion_rehabilita_vehiculo(db, gql_admin, infraccion_pendiente, vehiculo_activo):
    """Pagar la única sanción pendiente debe dejar el vehículo activo."""
    graphql(gql_admin, PAGAR, {
        "input": {"sancionId": infraccion_pendiente.sancion.id, "metodoPago": "transferencia"}
    })
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "activo"


# ── Apelar infracción ──────────────────────────────────────────────────────

@pytest.mark.django_db
def test_solo_propietario_puede_apelar(db, gql_guardia, infraccion_pendiente):
    """El guardia no puede apelar la infracción de otro usuario."""
    r = graphql(gql_guardia, APELAR, {
        "input": {"infraccionId": infraccion_pendiente.id, "motivo": "Apelación ilegítima"}
    })
    assert "errors" in r
    assert "propietario" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_apelar_motivo_vacio_falla(db, vehiculo_activo, infraccion_pendiente):
    """El motivo de apelación es obligatorio."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    token = str(RefreshToken.for_user(vehiculo_activo.propietario).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    r = graphql(c, APELAR, {"input": {"infraccionId": infraccion_pendiente.id, "motivo": "  "}})
    assert "errors" in r
    assert "obligatorio" in r["errors"][0]["message"].lower()


# ── Queries de infracciones ────────────────────────────────────────────────

@pytest.mark.django_db
def test_usuario_no_puede_ver_infracciones_ajenas(db, gql_guardia, infraccion_pendiente):
    """El guardia autenticado no puede ver infracciones de un vehículo ajeno (sin ser propietario)."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    from apps.usuarios.models import Usuario
    otro = Usuario.objects.create_user(
        ci="OTRO001", email="otro@test.com",
        nombre="Otro", apellido="Usuario", password="Pass123!"
    )
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(otro).access_token)}"
    r = graphql(c, INFRACCIONES_VEHICULO, {"vehiculoId": infraccion_pendiente.vehiculo.id})
    assert "errors" in r
    assert "propio" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_admin_puede_ver_infracciones_de_cualquier_vehiculo(db, gql_admin, infraccion_pendiente):
    r = graphql(gql_admin, INFRACCIONES_VEHICULO, {"vehiculoId": infraccion_pendiente.vehiculo.id})
    assert "errors" not in r
    assert len(r["data"]["infraccionesVehiculo"]) >= 1


# ── Resolver apelación ─────────────────────────────────────────────────────

@pytest.mark.django_db
def test_resolver_apelacion_expone_resuelto_por(db, gql_admin, infraccion_pendiente, vehiculo_activo):
    """resolver_apelacion debe retornar resueltoPorNombre del admin."""
    from apps.multas.models import ApelacionInfraccion
    apelacion = ApelacionInfraccion.objects.create(
        infraccion=infraccion_pendiente,
        usuario=vehiculo_activo.propietario,
        motivo="Test apelación resolución"
    )
    infraccion_pendiente.estado = "apelada"
    infraccion_pendiente.save()

    r = graphql(gql_admin, RESOLVER, {
        "input": {"apelacionId": apelacion.id, "aprobada": True, "respuesta": "Aprobado por admin"}
    })
    assert "errors" not in r
    assert r["data"]["resolverApelacion"]["resueltoPorNombre"] is not None
    assert r["data"]["resolverApelacion"]["estado"] == "aprobada"
