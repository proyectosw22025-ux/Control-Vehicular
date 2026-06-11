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
    SesionParqueo,
)


# ── Helpers de autorización ────────────────────────────────────────────────

def _usuario_autenticado(info: Info):
    """Retorna el usuario autenticado o lanza error. Para queries con datos sensibles."""
    user = info.context.request.user
    if not user.is_authenticated:
        raise Exception("Autenticación requerida")
    return user


def _es_personal(user) -> bool:
    """Guardia o Administrador — pueden ver datos de cualquier vehículo."""
    from apps.usuarios.utils import tiene_rol
    return tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")


def _verificar_acceso_vehiculo(user, vehiculo_id: int):
    """
    El propietario solo puede consultar sus propios vehículos;
    Guardia/Admin pueden consultar cualquiera. Protege placas, ubicación
    física y patrones de movimiento de exposición a terceros.
    """
    if _es_personal(user):
        return
    from apps.vehiculos.models import Vehiculo
    if not Vehiculo.objects.filter(pk=vehiculo_id, propietario_id=user.pk).exists():
        raise Exception("Solo puedes consultar información de tus propios vehículos")


# Categorías de espacio que exigen que el propietario tenga el rol homónimo.
CATEGORIAS_CON_ROL = {"Docente", "Estudiante", "Personal Administrativo"}


def _motivo_incompatibilidad_categoria(espacio, vehiculo) -> Optional[str]:
    """
    Valida la categoría del espacio contra el rol del propietario del vehículo.
    Retorna el motivo del rechazo, o None si la asignación es compatible.
    Espacios de discapacidad siempre requieren confirmación del guardia
    (no existe registro de permiso de discapacidad en el sistema).
    """
    from apps.usuarios.utils import tiene_rol
    categoria = espacio.categoria
    if categoria.es_discapacidad:
        return (
            f"El espacio #{espacio.numero} está reservado para personas con "
            "discapacidad y requiere verificación del permiso."
        )
    if categoria.nombre in CATEGORIAS_CON_ROL and not tiene_rol(vehiculo.propietario, categoria.nombre):
        return (
            f"El espacio #{espacio.numero} es de categoría '{categoria.nombre}' "
            f"y el propietario de {vehiculo.placa} no tiene ese rol."
        )
    return None


# ── Disponibilidad real — lógica de negocio ────────────────────────────────

def _calcular_estado(libres: int, total_util: int) -> str:
    """
    Estado de disponibilidad según porcentaje libre.
    total_util = capacidad total menos espacios en mantenimiento/reservado.
    """
    if total_util <= 0:
        return "sin_datos"
    if libres == 0:
        return "lleno"
    pct = libres / total_util
    if pct <= 0.10:
        return "saturado"    # < 10% libre
    if pct <= 0.40:
        return "limitado"    # 10-40% libre
    return "disponible"      # > 40% libre


def _color_estado(estado: str) -> str:
    return {
        "disponible": "#22c55e",
        "limitado":   "#f59e0b",
        "saturado":   "#f97316",
        "lleno":      "#ef4444",
        "sin_datos":  "#94a3b8",
    }.get(estado, "#94a3b8")


def _disponibilidad_de_zona(zona) -> dict:
    """
    Calcula disponibilidad real para una zona. Reutilizable desde signal y query.
    La capacidad se deriva de los espacios REALMENTE registrados (única fuente
    de verdad) — `capacidad_total` declarada a mano queda solo como referencia
    de planificación y nunca entra al cálculo.
    """
    from django.db.models import Count, Q
    z = (
        ZonaParqueo.objects.filter(pk=zona.pk).annotate(
            _libres=Count("espacios", filter=Q(espacios__estado="disponible")),
            _mantenimiento=Count("espacios", filter=Q(espacios__estado="mantenimiento")),
            _reservados=Count("espacios", filter=Q(espacios__estado="reservado")),
            _espacios_reales=Count("espacios"),
        ).first()
    )
    if not z:
        return {}
    total_util = max(z._espacios_reales - z._mantenimiento - z._reservados, 0)
    libres = z._libres
    sesiones = SesionParqueo.objects.filter(espacio__zona=z, estado="activa").count()
    pct = round((libres / total_util * 100) if total_util > 0 else 0, 1)
    estado = _calcular_estado(libres, total_util)
    return {
        "zona_id":        z.pk,
        "zona_nombre":    z.nombre,
        "libres":         libres,
        "total":          z._espacios_reales,
        "sesiones_activas": sesiones,
        "en_mantenimiento": z._mantenimiento,
        "porcentaje_libre": pct,
        "estado":         estado,
        "color_estado":   _color_estado(estado),
    }


