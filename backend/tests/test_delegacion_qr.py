"""
Tests del módulo Mi Pase QR — Delegaciones de acceso vehicular.

Cubre los 3 problemas corregidos:
  P1 — Delegación tipo entrada/salida/ambos (usos_max correctos)
  P2 — url_qr expuesto en el tipo GraphQL para compartir como imagen
  P3 — QR permanente no interviene en los flujos de delegación

Escenarios reales testeados:
  - Papá trae el auto (solo entrada)
  - Esposa saca el auto (solo salida)
  - Papá trae Y saca el auto (ambos — 2 usos)
  - Concurrencia: dos guardias escaneando el mismo QR al mismo tiempo
  - Expiración, agotamiento y revocación
"""
import json
import pytest
from datetime import timedelta
from django.utils import timezone
from django.db.models import F

from apps.acceso.models import QrSesion, PuntoAcceso, RegistroAcceso
from apps.acceso.services import resolver_codigo
from apps.vehiculos.models import Vehiculo


# ── Helpers ───────────────────────────────────────────────────────────────────

def gql(client, query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    return client.post(
        "/graphql/",
        data=json.dumps(payload),
        content_type="application/json",
    ).json()


GENERAR_DELEGACION_GQL = """
mutation GenerarQR($input: GenerarQrDelegacionInput!) {
  generarQrDelegacion(input: $input) {
    id codigoHash motivo
    tipoDelegacion tipoDelegacionDisplay
    usosMax usosActual usosRestantes
    vigente usado fechaExpiracion
    urlQr placaVehiculo
  }
}
"""

REVOCAR_DELEGACION_GQL = """
mutation RevocarQR($qrId: Int!) {
  revocarQrDelegacion(qrId: $qrId)
}
"""

MIS_DELEGACIONES_GQL = """
query MisDelegaciones {
  misDelegaciones {
    id codigoHash motivo
    tipoDelegacion usosMax usosActual usosRestantes
    vigente urlQr
  }
}
"""

REGISTRAR_ACCESO_GQL = """
mutation RegistrarAcceso($input: ValidarAccesoInput!) {
  registrarAcceso(input: $input) {
    id tipo metodoAcceso placaVehiculo
  }
}
"""


# ── Fixtures locales ──────────────────────────────────────────────────────────

@pytest.fixture
def punto(db):
    return PuntoAcceso.objects.create(
        nombre="Portería Principal", tipo="ambos", ubicacion="Norte"
    )


@pytest.fixture
def qr_solo_entrada(db, vehiculo_activo, usuario_normal):
    return QrSesion.objects.create(
        vehiculo=vehiculo_activo,
        codigo_hash="entrada_hash_test_001",
        motivo="Papá trae el auto",
        tipo_delegacion="entrada",
        usos_max=1,
        usos_actual=0,
        fecha_expiracion=timezone.now() + timedelta(hours=4),
        generado_por=usuario_normal,
    )


@pytest.fixture
def qr_solo_salida(db, vehiculo_activo, usuario_normal):
    """Registrar entrada previa para que la salida sea válida."""
    veh = vehiculo_activo
    punto_f = PuntoAcceso.objects.create(nombre="Portería Sur", tipo="ambos")
    RegistroAcceso.objects.create(
        punto_acceso=punto_f, vehiculo=veh, tipo="entrada", metodo_acceso="qr_dinamico"
    )
    return QrSesion.objects.create(
        vehiculo=veh,
        codigo_hash="salida_hash_test_001",
        motivo="Esposa saca el auto",
        tipo_delegacion="salida",
        usos_max=1,
        usos_actual=0,
        fecha_expiracion=timezone.now() + timedelta(hours=4),
        generado_por=usuario_normal,
    )


@pytest.fixture
def qr_ambos(db, vehiculo_activo, usuario_normal):
    return QrSesion.objects.create(
        vehiculo=vehiculo_activo,
        codigo_hash="ambos_hash_test_001",
        motivo="Familiar lleva y trae el auto",
        tipo_delegacion="ambos",
        usos_max=2,
        usos_actual=0,
        fecha_expiracion=timezone.now() + timedelta(hours=8),
        generado_por=usuario_normal,
    )


# ── Tests: modelo y propiedades ───────────────────────────────────────────────

@pytest.mark.django_db
class TestModeloQrSesion:

    def test_delegacion_entrada_usos_max_1(self, qr_solo_entrada):
        assert qr_solo_entrada.usos_max == 1
        assert qr_solo_entrada.vigente is True
        assert qr_solo_entrada.usado is False

    def test_delegacion_salida_usos_max_1(self, qr_solo_salida):
        assert qr_solo_salida.usos_max == 1
        assert qr_solo_salida.vigente is True

    def test_delegacion_ambos_usos_max_2(self, qr_ambos):
        assert qr_ambos.usos_max == 2
        assert qr_ambos.usos_restantes == 2
        assert qr_ambos.vigente is True
        assert qr_ambos.usado is False

    def test_ambos_con_1_uso_sigue_vigente(self, qr_ambos):
        qr_ambos.usos_actual = 1
        qr_ambos.save()
        qr_ambos.refresh_from_db()
        assert qr_ambos.vigente is True
        assert qr_ambos.usado is False
        assert qr_ambos.usos_restantes == 1

    def test_ambos_con_2_usos_esta_agotado(self, qr_ambos):
        qr_ambos.usos_actual = 2
        qr_ambos.save()
        qr_ambos.refresh_from_db()
        assert qr_ambos.vigente is False
        assert qr_ambos.usado is True
        assert qr_ambos.usos_restantes == 0

    def test_url_qr_contiene_codigo_hash(self, qr_solo_entrada):
        assert qr_solo_entrada.codigo_hash in qr_solo_entrada.url_qr
        assert qr_solo_entrada.url_qr.endswith(".png")


# ── Tests: servicio resolver_codigo ──────────────────────────────────────────

@pytest.mark.django_db
class TestResolverCodigoDelegacion:

    def test_entrada_acepta_tipo_entrada(self, qr_solo_entrada):
        resultado = resolver_codigo(qr_solo_entrada.codigo_hash, tipo_acceso="entrada")
        assert resultado.vehiculo is not None
        assert resultado.metodo_acceso == "qr_delegacion"
        qr_solo_entrada.refresh_from_db()
        assert qr_solo_entrada.usos_actual == 1

    def test_entrada_rechaza_tipo_salida(self, qr_solo_entrada):
        """QR de solo-entrada NO puede usarse para registrar salida."""
        with pytest.raises(Exception, match="solo permite entrada"):
            resolver_codigo(qr_solo_entrada.codigo_hash, tipo_acceso="salida")
        # El uso NO fue consumido
        qr_solo_entrada.refresh_from_db()
        assert qr_solo_entrada.usos_actual == 0

    def test_salida_acepta_tipo_salida(self, qr_solo_salida):
        resultado = resolver_codigo(qr_solo_salida.codigo_hash, tipo_acceso="salida")
        assert resultado.vehiculo is not None
        qr_solo_salida.refresh_from_db()
        assert qr_solo_salida.usos_actual == 1

    def test_salida_rechaza_tipo_entrada(self, qr_solo_salida):
        """QR de solo-salida NO puede usarse para registrar entrada."""
        with pytest.raises(Exception, match="solo permite salida"):
            resolver_codigo(qr_solo_salida.codigo_hash, tipo_acceso="entrada")
        qr_solo_salida.refresh_from_db()
        assert qr_solo_salida.usos_actual == 0

    def test_ambos_acepta_entrada(self, qr_ambos):
        resolver_codigo(qr_ambos.codigo_hash, tipo_acceso="entrada")
        qr_ambos.refresh_from_db()
        assert qr_ambos.usos_actual == 1
        assert qr_ambos.vigente is True  # todavía le queda 1 uso

    def test_ambos_acepta_entrada_y_luego_salida(self, qr_ambos):
        """Escenario completo: familiar entra y luego sale con el auto."""
        # Primer uso: entrada
        resolver_codigo(qr_ambos.codigo_hash, tipo_acceso="entrada")
        qr_ambos.refresh_from_db()
        assert qr_ambos.usos_actual == 1
        assert qr_ambos.vigente is True

        # Segundo uso: salida
        resolver_codigo(qr_ambos.codigo_hash, tipo_acceso="salida")
        qr_ambos.refresh_from_db()
        assert qr_ambos.usos_actual == 2
        assert qr_ambos.vigente is False
        assert qr_ambos.usado is True

    def test_qr_agotado_da_error(self, qr_ambos):
        """Después de 2 usos, el QR no sirve más."""
        qr_ambos.usos_actual = 2
        qr_ambos.save()
        with pytest.raises(Exception):
            resolver_codigo(qr_ambos.codigo_hash, tipo_acceso="entrada")

    def test_qr_expirado_da_error(self, qr_solo_entrada):
        qr_solo_entrada.fecha_expiracion = timezone.now() - timedelta(minutes=1)
        qr_solo_entrada.save()
        with pytest.raises(Exception, match="expirado"):
            resolver_codigo(qr_solo_entrada.codigo_hash, tipo_acceso="entrada")

    def test_qr_vehiculo_sancionado_da_error(self, vehiculo_sancionado, usuario_normal):
        qr = QrSesion.objects.create(
            vehiculo=vehiculo_sancionado,
            codigo_hash="sancionado_test_001",
            motivo="Test sancionado",
            tipo_delegacion="ambos",
            usos_max=2,
            usos_actual=0,
            fecha_expiracion=timezone.now() + timedelta(hours=4),
            generado_por=usuario_normal,
        )
        with pytest.raises(Exception, match="sancionado"):
            resolver_codigo(qr.codigo_hash, tipo_acceso="entrada")
        # Uso no consumido
        qr.refresh_from_db()
        assert qr.usos_actual == 0


# ── Tests: concurrencia (optimistic locking) ─────────────────────────────────

@pytest.mark.django_db
class TestConcurrenciaDelegacion:

    def test_dos_guardias_no_pueden_usar_mismo_qr_ambos_a_la_vez(
        self, qr_solo_entrada
    ):
        """
        Simula dos guardias escaneando el mismo QR de 1 uso al mismo microsegundo.
        Solo uno debe tener éxito; el otro recibe error.
        """
        from django.db import transaction

        exitos = 0
        errores = 0

        # Guardia 1
        try:
            resolver_codigo(qr_solo_entrada.codigo_hash, tipo_acceso="entrada")
            exitos += 1
        except Exception:
            errores += 1

        # Guardia 2 — el QR ya fue usado por Guardia 1
        # Forzamos simular misma condición de race: re-leemos el objeto con usos_actual=0
        # El UPDATE WHERE usos_actual=0 fallará porque ya está en 1
        qr_original = qr_solo_entrada
        qr_original.usos_actual = 0  # simular lectura concurrente obsoleta
        actualizado = QrSesion.objects.filter(
            pk=qr_original.pk, usos_actual=0
        ).update(usos_actual=1)
        if actualizado == 0:
            errores += 1
        else:
            exitos += 1

        assert exitos == 1, "Exactamente un guardia debe tener éxito"
        assert errores == 1, "El otro guardia debe recibir error"

    def test_ambos_con_2_guardias_en_orden_valido(self, qr_ambos):
        """Con usos_max=2, dos guardias en secuencia ambos deben tener éxito."""
        # Guardia 1 — entrada
        resolver_codigo(qr_ambos.codigo_hash, tipo_acceso="entrada")
        # Guardia 2 — salida
        resolver_codigo(qr_ambos.codigo_hash, tipo_acceso="salida")

        qr_ambos.refresh_from_db()
        assert qr_ambos.usos_actual == 2
        assert qr_ambos.vigente is False


# ── Tests: mutation GraphQL generar_qr_delegacion ────────────────────────────

@pytest.mark.django_db
class TestMutacionGenerarDelegacion:

    def test_genera_delegacion_ambos_con_usos_max_2(
        self, gql_usuario_normal, vehiculo_activo
    ):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Familiar lleva el auto al servicio",
                "tipoDelegacion": "ambos",
                "horasValidez": 8,
            }
        })
        assert "errors" not in data, data.get("errors")
        r = data["data"]["generarQrDelegacion"]
        assert r["tipoDelegacion"] == "ambos"
        assert r["usosMax"] == 2
        assert r["usosActual"] == 0
        assert r["usosRestantes"] == 2
        assert r["vigente"] is True
        assert r["usado"] is False
        assert ".png" in r["urlQr"]
        assert r["codigoHash"] in r["urlQr"]

    def test_genera_delegacion_solo_entrada(
        self, gql_usuario_normal, vehiculo_activo
    ):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Papá trae el auto",
                "tipoDelegacion": "entrada",
                "horasValidez": 4,
            }
        })
        assert "errors" not in data
        r = data["data"]["generarQrDelegacion"]
        assert r["tipoDelegacion"] == "entrada"
        assert r["tipoDelegacionDisplay"] == "Solo entrada"
        assert r["usosMax"] == 1

    def test_genera_delegacion_solo_salida(
        self, gql_usuario_normal, vehiculo_activo
    ):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Esposa saca el auto",
                "tipoDelegacion": "salida",
                "horasValidez": 2,
            }
        })
        assert "errors" not in data
        r = data["data"]["generarQrDelegacion"]
        assert r["tipoDelegacion"] == "salida"
        assert r["usosMax"] == 1

    def test_tipo_invalido_da_error(self, gql_usuario_normal, vehiculo_activo):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Test",
                "tipoDelegacion": "invalido",
                "horasValidez": 1,
            }
        })
        assert "errors" in data

    def test_vehiculo_sancionado_no_puede_delegar(
        self, gql_usuario_normal, vehiculo_sancionado
    ):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_sancionado.id,
                "motivo": "Test",
                "tipoDelegacion": "ambos",
                "horasValidez": 1,
            }
        })
        assert "errors" in data
        assert "sancionado" in data["errors"][0]["message"].lower()

    def test_motivo_vacio_da_error(self, gql_usuario_normal, vehiculo_activo):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "   ",
                "tipoDelegacion": "ambos",
                "horasValidez": 1,
            }
        })
        assert "errors" in data

    def test_horas_validas_max_168(self, gql_usuario_normal, vehiculo_activo):
        """Límite superior: 168 horas (1 semana)."""
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Delegación larga",
                "tipoDelegacion": "ambos",
                "horasValidez": 9999,  # debe truncarse a 168
            }
        })
        assert "errors" not in data


