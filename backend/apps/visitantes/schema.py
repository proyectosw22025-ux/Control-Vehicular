"""
Módulo Visitantes — Strawberry GraphQL Schema

Correcciones aplicadas:
  - Auth en queries: datos personales (CI, teléfono) protegidos.
  - Validación TipoVisita.requiere_vehiculo: si el tipo exige vehículo, se valida.
  - motivo.strip() y ci.strip() obligatorios en todas las operaciones.
  - Notificación al anfitrión en hilo daemon (no bloquea la request del guardia).
  - transaction.atomic() en iniciar_visita y finalizar_visita.
  - Nueva mutation cancelar_visita: anfitrión puede rechazar visitante desconocido.
  - duracion_minutos expuesto en VisitaType para el panel del guardia.
"""
import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.db import transaction
from django.utils import timezone

from .models import TipoVisita, Visitante, Visita, DependenciaUAGRM

FRONTEND_URL = "https://control-vehicular-six.vercel.app"


# ── Types ──────────────────────────────────────────────────────────────────

@strawberry.type
class TipoVisitaType:
    id: int
    nombre: str
    descripcion: str
    requiere_vehiculo: bool
    duracion_esperada_horas: int


@strawberry.type
class DependenciaType:
    id: int
    nombre: str
    codigo: str
    descripcion: str
    ubicacion: str
    activo: bool


@strawberry.type
class VisitanteType:
    id: int
    nombre: str
    apellido: str
    ci: str
    telefono: str
    email: str
    procedencia: str
    placa_habitual: str
    destino_sugerido_texto: str
    created_at: datetime

    @strawberry.field
    def nombre_completo(self) -> str:
        return f"{self.nombre} {self.apellido}"

    @strawberry.field
    def tiene_datos_previos(self) -> bool:
        """True si el visitante se pre-registró y completó datos adicionales."""
        return bool(self.placa_habitual or self.destino_sugerido_texto or self.procedencia)


@strawberry.type
class PreRegistroResultType:
    """
    Resultado del pre-registro de visitante.
    Incluye el código del pase QR para mostrar en la pantalla de éxito del frontend.
    """
    visitante:     VisitanteType
    pase_codigo:   str
    pase_url:      str    # URL pública /visita/:codigo — para el email y la pantalla de éxito
    email_enviado: bool   # True si se intentó enviar (el visitante puede no tener email)


@strawberry.type
class PaseVerificacionType:
    """
    Estado de un pase de visitante — consulta pública sin autenticación.
    Usada por la página /visita/:codigo que el visitante muestra al guardia.
    """
    codigo:           str
    valido:           bool
    estado:           str   # vigente | vencido | ya_usado | no_encontrado
    visitante_nombre: str
    visitante_ci:     str
    destino:          str
    valido_hasta:     str
    usos_actual:      int
    usos_max:         int


@strawberry.type
class VisitaType:
    id: int
    motivo: str
    estado: str
    fecha_entrada: Optional[datetime]
    fecha_salida: Optional[datetime]
    observaciones: str
    placa_vehiculo_visitante: str
    num_acompanantes: int
    tipo_cierre: str
    created_at: datetime

    @strawberry.field
    def visitante(self) -> VisitanteType:
        return self.visitante

    @strawberry.field
    def anfitrion_nombre(self) -> Optional[str]:
        if not self.anfitrion:
            return None
        return f"{self.anfitrion.nombre} {self.anfitrion.apellido}"

    @strawberry.field
    def dependencia(self) -> Optional[DependenciaType]:
        return self.dependencia

    @strawberry.field
    def tipo_visita(self) -> Optional[TipoVisitaType]:
        return self.tipo_visita

    @strawberry.field
    def placa_vehiculo(self) -> Optional[str]:
        return self.vehiculo.placa if self.vehiculo else None

    @strawberry.field
    def duracion_minutos(self) -> Optional[int]:
        """
        Minutos desde que el visitante entró.
        Útil para el guardia: alerta si alguien lleva demasiado tiempo.
        """
        if not self.fecha_entrada:
            return None
        fin = self.fecha_salida or timezone.now()
        return int((fin - self.fecha_entrada).total_seconds() / 60)


# ── Inputs ─────────────────────────────────────────────────────────────────