CACHE_KEY_DISPONIBILIDAD = "parqueo_disponibilidad_zonas_v1"
CACHE_TTL_SEGUNDOS = 30


def broadcast_disponibilidad(zona_id: int):
    """
    Envía disponibilidad actualizada al grupo parqueo_disponibilidad.
    También invalida el cache Redis para que el próximo request lo recalcule.
    Llamado desde mutaciones de sesión.
    """
    try:
        # Invalidar cache para que el semáforo público muestre datos frescos
        from django.core.cache import cache
        cache.delete(CACHE_KEY_DISPONIBILIDAD)

        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        zona = ZonaParqueo.objects.filter(pk=zona_id).first()
        if not zona:
            return
        data = _disponibilidad_de_zona(zona)
        if not data:
            return
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)("parqueo_disponibilidad", {
                "type": "disponibilidad_actualizada",
                **data,
            })
    except Exception:
        pass  # No debe interrumpir el flujo de negocio principal


# ── Types ──────────────────────────────────────────────────────────────────

@strawberry.type
class DisponibilidadZonaType:
    """
    Disponibilidad real de una zona de parqueo.
    Calculada desde EspacioParqueo.estado y SesionParqueo activas.
    No requiere autenticación — usada en la guía y en la página pública.
    """
    id:               int
    nombre:           str
    descripcion:      str
    ubicacion:        str
    capacidad_total:  int
    libres:           int     # espacios con estado='disponible'
    sesiones_activas: int     # SesionParqueo con estado='activa'
    en_mantenimiento: int     # espacios fuera de servicio (no cuentan como libres)
    porcentaje_libre: float   # 0.0–100.0
    estado:           str     # disponible | limitado | saturado | lleno | sin_datos
    color_estado:     str     # hex color para la UI
    ultima_actualizacion: str = ""  # ISO timestamp de cuando se calcularon los datos


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
        # Si hay prefetch en caché (llamado desde mapa_parqueo), reutilizarlo
        # para evitar N+1 — la placa_vehiculo_activo ya estará anotada.
        cache = getattr(self, "_prefetched_objects_cache", {})
        if "espacios" in cache:
            return sorted(self.espacios.all(), key=lambda e: e.numero)
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

    @strawberry.field
    def placa_vehiculo_activo(self) -> Optional[str]:
        """
        Placa del vehículo que ocupa este espacio ahora mismo.
        Si fue anotado por mapa_parqueo() usa el atributo transitorio _placa_activa.
        Si no (ej. llamado desde espacios_por_zona), hace una query directa.
        hasattr (no `is not None`): un espacio libre anotado con None NO debe
        disparar la query de fallback — eso reintroduce el N+1 silenciosamente.
        """
        if hasattr(self, "_placa_activa"):
            return self._placa_activa
        sesion = SesionParqueo.objects.filter(espacio_id=self.pk, estado="activa").first()
        return sesion.vehiculo.placa if sesion else None

    @strawberry.field
    def sesion_activa_id(self) -> Optional[int]:
        """ID de la sesión activa para cerrarla desde el mapa o la vista de espacios."""
        if hasattr(self, "_sesion_activa_id"):
            return self._sesion_activa_id
        sesion = SesionParqueo.objects.filter(espacio_id=self.pk, estado="activa").first()
        return sesion.pk if sesion else None


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
    # Guardia/Admin pueden asignar un espacio cuya categoría no coincide con el
    # rol del propietario, pero deben confirmarlo explícitamente (queda auditado).
    permitir_categoria_incompatible: Optional[bool] = False


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
        _usuario_autenticado(info)
        return list(_zonas_con_conteos(solo_activas).order_by("nombre"))

    @strawberry.field
    def espacios_por_zona(
        self, info: Info, zona_id: int, estado: Optional[str] = None
    ) -> List[EspacioParqueoType]:
        _usuario_autenticado(info)
        qs = EspacioParqueo.objects.filter(zona_id=zona_id).select_related("zona", "categoria")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def espacios_disponibles(
        self, info: Info, zona_id: Optional[int] = None
    ) -> List[EspacioParqueoType]:
        _usuario_autenticado(info)
        qs = EspacioParqueo.objects.filter(estado="disponible").select_related("zona", "categoria")
        if zona_id:
            qs = qs.filter(zona_id=zona_id)
        return list(qs)

    @strawberry.field
    def sesion_activa_vehiculo(
        self, info: Info, vehiculo_id: int
    ) -> Optional[SesionParqueoType]:
        user = _usuario_autenticado(info)
        _verificar_acceso_vehiculo(user, vehiculo_id)
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
        user = _usuario_autenticado(info)
        _verificar_acceso_vehiculo(user, vehiculo_id)
        return list(
            SesionParqueo.objects
            .filter(vehiculo_id=vehiculo_id)
            .select_related("espacio__zona", "vehiculo")
            .order_by("-hora_entrada")[:limite]
        )

    @strawberry.field
    def sesiones_activas(self, info: Info) -> List[SesionParqueoType]:
        # Vista operativa global (todas las placas y ubicaciones) — solo personal.
        user = _usuario_autenticado(info)
        if not _es_personal(user):
            raise Exception("Solo guardias y administradores pueden ver las sesiones activas")
        return list(
            SesionParqueo.objects
            .filter(estado="activa")
            .select_related("espacio__zona", "espacio__categoria", "vehiculo")
            .order_by("-hora_entrada")
        )

    @strawberry.field
    def disponibilidad_zonas(self, info: Info) -> List[DisponibilidadZonaType]:
        """
        Disponibilidad real por zona — SIN autenticación requerida.
        Cache: 30 segundos en Redis (producción) o LocMem (desarrollo).
        Se invalida automáticamente cuando se abre/cierra una sesión de parqueo.
        Reglas:
          - Espacios en 'mantenimiento' o 'reservado' NO cuentan como libres.
          - Al llegar a 0 libres: estado='lleno'.
        """
        from django.core.cache import cache
        from django.utils import timezone as tz

        cached = cache.get(CACHE_KEY_DISPONIBILIDAD)
        if cached is not None:
            return cached

        zonas = ZonaParqueo.objects.filter(activo=True).annotate(
            _libres=Count("espacios", filter=Q(espacios__estado="disponible")),
            _mantenimiento=Count("espacios", filter=Q(espacios__estado="mantenimiento")),
            _reservados=Count("espacios", filter=Q(espacios__estado="reservado")),
            _espacios_reales=Count("espacios"),
        ).order_by("nombre")

        sesiones_por_zona: dict[int, int] = {}
        for row in (
            SesionParqueo.objects.filter(estado="activa")
            .values("espacio__zona_id")
            .annotate(total=Count("id"))
        ):
            sesiones_por_zona[row["espacio__zona_id"]] = row["total"]

        ahora_iso = tz.now().isoformat()
        result = []
        for z in zonas:
            # Capacidad = espacios realmente registrados, no el número declarado a
            # mano en la zona. Evita porcentajes fantasma cuando difieren.
            total_util = max(z._espacios_reales - z._mantenimiento - z._reservados, 0)
            libres     = z._libres
            sesiones   = sesiones_por_zona.get(z.pk, 0)
            pct        = round((libres / total_util * 100) if total_util > 0 else 0.0, 1)
            estado     = _calcular_estado(libres, total_util)
            result.append(DisponibilidadZonaType(
                id                   = z.pk,
                nombre               = z.nombre,
                descripcion          = z.descripcion,
                ubicacion            = z.ubicacion,
                capacidad_total      = z._espacios_reales,
                libres               = libres,
                sesiones_activas     = sesiones,
                en_mantenimiento     = z._mantenimiento,
                porcentaje_libre     = pct,
                estado               = estado,
                color_estado         = _color_estado(estado),
                ultima_actualizacion = ahora_iso,
            ))

        cache.set(CACHE_KEY_DISPONIBILIDAD, result, CACHE_TTL_SEGUNDOS)
        return result

    @strawberry.field
    def categorias_espacio(self, info: Info) -> List[CategoriaEspacioType]:
        _usuario_autenticado(info)
        return list(CategoriaEspacio.objects.all())

    @strawberry.field
    def mapa_parqueo(self, info: Info) -> List[ZonaParqueoType]:
        """
        Mapa en vivo: 3 queries totales independientemente del número de zonas/espacios.
          Q1: zonas con conteos anotados (COUNT en SQL)
          Q2: prefetch de espacios + categorías
          Q3: placas de sesiones activas (dict espacio_id → placa)
        La placa se anota como atributo transitorio (_placa_activa) en cada espacio
        para que EspacioParqueoType.placa_vehiculo_activo() la devuelva sin queries extra.

        Requiere autenticación: expone placas y ubicación física en tiempo real.
        (La vista pública sin login es disponibilidad_zonas — solo agregados.)
        """
        _usuario_autenticado(info)
        # Q3: una sola query para todas las sesiones activas (placa + id de sesión)
        sesiones_activas: dict[int, tuple[int, str]] = {
            row["espacio_id"]: (row["id"], row["vehiculo__placa"])
            for row in SesionParqueo.objects.filter(estado="activa")
            .values("id", "espacio_id", "vehiculo__placa")
        }

        zonas = list(
            _zonas_con_conteos(solo_activas=True)
            .prefetch_related("espacios__categoria")
            .order_by("nombre")
        )

        # Anotar cada espacio prefetcheado con su sesión activa (O(1) lookup).
        # Se anota SIEMPRE (None para espacios libres) — los resolvers usan
        # hasattr, así que ningún espacio dispara queries extra.
        for zona in zonas:
            for espacio in zona.espacios.all():
                sesion_id, placa = sesiones_activas.get(espacio.id, (None, None))
                espacio._placa_activa = placa
                espacio._sesion_activa_id = sesion_id

        return zonas


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

        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")

        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        # El propietario puede registrar SOLO su propio vehículo.
        # Admin y Guardia pueden registrar cualquier vehículo.
        if not es_personal and vehiculo.propietario_id != user.pk:
            raise Exception(
                "Solo puedes iniciar una sesión de parqueo para tu propio vehículo. "
                "Si necesitas ayuda, solicítala al guardia de turno."
            )

        ESTADOS_BLOQUEADOS = {
            "sancionado": "Vehículo sancionado. Regularice sus sanciones pendientes antes de estacionar.",
            "pendiente":  "Vehículo pendiente de aprobación. No puede estacionar.",
            "inactivo":   "Vehículo inactivo. Contacte a la administración.",
        }
        if vehiculo.estado in ESTADOS_BLOQUEADOS:
            raise Exception(ESTADOS_BLOQUEADOS[vehiculo.estado])

        # ── Coherencia con control de acceso ─────────────────────────────────
        # Solo puede ocupar un espacio un vehículo que está físicamente dentro
        # del campus: su último registro de acceso debe ser una ENTRADA.
        # Sin esto, el parqueo y el portón viven en mundos separados (se podía
        # "estacionar" un vehículo que jamás ingresó, o que ya salió).
        from apps.acceso.models import RegistroAcceso
        ultimo_acceso = (
            RegistroAcceso.objects
            .filter(vehiculo=vehiculo)
            .order_by("-timestamp", "-pk")  # -pk desempata timestamps idénticos
            .values("tipo")
            .first()
        )
        if not ultimo_acceso or ultimo_acceso["tipo"] != "entrada":
            raise Exception(
                f"El vehículo {vehiculo.placa} no registra ingreso al campus. "
                "Registre su entrada en el control de acceso antes de asignar un espacio de parqueo."
            )

        from django.db import IntegrityError

        try:
            with transaction.atomic():
                espacio = (
                    EspacioParqueo.objects
                    .select_for_update()
                    .select_related("zona", "categoria")
                    .filter(pk=input.espacio_id)
                    .first()
                )
                if not espacio:
                    raise Exception("Espacio no encontrado")
                if espacio.estado != "disponible":
                    raise Exception(
                        f"El espacio #{espacio.numero} no está disponible (estado: {espacio.estado})"
                    )

                # Check dentro de la transacción: dos requests simultáneos del mismo
                # vehículo no pueden colarse entre la validación y el INSERT.
                if SesionParqueo.objects.filter(vehiculo=vehiculo, estado="activa").exists():
                    raise Exception("El vehículo ya tiene una sesión de parqueo activa")

                # ── Regla de negocio: categoría del espacio vs rol del propietario ──
                # Espacios Docente/Estudiante/Personal Administrativo exigen el rol
                # correspondiente; espacios de discapacidad exigen siempre confirmación.
                # Guardia/Admin pueden forzar la asignación con el flag explícito.
                override_usado = False
                incompatibilidad = _motivo_incompatibilidad_categoria(espacio, vehiculo)
                if incompatibilidad:
                    if es_personal and input.permitir_categoria_incompatible:
                        override_usado = True
                    else:
                        raise Exception(
                            f"{incompatibilidad} "
                            "Un guardia o administrador puede autorizar la excepción."
                        )

                sesion = SesionParqueo.objects.create(espacio=espacio, vehiculo=vehiculo)
                espacio.estado = "ocupado"
                espacio.save(update_fields=["estado"])
                # log_audit dentro de la transacción — si falla hace rollback junto con la sesión
                detalle_override = (
                    f" [categoría '{espacio.categoria.nombre}' autorizada como excepción]"
                    if override_usado else ""
                )
                log_audit(
                    user, "sesion_parqueo_iniciada",
                    f"Sesión iniciada: {vehiculo.placa} en {espacio.zona.nombre}#{espacio.numero}"
                    f"{detalle_override}",
                    request=info.context.request,
                )
        except IntegrityError:
            # Constraint único parcial de la BD — último escudo ante concurrencia.
            raise Exception(
                "El vehículo ya tiene una sesión activa o el espacio acaba de ser ocupado"
            )
        broadcast_disponibilidad(espacio.zona_id)
        return sesion

    @strawberry.mutation
    def cerrar_sesion_parqueo(self, info: Info, sesion_id: int) -> SesionParqueoType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        with transaction.atomic():
            sesion = (
                SesionParqueo.objects
                .select_for_update()
                .select_related("espacio__zona", "vehiculo__propietario")
                .filter(pk=sesion_id, estado="activa")
                .first()
            )
            if not sesion:
                raise Exception("Sesión activa no encontrada")

            # Admin/Guardia pueden cerrar cualquier sesión.
            # El propietario solo puede cerrar la sesión de su propio vehículo.
            es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
            if not es_personal and sesion.vehiculo.propietario_id != user.pk:
                raise Exception("Solo puedes cerrar la sesión de parqueo de tu propio vehículo.")
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
        broadcast_disponibilidad(sesion.espacio.zona_id)
        return sesion

