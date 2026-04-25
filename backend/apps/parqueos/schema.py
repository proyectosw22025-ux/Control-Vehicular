import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.utils import timezone

from .models import (
    CategoriaEspacio, ZonaParqueo, EspacioParqueo,
    SesionParqueo, Reserva,
)


@strawberry.type
class CategoriaEspacioType:
    id: int
    nombre: str
    descripcion: str
    es_discapacidad: bool
    color: str


@strawberry.type
class ZonaParqueoType:
    id: int
    nombre: str
    descripcion: str
    ubicacion: str
    capacidad_total: int
    activo: bool

    @strawberry.field
    def espacios_disponibles(self) -> int:
        return EspacioParqueo.objects.filter(zona_id=self.id, estado="disponible").count()


@strawberry.type
class EspacioParqueoType:
    id: int
    numero: str
    estado: str
    ubicacion_referencia: str

    @strawberry.field
    def zona(self) -> ZonaParqueoType:
        return self.zona

    @strawberry.field
    def categoria(self) -> CategoriaEspacioType:
        return self.categoria


@strawberry.type
class SesionParqueoType:
    id: int
    hora_entrada: datetime
    hora_salida: Optional[datetime]
    estado: str

    @strawberry.field
    def espacio(self) -> EspacioParqueoType:
        return self.espacio

    @strawberry.field
    def placa_vehiculo(self) -> str:
        return self.vehiculo.placa

    @strawberry.field
    def duracion_minutos(self) -> Optional[int]:
        salida = self.hora_salida or timezone.now()
        return int((salida - self.hora_entrada).total_seconds() / 60)


@strawberry.type
class ReservaType:
    id: int
    fecha_inicio: datetime
    fecha_fin: datetime
    estado: str
    created_at: datetime

    @strawberry.field
    def espacio(self) -> EspacioParqueoType:
        return self.espacio

    @strawberry.field
    def placa_vehiculo(self) -> str:
        return self.vehiculo.placa


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

@strawberry.input
class CrearZonaInput:
    nombre: str
    descripcion: Optional[str] = ""
    ubicacion: Optional[str] = ""
    capacidad_total: int


@strawberry.input
class CrearEspacioInput:
    zona_id: int
    categoria_id: int
    numero: str
    ubicacion_referencia: Optional[str] = ""


@strawberry.input
class IniciarSesionInput:
    espacio_id: int
    vehiculo_id: int


