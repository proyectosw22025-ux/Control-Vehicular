"""Tests de control de acceso: estados de vehículo, QR, manual y audit log."""
import pytest
from apps.acceso.models import RegistroAcceso, AuditLog
from apps.vehiculos.models import Vehiculo
from conftest import graphql

REGISTRAR_ACCESO = """
mutation RegistrarAcceso($puntoId: Int!, $codigo: String!, $tipo: String!) {
  registrarAcceso(input: { puntoAccesoId: $puntoId, codigo: $codigo, tipo: $tipo }) {
    id tipo metodoAcceso placaVehiculo
  }
}
"""

REGISTRAR_MANUAL = """
mutation RegistrarManual($puntoId: Int!, $placa: String!, $tipo: String!) {
  registrarAccesoManual(input: { puntoAccesoId: $puntoId, placa: $placa, tipo: $tipo }) {
    id tipo metodoAcceso placaVehiculo
  }
}
"""


@pytest.mark.django_db
def test_acceso_qr_permanente_exitoso(gql_guardia, vehiculo_activo, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" not in r
    data = r["data"]["registrarAcceso"]
    assert data["tipo"] == "entrada"
    assert data["metodoAcceso"] == "qr_permanente"
    assert data["placaVehiculo"] == vehiculo_activo.placa


@pytest.mark.django_db
def test_vehiculo_sancionado_no_puede_entrar(gql_guardia, vehiculo_sancionado, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_sancionado.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "sancionado" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_vehiculo_pendiente_no_puede_entrar(gql_guardia, vehiculo_pendiente, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_pendiente.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "pendiente" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_codigo_desconocido_lanza_error(gql_guardia, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": "CODIGO_QUE_NO_EXISTE",
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "no reconocido" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_tipo_invalido_lanza_error(gql_guardia, vehiculo_activo, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "lateral",  # inválido
    })
    assert "errors" in r
    assert "Tipo inválido" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_acceso_genera_registro_en_bd(gql_guardia, vehiculo_activo, punto_acceso):
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert RegistroAcceso.objects.filter(
        vehiculo=vehiculo_activo, tipo="entrada"
    ).exists()


@pytest.mark.django_db
def test_acceso_genera_audit_log(gql_guardia, vehiculo_activo, punto_acceso):
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert AuditLog.objects.filter(accion="registrar_acceso").exists()


@pytest.mark.django_db
def test_acceso_manual_exitoso(gql_guardia, vehiculo_activo, punto_acceso):
    # Primero registrar entrada para que la salida sea válida
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "entrada",
    })
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "salida",
    })
    assert "errors" not in r
    assert r["data"]["registrarAccesoManual"]["metodoAcceso"] == "manual"


@pytest.mark.django_db
def test_acceso_manual_placa_inexistente(gql_guardia, punto_acceso):
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": "ZZZ-999",
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "no registrado" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_acceso_manual_tolera_guion_distinto_al_registrado(gql_guardia, usuario_normal, tipo_vehiculo, punto_acceso):
    """El OCR siempre normaliza la placa leída al formato canónico boliviano con
    guion (p.ej. 'ZYX-123'), pero el vehículo pudo registrarse sin guion (p.ej.
    'ZYX123', como ocurre con datos ya existentes en la BD). El lookup debe
    encontrar el vehículo igual, comparando solo letras y números."""
    Vehiculo.objects.create(
        placa="ZYX123",
        tipo=tipo_vehiculo,
        propietario=usuario_normal,
        marca="Toyota",
        modelo="Corolla",
        anio=2021,
        color="blanco",
        estado="activo",
    )
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": "ZYX-123",
        "tipo": "entrada",
    })
    assert "errors" not in r
    assert r["data"]["registrarAccesoManual"]["placaVehiculo"] == "ZYX123"


@pytest.mark.django_db
def test_acceso_manual_genera_audit_log(gql_guardia, vehiculo_activo, punto_acceso):
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "entrada",
    })
    assert AuditLog.objects.filter(accion="acceso_manual").exists()


# ── Identidad y propiedad en el acceso manual ──────────────────────────────
# El registro de accesos es evidencia: nadie escribe en él sin identificarse,
# y un usuario común solo declara movimientos de SUS propios vehículos.

