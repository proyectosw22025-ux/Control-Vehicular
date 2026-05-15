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

from .models import TipoVisita, Visitante, Visita


# ── Types ──────────────────────────────────────────────────────────────────

@strawberry.type
class TipoVisitaType:
    id: int
    nombre: str
    descripcion: str
    requiere_vehiculo: bool


@strawberry.type
class VisitanteType:
    id: int
    nombre: str
    apellido: str
    ci: str
    telefono: str
    email: str
    created_at: datetime

    @strawberry.field
    def nombre_completo(self) -> str:
        return f"{self.nombre} {self.apellido}"


@strawberry.type
class VisitaType:
    id: int
    motivo: str
    estado: str
    fecha_entrada: Optional[datetime]
    fecha_salida: Optional[datetime]
    observaciones: str
    placa_vehiculo_visitante: str
    created_at: datetime

    @strawberry.field
    def visitante(self) -> VisitanteType:
        return self.visitante

    @strawberry.field
    def anfitrion_nombre(self) -> str:
        return f"{self.anfitrion.nombre} {self.anfitrion.apellido}"

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


@strawberry.input
class RegistrarVisitaInput:
    visitante_id: int
    anfitrion_id: int
    motivo: str
    tipo_visita_id: Optional[int] = None
    vehiculo_id: Optional[int] = None
    placa_vehiculo_visitante: Optional[str] = ""   # placa del vehículo externo del visitante


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
    def tipos_visita(self, info: Info) -> List[TipoVisitaType]:
        return list(TipoVisita.objects.all())


# ── Mutations ──────────────────────────────────────────────────────────────

@strawberry.type
class VisitantesMutation:

    @strawberry.mutation
    def pre_registrar_visitante(self, info: Info, input: CrearVisitanteInput) -> VisitanteType:
        """
        Permite a visitantes externos pre-registrar sus datos SIN autenticación.
        El guardia los encontrará por CI al llegar — no tiene que escribir nada.
        Si el CI ya está en el sistema, retorna el registro existente (visitante frecuente).
        """
        ci_limpio = input.ci.strip()
        if not ci_limpio:
            raise Exception("El CI es obligatorio para el pre-registro")
        if not input.nombre.strip() or not input.apellido.strip():
            raise Exception("Nombre y apellido son obligatorios")

        existente = Visitante.objects.filter(ci=ci_limpio).first()
        if existente:
            return existente  # Visitante frecuente — el guardia lo encontrará por CI

        return Visitante.objects.create(
            nombre=input.nombre.strip(),
            apellido=input.apellido.strip(),
            ci=ci_limpio,
            telefono=input.telefono.strip() if input.telefono else "",
            email=input.email.strip() if input.email else "",
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

        visitante = Visitante.objects.filter(pk=input.visitante_id).first()
        anfitrion  = Usuario.objects.filter(pk=input.anfitrion_id).first()
        if not visitante:
            raise Exception("Visitante no encontrado")
        if not anfitrion:
            raise Exception("Anfitrión no encontrado")

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
                anf = f"{en_curso.anfitrion.nombre} {en_curso.anfitrion.apellido}"
                raise Exception(
                    f"{visitante.nombre} {visitante.apellido} ya tiene una visita "
                    f"en estado '{en_curso.estado}' con {anf}. "
                    f"Finaliza o cancela esa visita antes de registrar una nueva."
                )

            visita = Visita.objects.create(
                visitante=visitante, anfitrion=anfitrion,
                tipo_visita=tipo_visita, vehiculo=vehiculo,
                motivo=motivo,
                placa_vehiculo_visitante=placa_externa,
            )
            detalle_vehiculo = f" · vehículo: {placa_externa}" if placa_externa else ""
            log_audit(
                user, "visita_registrada",
                f"Visita de {visitante.nombre} {visitante.apellido} → {anfitrion.nombre} {anfitrion.apellido}{detalle_vehiculo}",
                request=info.context.request,
            )

        # Notificar al anfitrión fuera de la transacción para no bloquear el commit
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
            if observaciones:
                visita.observaciones = observaciones.strip()
            visita.save(update_fields=["estado", "fecha_salida", "observaciones"])
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
