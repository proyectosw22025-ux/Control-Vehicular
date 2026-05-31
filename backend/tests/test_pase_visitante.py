"""
Tests de Mejora 2 — QR Entregable para Visitantes.

Verifica que:
  - pre_registrar_visitante crea un PaseTemporal automáticamente
  - El pase vence a las 23:00 del día de la visita (no al siguiente)
  - Un visitante que vuelve a pre-registrarse recibe un nuevo pase (el anterior se invalida)
  - verificar_pase_visitante retorna el estado correcto
  - Pases usados/vencidos retornan los estados correctos
"""
import json
import pytest
from datetime import datetime, time
from unittest.mock import patch
from django.utils import timezone

from apps.visitantes.models import Visitante
from apps.acceso.models import PaseTemporal


# ── Helpers ───────────────────────────────────────────────────────────────────

PRE_REGISTRAR_GQL = """
mutation PreRegistrarVisitante($input: CrearVisitanteInput!) {
  preRegistrarVisitante(input: $input) {
    visitante { id ci nombreCompleto }
    paseCodigo
    paseUrl
    emailEnviado
  }
}
"""

VERIFICAR_GQL = """
query VerificarPaseVisitante($codigo: String!) {
  verificarPaseVisitante(codigo: $codigo) {
    codigo
    valido
    estado
    visitanteNombre
    visitanteCi
    destino
    validoHasta
    usosActual
    usosMax
  }
}
"""


def gql(client, query, variables=None):
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    return client.post(
        "/graphql/",
        data=json.dumps(payload),
        content_type="application/json",
    ).json()


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestPreRegistrarVisitante:

    def test_crea_pase_temporal_al_pre_registrar(self, gql_client):
        """Pre-registro crea automáticamente un PaseTemporal único."""
        with patch("apps.visitantes.schema._enviar_pase_email_async", return_value=False):
            data = gql(gql_client, PRE_REGISTRAR_GQL, {"input": {
                "ci": "V-001", "nombre": "Ana", "apellido": "García",
            }})

        assert "errors" not in data, data.get("errors")
        r = data["data"]["preRegistrarVisitante"]
        assert r["paseCodigo"] != ""
        assert len(r["paseCodigo"]) == 12  # UUID hex[:12]
        assert "/visita/" in r["paseUrl"]
        assert r["paseCodigo"] in r["paseUrl"]

        # Verificar que existe en BD
        visitante = Visitante.objects.get(ci="V-001")
        pase = PaseTemporal.objects.filter(visitante=visitante, activo=True).first()
        assert pase is not None
        assert pase.codigo == r["paseCodigo"]
        assert pase.usos_max == 1

    def test_pase_vence_a_las_23_del_dia_de_visita(self, gql_client):
        """El pase debe vencer a las 23:00 del día actual — NO al día siguiente."""
        with patch("apps.visitantes.schema._enviar_pase_email_async", return_value=False):
            gql(gql_client, PRE_REGISTRAR_GQL, {"input": {
                "ci": "V-002", "nombre": "Luis", "apellido": "Pérez",
            }})

        visitante = Visitante.objects.get(ci="V-002")
        pase = PaseTemporal.objects.filter(visitante=visitante, activo=True).first()
        assert pase is not None

        # Verificar que vence hoy a las 23:00
        hoy = timezone.localdate()
        hora_cierre = time(23, 0, 0)
        fecha_esperada = timezone.make_aware(
            datetime.combine(hoy, hora_cierre),
            timezone.get_current_timezone()
        )
        diferencia_seg = abs((pase.valido_hasta - fecha_esperada).total_seconds())
        assert diferencia_seg < 5, (
            f"Pase vence a {pase.valido_hasta}, esperado ~{fecha_esperada}"
        )

    def test_segundo_preregistro_invalida_pase_anterior(self, gql_client):
        """Al pre-registrarse de nuevo, el pase anterior se invalida y se genera uno nuevo."""
        with patch("apps.visitantes.schema._enviar_pase_email_async", return_value=False):
            r1 = gql(gql_client, PRE_REGISTRAR_GQL, {"input": {
                "ci": "V-003", "nombre": "Carlos", "apellido": "López",
                "email": "carlos@test.com",
            }})
            r2 = gql(gql_client, PRE_REGISTRAR_GQL, {"input": {
                "ci": "V-003", "nombre": "Carlos", "apellido": "López",
                "destinoSugeridoTexto": "Biblioteca",
            }})

        codigo1 = r1["data"]["preRegistrarVisitante"]["paseCodigo"]
        codigo2 = r2["data"]["preRegistrarVisitante"]["paseCodigo"]
        assert codigo1 != codigo2, "Cada pre-registro debe generar un código diferente"

        # El pase anterior debe estar inactivo
        pase_viejo = PaseTemporal.objects.get(codigo=codigo1)
        pase_nuevo  = PaseTemporal.objects.get(codigo=codigo2)
        assert not pase_viejo.activo, "El pase anterior debe quedar inactivo"
        assert pase_nuevo.activo,     "El nuevo pase debe estar activo"

    def test_email_enviado_si_visitante_tiene_email(self, gql_client):
        """emailEnviado debe ser True cuando el visitante proporciona email."""
        with patch("apps.visitantes.schema._enviar_pase_email_async", return_value=True) as mock_email:
            data = gql(gql_client, PRE_REGISTRAR_GQL, {"input": {
                "ci": "V-004", "nombre": "María", "apellido": "Torres",
                "email": "maria@test.com",
            }})
        assert data["data"]["preRegistrarVisitante"]["emailEnviado"] is True
        mock_email.assert_called_once()

    def test_email_no_enviado_sin_email(self, gql_client):
        """emailEnviado debe ser False cuando el visitante no proporciona email."""
        with patch("apps.visitantes.schema._enviar_pase_email_async", return_value=False):
            data = gql(gql_client, PRE_REGISTRAR_GQL, {"input": {
                "ci": "V-005", "nombre": "Pedro", "apellido": "Ruiz",
            }})
        assert data["data"]["preRegistrarVisitante"]["emailEnviado"] is False