@strawberry.input
class CrearVisitanteInput:
    nombre: str
    apellido: str
    ci: str
    telefono: Optional[str] = ""
    email: Optional[str] = ""
    procedencia: Optional[str] = ""
    placa_habitual: Optional[str] = ""
    destino_sugerido_texto: Optional[str] = ""


@strawberry.input
class RegistrarVisitaInput:
    visitante_id: int
    motivo: str
    # Destino: anfitrion_id O dependencia_id — al menos uno es obligatorio
    anfitrion_id:   Optional[int] = None
    dependencia_id: Optional[int] = None
    tipo_visita_id: Optional[int] = None
    vehiculo_id:    Optional[int] = None
    placa_vehiculo_visitante: Optional[str] = ""
    num_acompanantes: Optional[int] = 0


@strawberry.input
class RegistrarVisitaRapidaInput:
    """
    Registro exprés: crea el visitante si no existe, registra la visita
    e inicia el ingreso en una sola operación (sin estado 'pendiente').
    Diseñado para el guardia en momentos de alta afluencia.
    """
    ci: str
    nombre: str
    apellido: str
    procedencia: Optional[str] = ""
    telefono: Optional[str] = ""
    # Destino
    anfitrion_id:   Optional[int] = None
    dependencia_id: Optional[int] = None
    tipo_visita_id: Optional[int] = None
    motivo: str = "Consulta / trámite general"
    placa_vehiculo_visitante: Optional[str] = ""
    num_acompanantes: Optional[int] = 0


# ── Generación y envío del pase de visitante ──────────────────────────────

def _crear_pase_visitante(visitante) -> "tuple[str, str]":
    """
    Crea un PaseTemporal para el visitante con vigencia hasta las 23:00 de hoy.
    Retorna (codigo, url_verificacion).
    """
    import uuid
    from datetime import datetime, time
    from django.utils import timezone
    from apps.acceso.models import PaseTemporal

    # Invalidar pases anteriores del mismo visitante que aún estén activos
    PaseTemporal.objects.filter(
        visitante=visitante,
        activo=True,
    ).update(activo=False)

    hoy   = timezone.localdate()
    tz    = timezone.get_current_timezone()
    inicio = timezone.now()
    fin    = timezone.make_aware(datetime.combine(hoy, time(23, 0, 0)), tz)

    codigo = uuid.uuid4().hex[:12].upper()
    PaseTemporal.objects.create(
        visitante=visitante,
        vehiculo=None,
        generado_por=None,
        codigo=codigo,
        valido_desde=inicio,
        valido_hasta=fin,
        usos_max=1,
    )
    url = f"{FRONTEND_URL}/visita/{codigo}"
    return codigo, url


def _enviar_pase_email_async(visitante, codigo: str, url: str) -> bool:
    """Envía el email con el código QR en un hilo daemon. Retorna False si no hay email."""
    email = getattr(visitante, "email", "")
    if not email:
        return False

    import threading
    from django.utils import timezone
    from apps.notificaciones.utils import _enviar_email_sync
    from apps.notificaciones.email_templates import email_pase_visitante

    fecha_str = timezone.localdate().strftime("%d/%m/%Y")
    nombre = f"{visitante.nombre} {visitante.apellido}"
    destino = visitante.destino_sugerido_texto or "Campus UAGRM"
    asunto, html = email_pase_visitante(nombre, destino, fecha_str, codigo, url)

    threading.Thread(
        target=_enviar_email_sync,
        args=(email, asunto, f"Tu código de acceso es: {codigo}\nVerifica en: {url}", html),
        daemon=True,
    ).start()
    return True


# ── Notificación al anfitrión (async — no bloquea al guardia) ──────────────