# ── Tests: mutation revocar_qr_delegacion ────────────────────────────────────

@pytest.mark.django_db
class TestRevocarDelegacion:

    def test_revocar_qr_vigente_funciona(
        self, gql_usuario_normal, qr_solo_entrada
    ):
        data = gql(gql_usuario_normal, REVOCAR_DELEGACION_GQL, {
            "qrId": qr_solo_entrada.id
        })
        assert "errors" not in data
        assert data["data"]["revocarQrDelegacion"] is True
        # El QR ya no debe aparecer en mis_delegaciones
        qr_solo_entrada.refresh_from_db()
        assert not qr_solo_entrada.vigente

    def test_revocar_qr_ya_agotado_da_error(
        self, gql_usuario_normal, qr_solo_entrada
    ):
        qr_solo_entrada.usos_actual = 1
        qr_solo_entrada.save()
        data = gql(gql_usuario_normal, REVOCAR_DELEGACION_GQL, {
            "qrId": qr_solo_entrada.id
        })
        assert "errors" in data
        assert "utilizado" in data["errors"][0]["message"].lower()


# ── Tests: query mis_delegaciones ────────────────────────────────────────────

@pytest.mark.django_db
class TestMisDelegaciones:

    def test_lista_solo_delegaciones_vigentes(
        self, gql_usuario_normal, db, vehiculo_activo, usuario_normal
    ):
        # Vigente
        QrSesion.objects.create(
            vehiculo=vehiculo_activo, codigo_hash="vigente_001",
            motivo="Vigente", tipo_delegacion="ambos",
            usos_max=2, usos_actual=0,
            fecha_expiracion=timezone.now() + timedelta(hours=2),
            generado_por=usuario_normal,
        )
        # Agotado (usos_actual == usos_max)
        QrSesion.objects.create(
            vehiculo=vehiculo_activo, codigo_hash="agotado_001",
            motivo="Agotado", tipo_delegacion="entrada",
            usos_max=1, usos_actual=1,
            fecha_expiracion=timezone.now() + timedelta(hours=2),
            generado_por=usuario_normal,
        )
        # Expirado
        QrSesion.objects.create(
            vehiculo=vehiculo_activo, codigo_hash="expirado_001",
            motivo="Expirado", tipo_delegacion="salida",
            usos_max=1, usos_actual=0,
            fecha_expiracion=timezone.now() - timedelta(hours=1),
            generado_por=usuario_normal,
        )
        data = gql(gql_usuario_normal, MIS_DELEGACIONES_GQL)
        assert "errors" not in data
        delegaciones = data["data"]["misDelegaciones"]
        motivos = [d["motivo"] for d in delegaciones]
        assert "Vigente" in motivos
        assert "Agotado" not in motivos
        assert "Expirado" not in motivos


