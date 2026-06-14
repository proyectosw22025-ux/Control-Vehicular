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


# ── Modo "Auto": el backend deduce entrada/salida ───────────────────────────

@pytest.mark.django_db
def test_acceso_auto_primer_registro_es_entrada(gql_guardia, vehiculo_activo, punto_acceso):
    """Sin historial previo, 'auto' resuelve a entrada."""
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "auto",
    })
    assert "errors" not in r
    assert r["data"]["registrarAccesoManual"]["tipo"] == "entrada"


@pytest.mark.django_db
def test_acceso_auto_alterna_entrada_salida(gql_guardia, vehiculo_activo, punto_acceso):
    """Auto alterna según el estado: entrada → salida → entrada."""
    def auto():
        return graphql(gql_guardia, REGISTRAR_MANUAL, {
            "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "auto",
        })["data"]["registrarAccesoManual"]["tipo"]
    assert auto() == "entrada"
    assert auto() == "salida"
    assert auto() == "entrada"


@pytest.mark.django_db
def test_acceso_auto_qr_alterna(gql_guardia, vehiculo_activo, punto_acceso):
    """Mismo comportamiento por QR dinámico/permanente."""
    def auto():
        return graphql(gql_guardia, REGISTRAR_ACCESO, {
            "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "auto",
        })["data"]["registrarAcceso"]["tipo"]
    assert auto() == "entrada"
    assert auto() == "salida"


# ── Espacio sugerido tras la entrada (asignación de un toque) ────────────────

REGISTRAR_MANUAL_ESPACIO = """
mutation RegistrarManual($puntoId: Int!, $placa: String!, $tipo: String!) {
  registrarAccesoManual(input: { puntoAccesoId: $puntoId, placa: $placa, tipo: $tipo }) {
    id tipo
    espacioSugerido { espacioId numero zonaNombre vehiculoId }
  }
}
"""