@pytest.mark.django_db
def test_acceso_manual_requiere_autenticacion(gql_client, vehiculo_activo, punto_acceso):
    """Sin login no se puede registrar ningún acceso manual."""
    r = graphql(gql_client, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "autenticación requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_propietario_puede_registrar_acceso_de_su_vehiculo(gql_usuario_normal, vehiculo_activo, punto_acceso):
    """El dueño declara la entrada de su propio vehículo — caso legítimo (y base del demo)."""
    r = graphql(gql_usuario_normal, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "entrada",
    })
    assert "errors" not in r
    assert r["data"]["registrarAccesoManual"]["placaVehiculo"] == vehiculo_activo.placa


@pytest.mark.django_db
def test_propietario_no_puede_registrar_acceso_de_vehiculo_ajeno(gql_usuario_normal, guardia, tipo_vehiculo, punto_acceso):
    """Registrar la 'salida' del vehículo de otro contamina la evidencia — bloqueado."""
    from apps.vehiculos.models import Vehiculo
    ajeno = Vehiculo.objects.create(
        placa="AJN-777", tipo=tipo_vehiculo, propietario=guardia,
        marca="Suzuki", modelo="Swift", anio=2023, color="gris", estado="activo",
    )
    r = graphql(gql_usuario_normal, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": ajeno.placa,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "tus propios vehículos" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_acceso_manual_siempre_registra_responsable(gql_guardia, guardia, vehiculo_activo, punto_acceso):
    """Todo acceso manual queda firmado: registrado_por nunca es anónimo."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_activo.placa,
        "tipo": "entrada",
    })
    registro = RegistroAcceso.objects.filter(vehiculo=vehiculo_activo, metodo_acceso="manual").first()
    assert registro is not None
    assert registro.registrado_por_id == guardia.pk


@pytest.mark.django_db
def test_acceso_manual_bloquea_vehiculo_pendiente(gql_guardia, vehiculo_pendiente, punto_acceso):
    """Un guardia no puede dar acceso manual a un vehículo sin aprobar — security gap cerrado."""
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id,
        "placa": vehiculo_pendiente.placa,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "pendiente" in r["errors"][0]["message"].lower()


# ── Guard: entrada duplicada ───────────────────────────────

@pytest.mark.django_db
def test_entrada_duplicada_qr_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """Si un vehículo ya entró sin haber salido, no puede volver a entrar."""
    # Primera entrada — debe funcionar
    r1 = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" not in r1

    # Segunda entrada — debe bloquearse
    r2 = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r2
    assert "ya está dentro" in r2["errors"][0]["message"]


@pytest.mark.django_db
def test_entrada_permitida_despues_de_salida(gql_guardia, vehiculo_activo, punto_acceso):
    """Entrada → Salida → Entrada: flujo válido."""
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    assert "errors" not in r


@pytest.mark.django_db
def test_entrada_duplicada_manual_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """Entrada manual duplicada también debe ser bloqueada."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    assert "errors" in r
    assert "ya está dentro" in r["errors"][0]["message"]


# ── Nuevos tests: salida inválida ──────────────────────────────────────────

@pytest.mark.django_db
def test_salida_sin_entrada_previa_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """No se puede registrar salida si el vehículo nunca ingresó."""
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    assert "errors" in r
    assert "sin una entrada previa" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_salida_duplicada_manual_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """ENT → SAL → SAL: la segunda salida debe bloquearse."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    assert "errors" in r
    assert "ya está fuera" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_salida_qr_sin_entrada_bloqueada(gql_guardia, vehiculo_activo, punto_acceso):
    """Salida vía QR sin entrada previa también debe bloquearse."""
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "salida",
    })
    assert "errors" in r
    assert "sin una entrada previa" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_flujo_completo_entrada_salida_entrada(gql_guardia, vehiculo_activo, punto_acceso):
    """ENT → SAL → ENT → SAL: flujo completo correcto sin errores."""
    for tipo in ["entrada", "salida", "entrada", "salida"]:
        r = graphql(gql_guardia, REGISTRAR_MANUAL, {
            "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": tipo,
        })
        assert "errors" not in r, f"Falló en paso '{tipo}': {r.get('errors')}"
