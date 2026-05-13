"""
Tests de autorización y validaciones del módulo Multas — Regla 1 + Regla 5.

Verifica:
  - Solo propietario puede apelar/pagar sus propias multas
  - Solo personal autorizado puede registrar multas
  - Multas de vehículos ajenos no son visibles a terceros
  - Validaciones: monto > 0, descripción no vacía, motivo no vacío
  - Atomicidad: multa + sanción del vehículo van juntos
"""
import pytest
from apps.multas.models import Multa
from apps.vehiculos.models import Vehiculo
from conftest import graphql

REGISTRAR = """
mutation Registrar($input: RegistrarMultaInput!) {
  registrarMulta(input: $input) {
    id monto estado placaVehiculo
  }
}
"""

PAGAR = """
mutation Pagar($input: PagarMultaInput!) {
  pagarMulta(input: $input) {
    id metodoPago montoPagado
  }
}
"""

APELAR = """
mutation Apelar($input: ApelarMultaInput!) {
  apelarMulta(input: $input) {
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

MULTAS_VEHICULO = """
query MultasVehiculo($vehiculoId: Int!) {
  multasVehiculo(vehiculoId: $vehiculoId) { id monto estado }
}
"""


@pytest.fixture
def multa_pendiente(db, vehiculo_activo, tipo_multa, admin):
    """Crea una multa pendiente para el vehiculo_activo."""
    multa = Multa.objects.create(
        vehiculo=vehiculo_activo, tipo=tipo_multa,
        monto=tipo_multa.monto_base, descripcion="Infracción test",
        registrado_por=admin,
    )
    vehiculo_activo.estado = "sancionado"
    vehiculo_activo.save()
    return multa


# ── Registrar multa ────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_registrar_multa_requiere_autenticacion(gql_client, vehiculo_activo, tipo_multa):
    r = graphql(gql_client, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_multa.id,
                  "descripcion": "Test"}
    })
    assert "errors" in r
    assert "requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_propietario_no_puede_registrar_multa(gql_guardia, vehiculo_activo, tipo_multa):
    """Solo guardia/admin puede registrar multas — propietario no."""
    # Nota: gql_guardia es un guardia, pero el test original usa usuario_normal
    # Usamos un cliente diferente: el propietario del vehículo no es guardia
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    from apps.usuarios.models import Usuario
    propietario = vehiculo_activo.propietario
    token = str(RefreshToken.for_user(propietario).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    r = graphql(c, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_multa.id,
                  "descripcion": "Intento ilegal"}
    })
    assert "errors" in r
    assert "guardia" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_registrar_multa_monto_negativo_falla(gql_admin, vehiculo_activo, tipo_multa):
    r = graphql(gql_admin, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_multa.id,
                  "descripcion": "Test", "montoOverride": "-50.00"}
    })
    assert "errors" in r
    assert "cero" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_registrar_multa_descripcion_vacia_falla(gql_admin, vehiculo_activo, tipo_multa):
    r = graphql(gql_admin, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_multa.id, "descripcion": "   "}
    })
    assert "errors" in r
    assert "obligatoria" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_registrar_multa_sanciona_vehiculo(db, gql_admin, vehiculo_activo, tipo_multa):
    """Registrar multa debe cambiar el vehículo a 'sancionado' atómicamente."""
    r = graphql(gql_admin, REGISTRAR, {
        "input": {"vehiculoId": vehiculo_activo.id, "tipoId": tipo_multa.id,
                  "descripcion": "Infracción en zona prohibida"}
    })
    assert "errors" not in r
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "sancionado"


# ── Pagar multa ────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_pagar_multa_solo_propietario(db, multa_pendiente):
    """Un usuario tercero (ni propietario ni admin) no puede pagar multas ajenas."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    from apps.usuarios.models import Usuario
    tercero = Usuario.objects.create_user(
        ci="TERCERO001", email="tercero_pago@test.com",
        nombre="Tercero", apellido="Pago", password="Test1234!",
    )
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(tercero).access_token)}"
    r = graphql(c, PAGAR, {"input": {"multaId": multa_pendiente.id, "metodoPago": "efectivo"}})
    assert "errors" in r
    assert "propietario" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_admin_puede_pagar_cualquier_multa(db, gql_admin, multa_pendiente, vehiculo_activo):
    """El admin puede pagar multas sin ser propietario."""
    r = graphql(gql_admin, PAGAR, {
        "input": {"multaId": multa_pendiente.id, "metodoPago": "efectivo"}
    })
    assert "errors" not in r