def _notificar_anfitrion_async(anfitrion, visitante, motivo: str) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            from apps.notificaciones.email_templates import email_visita_registrada
            enviar_notificacion(
                usuario=anfitrion,
                titulo=f"Visita registrada — {visitante.nombre} {visitante.apellido}",
                mensaje=f"{visitante.nombre} {visitante.apellido} (CI: {visitante.ci}) quiere verte. Motivo: {motivo}",
                tipo_codigo="visita_registrada",
            )
            asunto, html = email_visita_registrada(
                anfitrion.nombre,
                f"{visitante.nombre} {visitante.apellido}",
                visitante.ci,
                motivo,
            )
            enviar_email(
                usuario=anfitrion,
                asunto=asunto,
                cuerpo=f"Tienes una visita de {visitante.nombre} {visitante.apellido}.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


# ── Queries ────────────────────────────────────────────────────────────────

@strawberry.type
class VisitantesQuery:

    @strawberry.field
    def verificar_pase_visitante(self, info: Info, codigo: str) -> PaseVerificacionType:
        """
        Consulta pública (sin autenticación) del estado de un pase de visitante.
        Usada por la página /visita/:codigo que el visitante muestra al guardia en portería.
        Solo expone datos necesarios — no datos personales sensibles completos.
        """
        from apps.acceso.models import PaseTemporal
        from django.utils import timezone

        codigo_upper = codigo.strip().upper()
        pase = (
            PaseTemporal.objects
            .filter(codigo=codigo_upper)
            .select_related("visitante")
            .first()
        )

        if not pase or not pase.visitante:
            return PaseVerificacionType(
                codigo=codigo_upper, valido=False, estado="no_encontrado",
                visitante_nombre="—", visitante_ci="—", destino="—",
                valido_hasta="—", usos_actual=0, usos_max=1,
            )

        ahora = timezone.now()
        if pase.usos_actual >= pase.usos_max or not pase.activo:
            estado = "ya_usado"
        elif ahora > pase.valido_hasta:
            estado = "vencido"
        else:
            estado = "vigente"

        v = pase.visitante
        return PaseVerificacionType(
            codigo       = codigo_upper,
            valido       = estado == "vigente",
            estado       = estado,
            visitante_nombre = f"{v.nombre} {v.apellido}",
            visitante_ci     = v.ci,
            destino          = v.destino_sugerido_texto or "Campus UAGRM",
            valido_hasta     = pase.valido_hasta.strftime("%d/%m/%Y %H:%M"),
            usos_actual      = pase.usos_actual,
            usos_max         = pase.usos_max,
        )

    @strawberry.field
    def visitantes(self, info: Info, buscar: Optional[str] = None) -> List[VisitanteType]:
        """Solo guardia/admin puede listar visitantes — datos personales protegidos."""
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden consultar visitantes")
        qs = Visitante.objects.all().order_by("apellido", "nombre")
        if buscar:
            from django.db.models import Q
            b = buscar.strip()
            qs = qs.filter(
                Q(ci__icontains=b) | Q(nombre__icontains=b) | Q(apellido__icontains=b)
            )
        return list(qs)

    @strawberry.field
    def visitante_por_ci(self, info: Info, ci: str) -> Optional[VisitanteType]:
        """Búsqueda rápida por CI — usada por el guardia en tablet para autocompletar."""
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden consultar visitantes")
        return Visitante.objects.filter(ci=ci.strip()).first()

    @strawberry.field
    def visitas_activas(self, info: Info) -> List[VisitaType]:
        """Lista de visitas en curso — solo personal autorizado."""
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden ver las visitas activas")
        return list(
            Visita.objects.filter(estado__in=["pendiente", "activa"])
            .select_related("visitante", "anfitrion", "tipo_visita", "vehiculo")
            .order_by("-created_at")
        )

    @strawberry.field
    def visitas_por_anfitrion(
        self, info: Info, anfitrion_id: int, estado: Optional[str] = None
    ) -> List[VisitaType]:
        """
        Un anfitrión puede ver sus propias visitas.
        Admin y guardia pueden ver las de cualquier anfitrión.
        """
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and user.pk != anfitrion_id:
            raise Exception("Solo puedes consultar tus propias visitas")
        qs = Visita.objects.filter(anfitrion_id=anfitrion_id).select_related(
            "visitante", "anfitrion", "tipo_visita", "vehiculo"
        ).order_by("-created_at")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def tipos_visita(self) -> List[TipoVisitaType]:
        return list(TipoVisita.objects.all().order_by("nombre"))

    @strawberry.field
    def dependencias_uagrm(self, buscar: Optional[str] = None) -> List[DependenciaType]:
        """Lista de dependencias activas para el selector de destino."""
        qs = DependenciaUAGRM.objects.filter(activo=True).order_by("nombre")
        if buscar:
            from django.db.models import Q
            b = buscar.strip()
            qs = qs.filter(Q(nombre__icontains=b) | Q(codigo__icontains=b) | Q(descripcion__icontains=b))
        return list(qs)

    @strawberry.field
    def visitas_historial(
        self,
        info: Info,
        estado: Optional[str] = None,
        fecha_desde: Optional[str] = None,
        fecha_hasta: Optional[str] = None,
        buscar: Optional[str] = None,
        limite: int = 60,
    ) -> List[VisitaType]:
        """
        Historial de visitas completadas y canceladas con filtros avanzados.
        Permite al guardia verificar si un visitante estuvo antes en el campus.
        Solo admin y guardia.
        """
        from apps.usuarios.utils import tiene_rol
        from django.db.models import Q

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo personal autorizado puede ver el historial de visitas")

        qs = (
            Visita.objects
            .select_related("visitante", "anfitrion", "tipo_visita", "vehiculo")
            .order_by("-created_at")
        )

        estados_validos = {"completada", "cancelada", "pendiente", "activa"}
        if estado and estado in estados_validos:
            qs = qs.filter(estado=estado)
        else:
            qs = qs.filter(estado__in=["completada", "cancelada"])

        if fecha_desde:
            try:
                qs = qs.filter(created_at__date__gte=fecha_desde)
            except Exception:
                pass

        if fecha_hasta:
            try:
                qs = qs.filter(created_at__date__lte=fecha_hasta)
            except Exception:
                pass

        if buscar:
            b = buscar.strip()
            qs = qs.filter(
                Q(visitante__nombre__icontains=b)
                | Q(visitante__apellido__icontains=b)
                | Q(visitante__ci__icontains=b)
                | Q(motivo__icontains=b)
                | Q(visitante__procedencia__icontains=b)
            )

        return list(qs[:min(limite, 200)])


# ── Mutations ──────────────────────────────────────────────────────────────

@strawberry.type
class VisitantesMutation:

    @strawberry.mutation
    def pre_registrar_visitante(self, input: CrearVisitanteInput) -> PreRegistroResultType:
        """
        Permite a visitantes externos pre-registrar sus datos SIN autenticación.
        Genera automáticamente un PaseTemporal con código QR válido hasta las 23:00.
        Si el visitante tiene email, se le envía el pase por correo.
        Si el CI ya está en el sistema, actualiza los datos y genera un nuevo pase.
        """
        ci_limpio = input.ci.strip()
        if not ci_limpio:
            raise Exception("El CI es obligatorio para el pre-registro")
        if not input.nombre.strip() or not input.apellido.strip():
            raise Exception("Nombre y apellido son obligatorios")

        existente = Visitante.objects.filter(ci=ci_limpio).first()
        if existente:
            actualizar = {}
            if input.placa_habitual and input.placa_habitual.strip():
                actualizar["placa_habitual"] = input.placa_habitual.strip().upper()
            if input.destino_sugerido_texto and input.destino_sugerido_texto.strip():
                actualizar["destino_sugerido_texto"] = input.destino_sugerido_texto.strip()
            if input.procedencia and input.procedencia.strip():
                actualizar["procedencia"] = input.procedencia.strip()
            if input.email and input.email.strip():
                actualizar["email"] = input.email.strip()
            if actualizar:
                for campo, valor in actualizar.items():
                    setattr(existente, campo, valor)
                existente.save(update_fields=list(actualizar.keys()))
            visitante = existente
        else:
            visitante = Visitante.objects.create(
                nombre=input.nombre.strip(),
                apellido=input.apellido.strip(),
                ci=ci_limpio,
                telefono=input.telefono.strip() if input.telefono else "",
                email=input.email.strip() if input.email else "",
                procedencia=input.procedencia.strip() if input.procedencia else "",
                placa_habitual=(input.placa_habitual or "").strip().upper(),
                destino_sugerido_texto=(input.destino_sugerido_texto or "").strip(),
            )

        # Generar PaseTemporal + enviar email (en hilo daemon — no bloquea la request)
        codigo, url = _crear_pase_visitante(visitante)
        email_ok    = _enviar_pase_email_async(visitante, codigo, url)

        return PreRegistroResultType(
            visitante=visitante,
            pase_codigo=codigo,
            pase_url=url,
            email_enviado=email_ok,
        )

    @strawberry.mutation
    def registrar_visitante(self, info: Info, input: CrearVisitanteInput) -> VisitanteType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden registrar visitantes")

        ci_limpio = input.ci.strip()
        if not ci_limpio:
            raise Exception("El CI del visitante es obligatorio")

        # Reutilizar visitante existente si ya está registrado (visitante frecuente)
        existente = Visitante.objects.filter(ci=ci_limpio).first()
        if existente:
            raise Exception(
                f"Ya existe un visitante con CI {ci_limpio}: "
                f"{existente.nombre} {existente.apellido}"
            )

        visitante = Visitante.objects.create(
            nombre=input.nombre.strip(),
            apellido=input.apellido.strip(),
            ci=ci_limpio,
            telefono=input.telefono.strip() if input.telefono else "",
            email=input.email.strip() if input.email else "",
            procedencia=input.procedencia.strip() if input.procedencia else "",
            placa_habitual=(input.placa_habitual or "").strip().upper(),
            destino_sugerido_texto=(input.destino_sugerido_texto or "").strip(),
        )
        log_audit(
            user, "visitante_registrado",
            f"Visitante {visitante.nombre} {visitante.apellido} (CI: {visitante.ci}) registrado",
            request=info.context.request,
        )
        return visitante

    @strawberry.mutation
    def registrar_visita(self, info: Info, input: RegistrarVisitaInput) -> VisitaType:
        from apps.usuarios.models import Usuario
        from apps.usuarios.utils import tiene_rol
        from apps.vehiculos.models import Vehiculo
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden registrar visitas")

        motivo = input.motivo.strip()
        if not motivo:
            raise Exception("El motivo de la visita es obligatorio")

        if not input.anfitrion_id and not input.dependencia_id:
            raise Exception(
                "Debes especificar a quién visita (anfitrión) o a qué dependencia se dirige. "
                "Si el visitante no conoce a nadie, selecciona la dependencia o área de destino."
            )

        visitante = Visitante.objects.filter(pk=input.visitante_id).first()
        if not visitante:
            raise Exception("Visitante no encontrado")

        anfitrion = None
        if input.anfitrion_id:
            anfitrion = Usuario.objects.filter(pk=input.anfitrion_id).first()
            if not anfitrion:
                raise Exception("Anfitrión no encontrado")

        dependencia = None
        if input.dependencia_id:
            dependencia = DependenciaUAGRM.objects.filter(pk=input.dependencia_id).first()
            if not dependencia:
                raise Exception("Dependencia no encontrada")

        tipo_visita = None
        if input.tipo_visita_id:
            tipo_visita = TipoVisita.objects.filter(pk=input.tipo_visita_id).first()
            if not tipo_visita:
                raise Exception("Tipo de visita no encontrado")
            # Regla 1: si el tipo exige vehículo, debe proporcionarse
            if tipo_visita.requiere_vehiculo and not input.vehiculo_id:
                raise Exception(
                    f"El tipo de visita '{tipo_visita.nombre}' requiere especificar un vehículo"
                )

        vehiculo = None
        if input.vehiculo_id:
            vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
            if not vehiculo:
                raise Exception("Vehículo no encontrado")

        # Normalizar placa del visitante a mayúsculas (TAXI, ABC-123, etc.)
        placa_externa = (input.placa_vehiculo_visitante or "").strip().upper()

        with transaction.atomic():
            # Guard anti-duplicado: mismo patrón que el QR dinámico.
            en_curso = (
                Visita.objects
                .filter(visitante=visitante, estado__in=["pendiente", "activa"])
                .select_related("anfitrion")
                .first()
            )
            if en_curso:
                destino_actual = (
                    f"{en_curso.anfitrion.nombre} {en_curso.anfitrion.apellido}"
                    if en_curso.anfitrion else
                    (en_curso.dependencia.nombre if en_curso.dependencia else "destino desconocido")
                )
                raise Exception(
                    f"{visitante.nombre} {visitante.apellido} ya tiene una visita "
                    f"en estado '{en_curso.estado}' con {destino_actual}. "
                    f"Finaliza o cancela esa visita antes de registrar una nueva."
                )

            visita = Visita.objects.create(
                visitante=visitante,
                anfitrion=anfitrion,
                dependencia=dependencia,
                tipo_visita=tipo_visita,
                vehiculo=vehiculo,
                motivo=motivo,
                placa_vehiculo_visitante=placa_externa,
                num_acompanantes=max(0, input.num_acompanantes or 0),
            )
            destino_log = (
                f"{anfitrion.nombre} {anfitrion.apellido}" if anfitrion
                else (dependencia.nombre if dependencia else "sin destino")
            )
            detalle_vehiculo = f" · vehículo: {placa_externa}" if placa_externa else ""
            log_audit(
                user, "visita_registrada",
                f"Visita de {visitante.nombre} {visitante.apellido} → {destino_log}{detalle_vehiculo}",
                request=info.context.request,
            )

        # Notificar al anfitrión solo si existe (visitas institucionales no tienen anfitrión)
        if anfitrion:
            _notificar_anfitrion_async(anfitrion, visitante, motivo)
        return visita

    @strawberry.mutation
    def iniciar_visita(self, info: Info, visita_id: int) -> VisitaType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden iniciar visitas")

        with transaction.atomic():
            visita = (
                Visita.objects
                .select_related("visitante", "anfitrion")
                .filter(pk=visita_id, estado="pendiente")
                .first()
            )
            if not visita:
                raise Exception("Visita pendiente no encontrada")
            visita.estado = "activa"
            visita.fecha_entrada = timezone.now()
            visita.save(update_fields=["estado", "fecha_entrada"])
            log_audit(
                user, "visita_iniciada",
                f"Visita #{visita_id}: {visita.visitante.nombre} {visita.visitante.apellido} ingresó",
                request=info.context.request,
            )
        return visita

    @strawberry.mutation
    def finalizar_visita(
        self, info: Info, visita_id: int, observaciones: Optional[str] = ""
    ) -> VisitaType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden finalizar visitas")

        with transaction.atomic():
            visita = (
                Visita.objects
                .select_related("visitante")
                .filter(pk=visita_id, estado="activa")
                .first()
            )
            if not visita:
                raise Exception("Visita activa no encontrada")
            visita.estado = "completada"
            visita.fecha_salida = timezone.now()
            visita.tipo_cierre = "manual_guardia"
            if observaciones:
                visita.observaciones = observaciones.strip()
            visita.save(update_fields=["estado", "fecha_salida", "tipo_cierre", "observaciones"])
            duracion = int((visita.fecha_salida - visita.fecha_entrada).total_seconds() / 60) if visita.fecha_entrada else 0
            log_audit(
                user, "visita_finalizada",
                f"Visita #{visita_id}: {visita.visitante.nombre} {visita.visitante.apellido} "
                f"salió ({duracion} min)",
                request=info.context.request,
            )
        return visita

    @strawberry.mutation
    def cancelar_visita(
        self, info: Info, visita_id: int, motivo_cancelacion: Optional[str] = ""
    ) -> VisitaType:
        """
        Permite al anfitrión rechazar una visita pendiente
        (ej: no conoce al visitante, no estaba esperando a nadie).
        También puede ser cancelada por guardia/admin.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        with transaction.atomic():
            visita = (
                Visita.objects
                .select_related("visitante", "anfitrion")
                .filter(pk=visita_id)
                .first()
            )
            if not visita:
                raise Exception("Visita no encontrada")
            if visita.estado not in ["pendiente", "activa"]:
                raise Exception("Solo se pueden cancelar visitas pendientes o activas")

            es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
            es_anfitrion = visita.anfitrion_id == user.pk
            if not es_personal and not es_anfitrion:
                raise Exception("Solo el anfitrión o personal autorizado puede cancelar esta visita")

            visita.estado = "cancelada"
            if motivo_cancelacion:
                visita.observaciones = motivo_cancelacion.strip()
            if not visita.fecha_salida and visita.fecha_entrada:
                visita.fecha_salida = timezone.now()
            visita.save(update_fields=["estado", "observaciones", "fecha_salida"])
            log_audit(
                user, "visita_cancelada",
                f"Visita #{visita_id}: {visita.visitante.nombre} {visita.visitante.apellido} "
                f"cancelada por {user.ci}",
                request=info.context.request,
            )
        return visita

    @strawberry.mutation
    def confirmar_salida_anfitrion(self, info: Info, visita_id: int) -> VisitaType:
        """
        El anfitrión confirma que su visitante ya salió del campus.
        Se llama desde la notificación de verificación enviada por el sistema.
        Marca la visita con tipo_cierre='confirmado_anfitrion' para distinguirla
        de una salida registrada por guardia o auto-cerrada.
        """
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        with transaction.atomic():
            visita = (
                Visita.objects
                .select_related("visitante", "anfitrion")
                .filter(pk=visita_id)
                .first()
            )
            if not visita:
                raise Exception("Visita no encontrada")
            if visita.anfitrion_id != user.pk:
                raise Exception("Solo el anfitrión puede confirmar la salida de su visitante")
            if visita.estado not in ["activa", "pendiente"]:
                raise Exception("La visita ya fue cerrada anteriormente")

            visita.estado = "completada"
            visita.fecha_salida = timezone.now()
            visita.tipo_cierre = "confirmado_anfitrion"
            visita.save(update_fields=["estado", "fecha_salida", "tipo_cierre"])
            log_audit(
                user, "salida_confirmada_anfitrion",
                f"Visita #{visita_id}: {visita.visitante.nombre} {visita.visitante.apellido} "
                f"— salida confirmada por anfitrión {user.ci}",
                request=info.context.request,
            )
        return visita

    @strawberry.mutation
    def registrar_visita_rapida(self, info: Info, input: RegistrarVisitaRapidaInput) -> VisitaType:
        """
        Registro exprés: crea el visitante si no existe, registra la visita
        e inicia el ingreso en UNA sola operación sin estado 'pendiente'.
        Para guardias en momentos de alta afluencia.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden registrar visitas")

        ci_limpio = input.ci.strip()
        if not ci_limpio:
            raise Exception("El CI del visitante es obligatorio")
        if not input.anfitrion_id and not input.dependencia_id:
            raise Exception("Especifica el anfitrión o la dependencia de destino")

        motivo = (input.motivo or "Consulta / trámite general").strip()
        placa  = (input.placa_vehiculo_visitante or "").strip().upper()

        anfitrion = None
        if input.anfitrion_id:
            from apps.usuarios.models import Usuario
            anfitrion = Usuario.objects.filter(pk=input.anfitrion_id).first()
            if not anfitrion:
                raise Exception("Anfitrión no encontrado")

        dependencia = None
        if input.dependencia_id:
            dependencia = DependenciaUAGRM.objects.filter(pk=input.dependencia_id).first()
            if not dependencia:
                raise Exception("Dependencia no encontrada")

        tipo_visita = None
        if input.tipo_visita_id:
            tipo_visita = TipoVisita.objects.filter(pk=input.tipo_visita_id).first()

        with transaction.atomic():
            visitante, creado = Visitante.objects.get_or_create(
                ci=ci_limpio,
                defaults={
                    "nombre":      input.nombre.strip(),
                    "apellido":    input.apellido.strip(),
                    "telefono":    (input.telefono or "").strip(),
                    "procedencia": (input.procedencia or "").strip(),
                },
            )

            en_curso = Visita.objects.filter(
                visitante=visitante, estado__in=["pendiente", "activa"]
            ).first()
            if en_curso:
                raise Exception(
                    f"{visitante.nombre} {visitante.apellido} ya tiene una visita activa. "
                    "Finaliza esa visita antes de registrar una nueva."
                )

            visita = Visita.objects.create(
                visitante=visitante,
                anfitrion=anfitrion,
                dependencia=dependencia,
                tipo_visita=tipo_visita,
                motivo=motivo,
                placa_vehiculo_visitante=placa,
                num_acompanantes=max(0, input.num_acompanantes or 0),
                estado="activa",
                fecha_entrada=timezone.now(),
            )

            destino_log = (
                f"{anfitrion.nombre} {anfitrion.apellido}" if anfitrion
                else (dependencia.nombre if dependencia else "sin destino especificado")
            )
            prefijo = "visitante_creado+" if creado else ""
            log_audit(
                user, f"{prefijo}visita_rapida",
                f"Registro rápido: {visitante.nombre} {visitante.apellido} → {destino_log}"
                + (f" · {placa}" if placa else ""),
                request=info.context.request,
            )

        if anfitrion:
            _notificar_anfitrion_async(anfitrion, visitante, motivo)
        return visita