@pytest.mark.django_db
def test_entrada_sugiere_espacio_libre(gql_guardia, vehiculo_activo, punto_acceso, espacio_disponible):
    """Tras una entrada, la respuesta incluye un espacio libre compatible."""
    r = graphql(gql_guardia, REGISTRAR_MANUAL_ESPACIO, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    assert "errors" not in r
    sug = r["data"]["registrarAccesoManual"]["espacioSugerido"]
    assert sug is not None
    assert sug["numero"] == espacio_disponible.numero
    assert sug["vehiculoId"] == vehiculo_activo.id


@pytest.mark.django_db
def test_salida_no_sugiere_espacio(gql_guardia, vehiculo_activo, punto_acceso, espacio_disponible):
    """En salida no hay sugerencia de espacio."""
    graphql(gql_guardia, REGISTRAR_MANUAL_ESPACIO, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    r = graphql(gql_guardia, REGISTRAR_MANUAL_ESPACIO, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    assert r["data"]["registrarAccesoManual"]["espacioSugerido"] is None


# ── Identidad en el acceso por QR ───────────────────────────────────────────
# El QR es la credencial del vehículo; quien lo escanea debe ser personal
# identificado. Un QR fotografiado no debe servir para registrar accesos
# remotamente.

@pytest.mark.django_db
def test_acceso_qr_requiere_autenticacion(gql_client, vehiculo_activo, punto_acceso):
    r = graphql(gql_client, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "autenticación requerida" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_acceso_qr_solo_personal(gql_usuario_normal, vehiculo_activo, punto_acceso):
    """Un usuario común no puede operar el escáner del portón — ni con un QR válido."""
    r = graphql(gql_usuario_normal, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id,
        "codigo": vehiculo_activo.codigo_qr,
        "tipo": "entrada",
    })
    assert "errors" in r
    assert "guardias" in r["errors"][0]["message"].lower()


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


# ── Parte de control: vehículos aún en campus ────────────────────────────────

EN_CAMPUS = """
query { vehiculosEnCampus { placa espacioParqueo horaEntrada } }
"""


@pytest.mark.django_db
def test_vehiculos_en_campus_lista_los_que_entraron(gql_guardia, vehiculo_activo, punto_acceso):
    """Un vehículo con último acceso = entrada aparece en el parte."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    r = graphql(gql_guardia, EN_CAMPUS, {})
    assert "errors" not in r
    placas = [v["placa"] for v in r["data"]["vehiculosEnCampus"]]
    assert vehiculo_activo.placa in placas


@pytest.mark.django_db
def test_vehiculo_que_salio_no_aparece_en_campus(gql_guardia, vehiculo_activo, punto_acceso):
    """Tras entrada + salida, ya no figura como dentro."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "salida",
    })
    r = graphql(gql_guardia, EN_CAMPUS, {})
    placas = [v["placa"] for v in r["data"]["vehiculosEnCampus"]]
    assert vehiculo_activo.placa not in placas


@pytest.mark.django_db
def test_parte_en_campus_requiere_personal(gql_usuario_normal):
    r = graphql(gql_usuario_normal, EN_CAMPUS, {})
    assert "errors" in r


# ── Deprecación gradual del QR permanente (flag + métrica) ───────────────────

METRICA_QR = """
query { metricasQrPermanente(dias: 30) {
  totalAccesos accesosQrPermanente porcentaje habilitado
} }
"""


@pytest.mark.django_db
def test_metrica_qr_permanente_solo_admin(gql_guardia):
    r = graphql(gql_guardia, METRICA_QR, {})
    assert "errors" in r


@pytest.mark.django_db
def test_metrica_qr_permanente_cuenta_accesos(gql_admin, gql_guardia, vehiculo_activo, punto_acceso):
    """Tras un acceso por QR permanente, la métrica lo refleja."""
    graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    r = graphql(gql_admin, METRICA_QR, {})
    assert "errors" not in r
    m = r["data"]["metricasQrPermanente"]
    assert m["accesosQrPermanente"] >= 1
    assert m["habilitado"] is True


@pytest.mark.django_db
def test_qr_permanente_deshabilitado_no_resuelve(gql_guardia, vehiculo_activo, punto_acceso, settings):
    """Con el flag apagado, el QR permanente deja de funcionar."""
    settings.QR_PERMANENTE_HABILITADO = False
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    assert "errors" in r
    assert "no reconocido" in r["errors"][0]["message"]


# ── Lista negra / alerta de seguridad (vehículo robado/buscado) ──────────────

MARCAR_ALERTA = """
mutation Marcar($id: Int!, $on: Boolean!, $motivo: String) {
  marcarAlertaSeguridad(vehiculoId: $id, enAlerta: $on, motivo: $motivo) {
    id enAlerta motivoAlerta
  }
}
"""


@pytest.mark.django_db
def test_admin_marca_alerta_seguridad(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, MARCAR_ALERTA, {"id": vehiculo_activo.id, "on": True, "motivo": "Reportado robado"})
    assert "errors" not in r
    assert r["data"]["marcarAlertaSeguridad"]["enAlerta"] is True
    assert r["data"]["marcarAlertaSeguridad"]["motivoAlerta"] == "Reportado robado"


@pytest.mark.django_db
def test_marcar_alerta_requiere_motivo(gql_admin, vehiculo_activo):
    r = graphql(gql_admin, MARCAR_ALERTA, {"id": vehiculo_activo.id, "on": True, "motivo": ""})
    assert "errors" in r
    assert "motivo" in r["errors"][0]["message"].lower()


@pytest.mark.django_db
def test_alerta_solo_admin(gql_guardia, vehiculo_activo):
    r = graphql(gql_guardia, MARCAR_ALERTA, {"id": vehiculo_activo.id, "on": True, "motivo": "X"})
    assert "errors" in r


@pytest.mark.django_db
def test_vehiculo_en_alerta_es_denegado_en_porton(gql_guardia, vehiculo_activo, punto_acceso):
    """Un vehículo en alerta NO puede entrar — aunque esté 'activo'."""
    from apps.acceso.models import AlertaAcceso
    vehiculo_activo.en_alerta = True
    vehiculo_activo.motivo_alerta = "Reportado robado"
    vehiculo_activo.save(update_fields=["en_alerta", "motivo_alerta"])

    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    assert "errors" in r
    assert "ALERTA DE SEGURIDAD" in r["errors"][0]["message"]
    # Y se creó la alerta crítica como registro del intento
    assert AlertaAcceso.objects.filter(
        vehiculo=vehiculo_activo, tipo_anomalia="vehiculo_en_alerta", severidad="critica"
    ).exists()


@pytest.mark.django_db
def test_vehiculo_en_alerta_denegado_tambien_manual(gql_guardia, vehiculo_activo, punto_acceso):
    vehiculo_activo.en_alerta = True
    vehiculo_activo.motivo_alerta = "Acceso revocado"
    vehiculo_activo.save(update_fields=["en_alerta", "motivo_alerta"])
    r = graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    assert "errors" in r
    assert "ALERTA DE SEGURIDAD" in r["errors"][0]["message"]


@pytest.mark.django_db
def test_quitar_alerta_restaura_acceso(gql_admin, gql_guardia, vehiculo_activo, punto_acceso):
    """Al retirar la alerta, el vehículo vuelve a poder entrar."""
    vehiculo_activo.en_alerta = True
    vehiculo_activo.motivo_alerta = "Error de registro"
    vehiculo_activo.save(update_fields=["en_alerta", "motivo_alerta"])
    graphql(gql_admin, MARCAR_ALERTA, {"id": vehiculo_activo.id, "on": False, "motivo": ""})
    r = graphql(gql_guardia, REGISTRAR_ACCESO, {
        "puntoId": punto_acceso.id, "codigo": vehiculo_activo.codigo_qr, "tipo": "entrada",
    })
    assert "errors" not in r


# ── Aforo del campus ─────────────────────────────────────────────────────────

AFORO = "query { aforoCampus { dentro maximo porcentaje estado } }"


@pytest.mark.django_db
def test_aforo_sin_limite(gql_guardia, vehiculo_activo, punto_acceso):
    """Sin AFORO_MAXIMO_CAMPUS configurado: estado sin_limite, cuenta los dentro."""
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    r = graphql(gql_guardia, AFORO, {})
    assert "errors" not in r
    a = r["data"]["aforoCampus"]
    assert a["dentro"] == 1
    assert a["estado"] == "sin_limite"


@pytest.mark.django_db
def test_aforo_lleno(gql_guardia, vehiculo_activo, punto_acceso, settings):
    settings.AFORO_MAXIMO_CAMPUS = 1
    graphql(gql_guardia, REGISTRAR_MANUAL, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    r = graphql(gql_guardia, AFORO, {})
    a = r["data"]["aforoCampus"]
    assert a["dentro"] == 1 and a["maximo"] == 1
    assert a["estado"] == "lleno"


@pytest.mark.django_db
def test_aforo_requiere_personal(gql_usuario_normal):
    r = graphql(gql_usuario_normal, AFORO, {})
    assert "errors" in r


# ── Métrica de despacho (throughput) ─────────────────────────────────────────

DESPACHO = """
query { metricasDespacho(dias: 7) {
  puntoNombre totalAccesos segundosMediana accesosPorHora horaPico
} }
"""


@pytest.mark.django_db
def test_metrica_despacho_calcula_mediana(gql_guardia, vehiculo_activo, punto_acceso):
    """Con varios accesos espaciados, la mediana del intervalo se calcula."""
    from datetime import timedelta
    from django.utils import timezone
    base = timezone.now() - timedelta(hours=1)
    # 4 accesos a 10s de intervalo → mediana ~10s
    for i in range(4):
        r = RegistroAcceso.objects.create(
            punto_acceso=punto_acceso, vehiculo=vehiculo_activo,
            tipo="entrada" if i % 2 == 0 else "salida", metodo_acceso="manual",
        )
        RegistroAcceso.objects.filter(pk=r.pk).update(timestamp=base + timedelta(seconds=i * 10))
    r = graphql(gql_guardia, DESPACHO, {})
    assert "errors" not in r
    m = next(x for x in r["data"]["metricasDespacho"] if x["puntoNombre"] == punto_acceso.nombre)
    assert m["totalAccesos"] == 4
    assert m["segundosMediana"] == 10


@pytest.mark.django_db
def test_metrica_despacho_requiere_personal(gql_usuario_normal):
    r = graphql(gql_usuario_normal, DESPACHO, {})
    assert "errors" in r


# ── Carril express (vehículo frecuente) ──────────────────────────────────────

ACCESO_FRECUENTE = """
mutation RegistrarManual($puntoId: Int!, $placa: String!, $tipo: String!) {
  registrarAccesoManual(input: { puntoAccesoId: $puntoId, placa: $placa, tipo: $tipo }) {
    id esFrecuente
  }
}
"""


@pytest.mark.django_db
def test_vehiculo_frecuente_se_refleja_en_escaneo(gql_guardia, vehiculo_activo, punto_acceso):
    vehiculo_activo.es_frecuente = True
    vehiculo_activo.save(update_fields=["es_frecuente"])
    r = graphql(gql_guardia, ACCESO_FRECUENTE, {
        "puntoId": punto_acceso.id, "placa": vehiculo_activo.placa, "tipo": "entrada",
    })
    assert "errors" not in r
    assert r["data"]["registrarAccesoManual"]["esFrecuente"] is True
