import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.utils import timezone

from .models import TipoVisita, Visitante, Visita


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


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

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


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class VisitantesQuery:
    @strawberry.field
    def visitantes(self, info: Info, buscar: Optional[str] = None) -> List[VisitanteType]:
        qs = Visitante.objects.all().order_by("apellido", "nombre")
        if buscar:
            from django.db.models import Q
            qs = qs.filter(
                Q(ci__icontains=buscar) | Q(nombre__icontains=buscar) | Q(apellido__icontains=buscar)
            )
        return list(qs)

    @strawberry.field
    def visitante_por_ci(self, info: Info, ci: str) -> Optional[VisitanteType]:
        return Visitante.objects.filter(ci=ci).first()

    @strawberry.field
    def visitas_activas(self, info: Info) -> List[VisitaType]:
        return list(
            Visita.objects.filter(estado="activa")
            .select_related("visitante", "anfitrion", "tipo_visita", "vehiculo")
            .order_by("-fecha_entrada")
        )

    @strawberry.field
    def visitas_por_anfitrion(self, info: Info, anfitrion_id: int, estado: Optional[str] = None) -> List[VisitaType]:
        qs = Visita.objects.filter(anfitrion_id=anfitrion_id).select_related(
            "visitante", "anfitrion", "tipo_visita", "vehiculo"
        ).order_by("-created_at")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def tipos_visita(self, info: Info) -> List[TipoVisitaType]:
        return list(TipoVisita.objects.all())


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class VisitantesMutation:
    @strawberry.mutation
    def registrar_visitante(self, info: Info, input: CrearVisitanteInput) -> VisitanteType:
        if Visitante.objects.filter(ci=input.ci).exists():
            raise Exception(f"Ya existe un visitante con CI {input.ci}")
        return Visitante.objects.create(
            nombre=input.nombre, apellido=input.apellido, ci=input.ci,
            telefono=input.telefono or "", email=input.email or "",
        )

    @strawberry.mutation
    def registrar_visita(self, info: Info, input: RegistrarVisitaInput) -> VisitaType:
        from apps.usuarios.models import Usuario
        from apps.vehiculos.models import Vehiculo
        visitante = Visitante.objects.filter(pk=input.visitante_id).first()
        anfitrion = Usuario.objects.filter(pk=input.anfitrion_id).first()
        if not visitante:
            raise Exception("Visitante no encontrado")
        if not anfitrion:
            raise Exception("Anfitrión no encontrado")
        tipo_visita = TipoVisita.objects.filter(pk=input.tipo_visita_id).first() if input.tipo_visita_id else None
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first() if input.vehiculo_id else None
        if input.vehiculo_id and not vehiculo:
            raise Exception("Vehículo no encontrado")
        return Visita.objects.create(
            visitante=visitante, anfitrion=anfitrion, tipo_visita=tipo_visita,
            vehiculo=vehiculo, motivo=input.motivo,
        )

    @strawberry.mutation
    def iniciar_visita(self, info: Info, visita_id: int) -> VisitaType:
        visita = Visita.objects.filter(pk=visita_id, estado="pendiente").first()
        if not visita:
            raise Exception("Visita pendiente no encontrada")
        visita.estado = "activa"
        visita.fecha_entrada = timezone.now()
        visita.save()
        return visita

    @strawberry.mutation
    def finalizar_visita(self, info: Info, visita_id: int, observaciones: Optional[str] = "") -> VisitaType:
        visita = Visita.objects.filter(pk=visita_id, estado="activa").first()
        if not visita:
            raise Exception("Visita activa no encontrada")
        visita.estado = "completada"
        visita.fecha_salida = timezone.now()
        if observaciones:
            visita.observaciones = observaciones
        visita.save()
        return visita
