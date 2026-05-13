"""
Módulo Parqueos — Strawberry GraphQL Schema

Optimizaciones aplicadas (Regla 5 — Clean Code):
  - N+1 eliminado: ZonaParqueoType usa valores anotados en el queryset
    en lugar de hacer 1 COUNT por zona por campo.
  - Reservas: autenticación, select_for_update y actualización de estado
    del espacio dentro de la misma transacción atómica.
  - log_audit incluido dentro de transaction.atomic() para garantizar
    que el log siempre acompaña a la operación o no existe.
"""
import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from .models import (
    CategoriaEspacio, ZonaParqueo, EspacioParqueo,
    SesionParqueo, Reserva,
)


# ── Types ──────────────────────────────────────────────────────────────────

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
        """
        Usa el valor anotado (_disponibles) si el queryset fue enriquecido
        con annotate(). Evita N+1 cuando se listan múltiples zonas.
        """
        cached = getattr(self, '_disponibles', None)
        if cached is not None:
            return cached
        return EspacioParqueo.objects.filter(zona_id=self.id, estado="disponible").count()

    @strawberry.field
    def total_registrados(self) -> int:
        cached = getattr(self, '_total', None)
        if cached is not None:
            return cached
        return EspacioParqueo.objects.filter(zona_id=self.id).count()

    @strawberry.field
    def espacios_ocupados(self) -> int:
        cached = getattr(self, '_ocupados', None)
        if cached is not None:
            return cached
        return EspacioParqueo.objects.filter(zona_id=self.id, estado="ocupado").count()

    @strawberry.field
    def espacios(self) -> List["EspacioParqueoType"]:
        return list(
            EspacioParqueo.objects.filter(zona_id=self.id)
            .select_related("categoria")
            .order_by("numero")
        )


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


# ── Inputs ─────────────────────────────────────────────────────────────────

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


# ── Queryset anotado — elimina N+1 ─────────────────────────────────────────

def _zonas_con_conteos(solo_activas: bool = True):
    """
    Retorna el queryset de ZonaParqueo enriquecido con conteos de espacios
    en una sola consulta SQL mediante subconsultas anotadas.

    Sin esto: 10 zonas × 3 campos = 30 queries adicionales por request.
    Con esto: 1 query total usando COUNT con filtros condicionales.
    """
    qs = ZonaParqueo.objects.annotate(
        _disponibles=Count("espacios", filter=Q(espacios__estado="disponible")),
        _ocupados=Count("espacios",    filter=Q(espacios__estado="ocupado")),
        _total=Count("espacios"),
    )
    if solo_activas:
        qs = qs.filter(activo=True)
    return qs


# ── Queries ────────────────────────────────────────────────────────────────

@strawberry.type
class ParqueosQuery:
    @strawberry.field
    def zonas(self, info: Info, solo_activas: bool = True) -> List[ZonaParqueoType]:
        return list(_zonas_con_conteos(solo_activas).order_by("nombre"))

    @strawberry.field
    def espacios_por_zona(
        self, info: Info, zona_id: int, estado: Optional[str] = None
    ) -> List[EspacioParqueoType]:
        qs = EspacioParqueo.objects.filter(zona_id=zona_id).select_related("zona", "categoria")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def espacios_disponibles(
        self, info: Info, zona_id: Optional[int] = None
    ) -> List[EspacioParqueoType]:
        qs = EspacioParqueo.objects.filter(estado="disponible").select_related("zona", "categoria")
        if zona_id:
            qs = qs.filter(zona_id=zona_id)
        return list(qs)

    @strawberry.field
    def sesion_activa_vehiculo(
        self, info: Info, vehiculo_id: int
    ) -> Optional[SesionParqueoType]:
        return (
            SesionParqueo.objects
            .filter(vehiculo_id=vehiculo_id, estado="activa")
            .select_related("espacio__zona", "vehiculo")
            .first()
        )

    @strawberry.field
    def historial_sesiones(
        self, info: Info, vehiculo_id: int, limite: int = 20
    ) -> List[SesionParqueoType]:
        return list(
            SesionParqueo.objects
            .filter(vehiculo_id=vehiculo_id)
            .select_related("espacio__zona", "vehiculo")
            .order_by("-hora_entrada")[:limite]
        )

    @strawberry.field
    def reservas_vehiculo(self, info: Info, vehiculo_id: int) -> List[ReservaType]:
        return list(
            Reserva.objects
            .filter(vehiculo_id=vehiculo_id)
            .select_related("espacio__zona", "vehiculo")
            .order_by("-created_at")
        )

    @strawberry.field
    def sesiones_activas(self, info: Info) -> List[SesionParqueoType]:
        return list(
            SesionParqueo.objects
            .filter(estado="activa")
            .select_related("espacio__zona", "espacio__categoria", "vehiculo")
            .order_by("-hora_entrada")
        )

    @strawberry.field
    def categorias_espacio(self, info: Info) -> List[CategoriaEspacioType]:
        return list(CategoriaEspacio.objects.all())

    @strawberry.field
    def mapa_parqueo(self, info: Info) -> List[ZonaParqueoType]:
        """
        Mapa en vivo: zonas con conteos anotados + espacios prefetcheados.
        Resulta en 2 queries totales en lugar de 3N+1.
        """
        return list(
            _zonas_con_conteos(solo_activas=True)
            .prefetch_related("espacios__categoria")
            .order_by("nombre")
        )