@pytest.mark.django_db
def test_pagar_multa_metodo_invalido_falla(db, gql_admin, multa_pendiente):
    r = graphql(gql_admin, PAGAR, {
        "input": {"multaId": multa_pendiente.id, "metodoPago": "cripto"}
    })
    assert "errors" in r
    assert "nválido" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_pagar_ultima_multa_rehabilita_vehiculo(db, gql_admin, multa_pendiente, vehiculo_activo):
    """Pagar la única multa pendiente debe dejar el vehículo activo."""
    graphql(gql_admin, PAGAR, {
        "input": {"multaId": multa_pendiente.id, "metodoPago": "transferencia"}
    })
    vehiculo_activo.refresh_from_db()
    assert vehiculo_activo.estado == "activo"


# ── Apelar multa ───────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_solo_propietario_puede_apelar(db, gql_guardia, multa_pendiente):
    """El guardia no puede apelar la multa de otro usuario."""
    r = graphql(gql_guardia, APELAR, {
        "input": {"multaId": multa_pendiente.id, "motivo": "Apelación ilegítima"}
    })
    assert "errors" in r
    assert "propietario" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_apelar_motivo_vacio_falla(db, vehiculo_activo, multa_pendiente):
    """El motivo de apelación es obligatorio."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    token = str(RefreshToken.for_user(vehiculo_activo.propietario).access_token)
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    r = graphql(c, APELAR, {"input": {"multaId": multa_pendiente.id, "motivo": "  "}})
    assert "errors" in r
    assert "obligatorio" in r["errors"][0]["message"].lower()


# ── Queries de multas ──────────────────────────────────────────────────────

@pytest.mark.django_db
def test_usuario_no_puede_ver_multas_ajenas(db, gql_guardia, multa_pendiente):
    """El guardia autenticado no puede ver multas de un vehículo ajeno (sin ser propietario)."""
    from django.test import Client
    from rest_framework_simplejwt.tokens import RefreshToken
    from apps.usuarios.models import Usuario
    otro = Usuario.objects.create_user(
        ci="OTRO001", email="otro@test.com",
        nombre="Otro", apellido="Usuario", password="Pass123!"
    )
    c = Client()
    c.defaults["HTTP_AUTHORIZATION"] = f"Bearer {str(RefreshToken.for_user(otro).access_token)}"
    r = graphql(c, MULTAS_VEHICULO, {"vehiculoId": multa_pendiente.vehiculo.id})
    assert "errors" in r
    assert "propio" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_admin_puede_ver_multas_de_cualquier_vehiculo(db, gql_admin, multa_pendiente):
    r = graphql(gql_admin, MULTAS_VEHICULO, {"vehiculoId": multa_pendiente.vehiculo.id})
    assert "errors" not in r
    assert len(r["data"]["multasVehiculo"]) >= 1


# ── Resolver apelación ─────────────────────────────────────────────────────

@pytest.mark.django_db
def test_resolver_apelacion_expone_resuelto_por(db, gql_admin, multa_pendiente, vehiculo_activo):
    """resolver_apelacion debe retornar resueltoPorNombre del admin."""
    from apps.multas.models import ApelacionMulta
    # Crear apelación
    apelacion = ApelacionMulta.objects.create(
        multa=multa_pendiente,
        usuario=vehiculo_activo.propietario,
        motivo="Test apelación resolución"
    )
    multa_pendiente.estado = "apelada"
    multa_pendiente.save()

    r = graphql(gql_admin, RESOLVER, {
        "input": {"apelacionId": apelacion.id, "aprobada": True, "respuesta": "Aprobado por admin"}
    })
    assert "errors" not in r
    assert r["data"]["resolverApelacion"]["resueltoPorNombre"] is not None
    assert r["data"]["resolverApelacion"]["estado"] == "aprobada"