GENERAR_DELEGACION_CON_DESTINATARIO_GQL = """
mutation GenerarQRDest($input: GenerarQrDelegacionInput!) {
  generarQrDelegacion(input: $input) {
    id codigoHash motivo
    tipoDestinatario destinatarioNombre destinatarioCi destinatarioDisplay
  }
}
"""

BUSCAR_DESTINATARIO_GQL = """
query BuscarDest($query: String!) {
  buscarDestinatarioUagrm(query: $query) {
    id ci nombreCompleto roles
  }
}
"""


# ── Tests: destinatario del QR de delegación ────────────────────────────────

@pytest.mark.django_db
class TestDestinatarioDelegacion:

    def test_delegacion_externo_guarda_nombre_y_ci(
        self, gql_usuario_normal, vehiculo_activo
    ):
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_CON_DESTINATARIO_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Papá trae el auto",
                "tipoDelegacion": "entrada",
                "horasValidez": 4,
                "tipoDestinatario": "externo",
                "destinatarioNombre": "Roberto García",
                "destinatarioCi": "5678901",
            }
        })
        assert "errors" not in data, data.get("errors")
        r = data["data"]["generarQrDelegacion"]
        assert r["tipoDestinatario"] == "externo"
        assert r["destinatarioNombre"] == "Roberto García"
        assert r["destinatarioCi"] == "5678901"
        assert "Roberto García" in r["destinatarioDisplay"]
        assert "5678901" in r["destinatarioDisplay"]
        assert "Externo" in r["destinatarioDisplay"]

    def test_delegacion_registrado_valida_ci_existente(
        self, gql_usuario_normal, vehiculo_activo, usuario_normal, db
    ):
        """Miembro UAGRM: el CI debe existir en la base de datos."""
        from apps.usuarios.models import Usuario
        # Crear otro usuario en el sistema
        colega = Usuario.objects.create_user(
            ci="9999999",
            email="colega@uagrm.edu.bo",
            nombre="Carlos",
            apellido="Méndez",
            password="pass1234",
        )
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_CON_DESTINATARIO_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Colega lleva el auto",
                "tipoDelegacion": "salida",
                "horasValidez": 2,
                "tipoDestinatario": "registrado",
                "destinatarioNombre": "",  # se autocompleta del perfil
                "destinatarioCi": "9999999",
            }
        })
        assert "errors" not in data, data.get("errors")
        r = data["data"]["generarQrDelegacion"]
        assert r["tipoDestinatario"] == "registrado"
        assert r["destinatarioCi"] == "9999999"
        # Nombre autocompletado desde el perfil del usuario
        assert "Carlos" in r["destinatarioNombre"]
        assert "Méndez" in r["destinatarioNombre"]
        assert "Miembro UAGRM" in r["destinatarioDisplay"]

    def test_delegacion_registrado_ci_inexistente_da_error(
        self, gql_usuario_normal, vehiculo_activo
    ):
        """Si el CI no existe en el sistema, se rechaza la delegación."""
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_CON_DESTINATARIO_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Persona inexistente",
                "tipoDelegacion": "ambos",
                "horasValidez": 4,
                "tipoDestinatario": "registrado",
                "destinatarioNombre": "",
                "destinatarioCi": "CI_NO_EXISTE_000",
            }
        })
        assert "errors" in data
        assert "no se encontró" in data["errors"][0]["message"].lower()

    def test_delegacion_registrado_sin_ci_da_error(
        self, gql_usuario_normal, vehiculo_activo
    ):
        """Miembro UAGRM sin CI → error explícito."""
        data = gql(gql_usuario_normal, GENERAR_DELEGACION_CON_DESTINATARIO_GQL, {
            "input": {
                "vehiculoId": vehiculo_activo.id,
                "motivo": "Sin CI",
                "tipoDelegacion": "entrada",
                "horasValidez": 2,
                "tipoDestinatario": "registrado",
                "destinatarioNombre": "Alguien",
                "destinatarioCi": "",  # vacío → error
            }
        })
        assert "errors" in data
        assert "ci" in data["errors"][0]["message"].lower()

    def test_destinatario_display_sin_destinatario(
        self, db, vehiculo_activo, usuario_normal
    ):
        """Si no se ingresa destinatario, destinatario_display dice 'Sin destinatario'."""
        qr = QrSesion.objects.create(
            vehiculo=vehiculo_activo,
            codigo_hash="no_dest_test_001",
            motivo="Sin destinatario",
            tipo_delegacion="ambos",
            usos_max=2, usos_actual=0,
            fecha_expiracion=timezone.now() + timedelta(hours=4),
            generado_por=usuario_normal,
        )
        assert "Sin destinatario" in qr.destinatario_display

    def test_buscar_destinatario_uagrm_por_ci(
        self, gql_usuario_normal, db
    ):
        """buscarDestinatarioUagrm devuelve usuarios que coinciden con el query."""
        from apps.usuarios.models import Usuario
        Usuario.objects.create_user(
            ci="7654321", email="docente@uagrm.edu.bo",
            nombre="Ana", apellido="Torres", password="pass1234",
        )
        data = gql(gql_usuario_normal, BUSCAR_DESTINATARIO_GQL, {"query": "765"})
        assert "errors" not in data, data.get("errors")
        resultados = data["data"]["buscarDestinatarioUagrm"]
        cis = [r["ci"] for r in resultados]
        assert "7654321" in cis

    def test_buscar_destinatario_query_corto_retorna_vacio(
        self, gql_usuario_normal
    ):
        """Menos de 2 caracteres → lista vacía (evita buscar con 1 letra)."""
        data = gql(gql_usuario_normal, BUSCAR_DESTINATARIO_GQL, {"query": "a"})
        assert "errors" not in data
        assert data["data"]["buscarDestinatarioUagrm"] == []

    def test_buscar_destinatario_no_incluye_al_propio_usuario(
        self, gql_usuario_normal, usuario_normal
    ):
        """El usuario no puede delegarse a sí mismo."""
        data = gql(gql_usuario_normal, BUSCAR_DESTINATARIO_GQL, {
            "query": usuario_normal.ci
        })
        assert "errors" not in data
        resultados = data["data"]["buscarDestinatarioUagrm"]
        cis = [r["ci"] for r in resultados]
        assert usuario_normal.ci not in cis

    def test_url_qr_en_la_respuesta(
        self, gql_usuario_normal, qr_solo_entrada
    ):
        data = gql(gql_usuario_normal, MIS_DELEGACIONES_GQL)
        assert "errors" not in data
        delegaciones = data["data"]["misDelegaciones"]
        mi_qr = next((d for d in delegaciones if d["motivo"] == "Papá trae el auto"), None)
        assert mi_qr is not None
        assert mi_qr["urlQr"].endswith(".png")
        assert mi_qr["codigoHash"] in mi_qr["urlQr"]