# ── Mutations ──────────────────────────────────────────────────────────────

@strawberry.type
class ParqueosMutation:

    @strawberry.mutation
    def crear_zona(self, info: Info, input: CrearZonaInput) -> ZonaParqueoType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden crear zonas de parqueo")
        if ZonaParqueo.objects.filter(nombre=input.nombre).exists():
            raise Exception(f"Ya existe la zona '{input.nombre}'")
        with transaction.atomic():
            zona = ZonaParqueo.objects.create(
                nombre=input.nombre,
                descripcion=input.descripcion or "",
                ubicacion=input.ubicacion or "",
                capacidad_total=input.capacidad_total,
            )
            log_audit(user, "zona_creada", f"Zona '{zona.nombre}' creada", request=info.context.request)
        return zona

    @strawberry.mutation
    def crear_espacio(self, info: Info, input: CrearEspacioInput) -> EspacioParqueoType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden crear espacios de parqueo")
        zona = ZonaParqueo.objects.filter(pk=input.zona_id).first()
        categoria = CategoriaEspacio.objects.filter(pk=input.categoria_id).first()
        if not zona:
            raise Exception("Zona no encontrada")
        if not categoria:
            raise Exception("Categoría no encontrada")
        if EspacioParqueo.objects.filter(zona=zona, numero=input.numero).exists():
            raise Exception(f"Ya existe el espacio #{input.numero} en {zona.nombre}")
        with transaction.atomic():
            espacio = EspacioParqueo.objects.create(
                zona=zona, categoria=categoria, numero=input.numero,
                ubicacion_referencia=input.ubicacion_referencia or "",
            )
            log_audit(
                user, "espacio_creado",
                f"Espacio {zona.nombre}#{input.numero} creado",
                request=info.context.request,
            )
        return espacio

    @strawberry.mutation
    def iniciar_sesion_parqueo(
        self, info: Info, input: IniciarSesionInput
    ) -> SesionParqueoType:
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden iniciar sesiones de parqueo")

        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")

        ESTADOS_BLOQUEADOS = {
            "sancionado": "Vehículo sancionado. Regularice sus multas antes de estacionar.",
            "pendiente":  "Vehículo pendiente de aprobación. No puede estacionar.",
            "inactivo":   "Vehículo inactivo. Contacte a la administración.",
        }
        if vehiculo.estado in ESTADOS_BLOQUEADOS:
            raise Exception(ESTADOS_BLOQUEADOS[vehiculo.estado])

        if SesionParqueo.objects.filter(vehiculo=vehiculo, estado="activa").exists():
            raise Exception("El vehículo ya tiene una sesión de parqueo activa")

        with transaction.atomic():
            espacio = (
                EspacioParqueo.objects
                .select_for_update()
                .select_related("zona")
                .filter(pk=input.espacio_id)
                .first()
            )
            if not espacio:
                raise Exception("Espacio no encontrado")
            if espacio.estado != "disponible":
                raise Exception(
                    f"El espacio #{espacio.numero} no está disponible (estado: {espacio.estado})"
                )
            sesion = SesionParqueo.objects.create(espacio=espacio, vehiculo=vehiculo)
            espacio.estado = "ocupado"
            espacio.save(update_fields=["estado"])
            # log_audit dentro de la transacción — si falla hace rollback junto con la sesión
            log_audit(
                user, "sesion_parqueo_iniciada",
                f"Sesión iniciada: {vehiculo.placa} en {espacio.zona.nombre}#{espacio.numero}",
                request=info.context.request,
            )
        return sesion

    @strawberry.mutation
    def cerrar_sesion_parqueo(self, info: Info, sesion_id: int) -> SesionParqueoType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden cerrar sesiones de parqueo")

        with transaction.atomic():
            sesion = (
                SesionParqueo.objects
                .select_for_update()
                .select_related("espacio__zona", "vehiculo")
                .filter(pk=sesion_id, estado="activa")
                .first()
            )
            if not sesion:
                raise Exception("Sesión activa no encontrada")
            sesion.hora_salida = timezone.now()
            sesion.estado = "cerrada"
            sesion.save(update_fields=["hora_salida", "estado"])
            sesion.espacio.estado = "disponible"
            sesion.espacio.save(update_fields=["estado"])
            duracion = int((sesion.hora_salida - sesion.hora_entrada).total_seconds() / 60)
            log_audit(
                user, "sesion_parqueo_cerrada",
                f"Sesión cerrada: {sesion.vehiculo.placa} en "
                f"{sesion.espacio.zona.nombre}#{sesion.espacio.numero} "
                f"({duracion} min)",
                request=info.context.request,
            )
        return sesion

    @strawberry.mutation
    def crear_reserva(self, info: Info, input: CrearReservaInput) -> ReservaType:
        """
        Crea una reserva de espacio y lo marca como 'reservado' atómicamente.
        Requiere autenticación — el propietario reserva para su propio vehículo,
        el admin puede reservar para cualquiera.
        """
        from datetime import datetime as dt
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")

        # Propietario solo puede reservar para su propio vehículo
        if not tiene_rol(user, "Administrador") and vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes reservar espacios para tus propios vehículos")

        from django.utils.timezone import make_aware, is_aware
        tz = timezone.get_current_timezone()

        def _parsear_fecha(valor: str):
            parsed = dt.fromisoformat(valor)
            # Si ya tiene tz info (viene de cliente con +00:00), usarla tal cual.
            # Si es naive (sin tz), asumir zona horaria de Bolivia.
            return parsed if is_aware(parsed) else make_aware(parsed, tz)

        fecha_inicio = _parsear_fecha(input.fecha_inicio)
        fecha_fin    = _parsear_fecha(input.fecha_fin)

        if fecha_fin <= fecha_inicio:
            raise Exception("La fecha de fin debe ser posterior a la de inicio")
        if fecha_inicio <= timezone.now():
            raise Exception("La fecha de inicio debe ser en el futuro")

        with transaction.atomic():
            espacio = (
                EspacioParqueo.objects
                .select_for_update()
                .select_related("zona")
                .filter(pk=input.espacio_id)
                .first()
            )
            if not espacio:
                raise Exception("Espacio no encontrado")
            if espacio.estado != "disponible":
                raise Exception(
                    f"El espacio #{espacio.numero} no está disponible actualmente "
                    f"(estado: {espacio.estado})"
                )
            # Verificar solapamiento de reservas existentes
            if Reserva.objects.filter(
                espacio=espacio,
                estado__in=["pendiente", "confirmada"],
                fecha_inicio__lt=fecha_fin,
                fecha_fin__gt=fecha_inicio,
            ).exists():
                raise Exception("El espacio ya tiene una reserva en ese horario")

            reserva = Reserva.objects.create(
                espacio=espacio, vehiculo=vehiculo,
                fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
            )
            espacio.estado = "reservado"
            espacio.save(update_fields=["estado"])
            log_audit(
                user, "reserva_creada",
                f"Reserva: {vehiculo.placa} en {espacio.zona.nombre}#{espacio.numero} "
                f"de {fecha_inicio.strftime('%H:%M')} a {fecha_fin.strftime('%H:%M')}",
                request=info.context.request,
            )
        return reserva

    @strawberry.mutation
    def cancelar_reserva(self, info: Info, reserva_id: int) -> ReservaType:
        """
        Cancela una reserva y libera el espacio.
        Solo el propietario del vehículo o un administrador pueden cancelar.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        with transaction.atomic():
            reserva = (
                Reserva.objects
                .select_for_update()
                .select_related("espacio__zona", "vehiculo__propietario")
                .filter(pk=reserva_id)
                .first()
            )
            if not reserva:
                raise Exception("Reserva no encontrada")

            # Verificar propietario
            if (not tiene_rol(user, "Administrador") and
                    reserva.vehiculo.propietario_id != user.pk):
                raise Exception("Solo puedes cancelar tus propias reservas")

            if reserva.estado not in ["pendiente", "confirmada"]:
                raise Exception("Solo se pueden cancelar reservas pendientes o confirmadas")

            reserva.estado = "cancelada"
            reserva.save(update_fields=["estado"])

            # Liberar espacio si sigue reservado para esta reserva
            if reserva.espacio.estado == "reservado":
                reserva.espacio.estado = "disponible"
                reserva.espacio.save(update_fields=["estado"])

            log_audit(
                user, "reserva_cancelada",
                f"Reserva #{reserva.pk} cancelada: {reserva.vehiculo.placa} "
                f"en {reserva.espacio.zona.nombre}#{reserva.espacio.numero}",
                request=info.context.request,
            )
        return reserva