@pytest.mark.django_db
class TestVerificarPaseVisitante:

    @pytest.fixture
    def visitante_con_pase(self, db):
        """Crea un visitante con pase vigente para hoy."""
        v = Visitante.objects.create(
            nombre="Juan", apellido="Test", ci="VT-001",
            email="", destino_sugerido_texto="Secretaría de Admisiones",
        )
        hoy = timezone.localdate()
        tz  = timezone.get_current_timezone()
        pase = PaseTemporal.objects.create(
            visitante=v, vehiculo=None, generado_por=None,
            codigo="TESTPASE0001",
            valido_desde=timezone.now(),
            valido_hasta=timezone.make_aware(
                datetime.combine(hoy, time(23, 0, 0)), tz
            ),
            usos_max=1, activo=True,
        )
        return v, pase

    def test_pase_vigente_retorna_valido(self, gql_client, visitante_con_pase):
        """Un pase activo y no expirado retorna valido=True y estado='vigente'."""
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "TESTPASE0001"})
        r = data["data"]["verificarPaseVisitante"]
        assert r["valido"]  is True
        assert r["estado"]  == "vigente"
        assert r["visitanteNombre"] == "Juan Test"
        assert r["visitanteCi"]     == "VT-001"
        assert r["destino"]         == "Secretaría de Admisiones"

    def test_pase_usado_retorna_ya_usado(self, gql_client, visitante_con_pase):
        """Un pase con usos_actual >= usos_max retorna estado='ya_usado'."""
        _, pase = visitante_con_pase
        pase.usos_actual = 1
        pase.save(update_fields=["usos_actual"])

        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "TESTPASE0001"})
        r = data["data"]["verificarPaseVisitante"]
        assert r["valido"] is False
        assert r["estado"] == "ya_usado"

    def test_pase_vencido_retorna_vencido(self, gql_client, db):
        """Un pase cuya fecha_hasta ya pasó retorna estado='vencido'."""
        v = Visitante.objects.create(nombre="Ana", apellido="Venc", ci="VT-002", email="")
        PaseTemporal.objects.create(
            visitante=v, vehiculo=None, generado_por=None,
            codigo="VENCIDO00001",
            valido_desde=timezone.now() - timezone.timedelta(days=2),
            valido_hasta=timezone.now() - timezone.timedelta(hours=1),
            usos_max=1, activo=True,
        )
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "VENCIDO00001"})
        r = data["data"]["verificarPaseVisitante"]
        assert r["valido"] is False
        assert r["estado"] == "vencido"

    def test_codigo_inexistente_retorna_no_encontrado(self, gql_client):
        """Un código que no existe retorna estado='no_encontrado' sin error."""
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "XXXXXXXXXXXX"})
        assert "errors" not in data, data.get("errors")
        r = data["data"]["verificarPaseVisitante"]
        assert r["valido"] is False
        assert r["estado"] == "no_encontrado"

    def test_codigo_insensible_a_mayusculas(self, gql_client, visitante_con_pase):
        """El código se normaliza a mayúsculas — el visitante puede ingresarlo en minúsculas."""
        data = gql(gql_client, VERIFICAR_GQL, {"codigo": "testpase0001"})
        r = data["data"]["verificarPaseVisitante"]
        assert r["valido"] is True
        assert r["codigo"] == "TESTPASE0001"