@strawberry.input
class CrearReservaInput:
    espacio_id: int
    vehiculo_id: int
    fecha_inicio: str
    fecha_fin: str


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class ParqueosQuery:
    @strawberry.field
    def zonas(self, info: Info, solo_activas: bool = True) -> List[ZonaParqueoType]:
        qs = ZonaParqueo.objects.all()
        if solo_activas:
            qs = qs.filter(activo=True)
        return list(qs)

    @strawberry.field
    def espacios_por_zona(self, info: Info, zona_id: int, estado: Optional[str] = None) -> List[EspacioParqueoType]:
        qs = EspacioParqueo.objects.filter(zona_id=zona_id).select_related("zona", "categoria")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def espacios_disponibles(self, info: Info, zona_id: Optional[int] = None) -> List[EspacioParqueoType]:
        qs = EspacioParqueo.objects.filter(estado="disponible").select_related("zona", "categoria")
        if zona_id:
            qs = qs.filter(zona_id=zona_id)
        return list(qs)

    @strawberry.field
    def sesion_activa_vehiculo(self, info: Info, vehiculo_id: int) -> Optional[SesionParqueoType]:
        return SesionParqueo.objects.filter(
            vehiculo_id=vehiculo_id, estado="activa"
        ).select_related("espacio", "vehiculo").first()

    @strawberry.field
    def historial_sesiones(self, info: Info, vehiculo_id: int, limite: int = 20) -> List[SesionParqueoType]:
        return list(
            SesionParqueo.objects.filter(vehiculo_id=vehiculo_id).order_by("-hora_entrada")[:limite]
        )

    @strawberry.field
    def reservas_vehiculo(self, info: Info, vehiculo_id: int) -> List[ReservaType]:
        return list(
            Reserva.objects.filter(vehiculo_id=vehiculo_id)
            .select_related("espacio").order_by("-created_at")
        )

    @strawberry.field
    def categorias_espacio(self, info: Info) -> List[CategoriaEspacioType]:
        return list(CategoriaEspacio.objects.all())


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class ParqueosMutation:
    @strawberry.mutation
    def crear_zona(self, info: Info, input: CrearZonaInput) -> ZonaParqueoType:
        if ZonaParqueo.objects.filter(nombre=input.nombre).exists():
            raise Exception(f"Ya existe la zona '{input.nombre}'")
        return ZonaParqueo.objects.create(
            nombre=input.nombre,
            descripcion=input.descripcion or "",
            ubicacion=input.ubicacion or "",
            capacidad_total=input.capacidad_total,
        )

    @strawberry.mutation
    def crear_espacio(self, info: Info, input: CrearEspacioInput) -> EspacioParqueoType:
        zona = ZonaParqueo.objects.filter(pk=input.zona_id).first()
        categoria = CategoriaEspacio.objects.filter(pk=input.categoria_id).first()
        if not zona:
            raise Exception("Zona no encontrada")
        if not categoria:
            raise Exception("Categoría no encontrada")
        if EspacioParqueo.objects.filter(zona=zona, numero=input.numero).exists():
            raise Exception(f"Ya existe el espacio #{input.numero} en {zona.nombre}")
        return EspacioParqueo.objects.create(
            zona=zona, categoria=categoria, numero=input.numero,
            ubicacion_referencia=input.ubicacion_referencia or "",
        )

    @strawberry.mutation
    def iniciar_sesion_parqueo(self, info: Info, input: IniciarSesionInput) -> SesionParqueoType:
        from apps.vehiculos.models import Vehiculo
        espacio = EspacioParqueo.objects.filter(pk=input.espacio_id).first()
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not espacio:
            raise Exception("Espacio no encontrado")
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if espacio.estado != "disponible":
            raise Exception(f"El espacio #{espacio.numero} no está disponible")
        if SesionParqueo.objects.filter(vehiculo=vehiculo, estado="activa").exists():
            raise Exception("El vehículo ya tiene una sesión activa")
        sesion = SesionParqueo.objects.create(espacio=espacio, vehiculo=vehiculo)
        espacio.estado = "ocupado"
        espacio.save()
        return sesion

    @strawberry.mutation
    def cerrar_sesion_parqueo(self, info: Info, sesion_id: int) -> SesionParqueoType:
        sesion = SesionParqueo.objects.select_related("espacio").filter(
            pk=sesion_id, estado="activa"
        ).first()
        if not sesion:
            raise Exception("Sesión activa no encontrada")
        sesion.hora_salida = timezone.now()
        sesion.estado = "cerrada"
        sesion.save()
        sesion.espacio.estado = "disponible"
        sesion.espacio.save()
        return sesion

    @strawberry.mutation
    def crear_reserva(self, info: Info, input: CrearReservaInput) -> ReservaType:
        from datetime import datetime as dt
        from apps.vehiculos.models import Vehiculo
        espacio = EspacioParqueo.objects.filter(pk=input.espacio_id).first()
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not espacio:
            raise Exception("Espacio no encontrado")
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        tz = timezone.get_current_timezone()
        fecha_inicio = dt.fromisoformat(input.fecha_inicio).replace(tzinfo=tz)
        fecha_fin = dt.fromisoformat(input.fecha_fin).replace(tzinfo=tz)
        if fecha_fin <= fecha_inicio:
            raise Exception("La fecha de fin debe ser posterior a la de inicio")
        if Reserva.objects.filter(
            espacio=espacio, estado__in=["pendiente", "confirmada"],
            fecha_inicio__lt=fecha_fin, fecha_fin__gt=fecha_inicio,
        ).exists():
            raise Exception("El espacio ya tiene una reserva en ese horario")
        return Reserva.objects.create(
            espacio=espacio, vehiculo=vehiculo,
            fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        )

    @strawberry.mutation
    def cancelar_reserva(self, info: Info, reserva_id: int) -> ReservaType:
        reserva = Reserva.objects.filter(pk=reserva_id).first()
        if not reserva:
            raise Exception("Reserva no encontrada")
        if reserva.estado not in ["pendiente", "confirmada"]:
            raise Exception("Solo se pueden cancelar reservas pendientes o confirmadas")
        reserva.estado = "cancelada"
        reserva.save()
        return reserva
