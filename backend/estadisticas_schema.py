"""
Estadísticas y reportes — Schema GraphQL

Optimizaciones N+1 aplicadas:
  - reporte_accesos: 1 query con TruncDate+annotate en vez de 2N queries (antes: 60 para 30 días)
  - accesos_ultima_semana: 1 query en vez de 14
  - reporte_multas_por_tipo: 1 query con Count(filter=Q()) en vez de 5×N queries
  - reporte_ocupacion_zonas: 1 query con annotate en vez de 5×zonas queries
  - dashboard_stats: aggregate combinado para reducir queries a BD
"""
import strawberry
from strawberry.types import Info
from typing import List
from django.utils import timezone
from datetime import timedelta
from django.db.models import Sum, Count, Q
from django.db.models.functions import TruncDate


# ── Tipos para Dashboard ───────────────────────────────────

@strawberry.type
class DashboardStatsType:
    total_vehiculos: int
    vehiculos_activos_hoy: int
    espacios_disponibles: int
    total_espacios: int
    multas_pendientes: int
    monto_multas_pendientes: float
    visitantes_activos: int
    accesos_hoy: int
    total_usuarios: int
    apelaciones_pendientes: int


@strawberry.type
class AccesosDiaType:
    fecha: str
    entradas: int
    salidas: int


# ── Tipos para Reportes ────────────────────────────────────

@strawberry.type
class ReporteAccesosDiaType:
    fecha: str
    fecha_iso: str
    entradas: int
    salidas: int
    total: int


@strawberry.type
class ReporteMultaTipoType:
    tipo_nombre: str
    cantidad: int
    monto_total: float
    pagadas: int
    pendientes: int
    apeladas: int


@strawberry.type
class ReporteZonaOcupacionType:
    zona_nombre: str
    ubicacion: str
    total_espacios: int
    disponibles: int
    ocupados: int
    reservados: int
    mantenimiento: int
    porcentaje_ocupacion: float


@strawberry.type
class ReporteVehiculoGrupoType:
    nombre: str
    cantidad: int


@strawberry.type
class ReporteResumenMultasType:
    total_multas: int
    monto_total_recaudado: float
    monto_total_pendiente: float
    pagadas: int
    pendientes: int
    apeladas: int
    canceladas: int


# ── Helpers ────────────────────────────────────────────────

def _accesos_por_rango(fecha_inicio, fecha_fin):
    """
    1 query para toda la serie temporal de accesos.
    Antes: 2 queries × N días = hasta 180 queries para 90 días.
    Ahora: 1 query con TruncDate + annotate.
    """
    from apps.acceso.models import RegistroAcceso
    tz = timezone.get_current_timezone()

    raw = (
        RegistroAcceso.objects
        .filter(timestamp__date__gte=fecha_inicio, timestamp__date__lte=fecha_fin)
        .annotate(dia=TruncDate("timestamp", tzinfo=tz))
        .values("dia", "tipo")
        .annotate(total=Count("id"))
    )
    por_dia: dict[object, dict] = {}
    for r in raw:
        dia = r["dia"]
        if dia not in por_dia:
            por_dia[dia] = {"entradas": 0, "salidas": 0}
        if r["tipo"] == "entrada":
            por_dia[dia]["entradas"] = r["total"]
        else:
            por_dia[dia]["salidas"] = r["total"]
    return por_dia


# ── Query ──────────────────────────────────────────────────

@strawberry.type
class EstadisticasQuery:

    # ── Dashboard ──────────────────────────────────────────

    @strawberry.field
    def dashboard_stats(self, info: Info) -> DashboardStatsType:
        from apps.vehiculos.models import Vehiculo
        from apps.parqueos.models import EspacioParqueo
        from apps.multas.models import Multa, ApelacionMulta
        from apps.visitantes.models import Visita
        from apps.acceso.models import RegistroAcceso
        from apps.usuarios.models import Usuario

        hoy = timezone.now().date()

        # Combina accesos hoy en 1 sola query con aggregate
        accesos_stats = RegistroAcceso.objects.filter(
            timestamp__date=hoy
        ).aggregate(
            total=Count("id"),
            vehiculos_distintos=Count("vehiculo", distinct=True, filter=Q(tipo="entrada")),
        )

        # Espacios: 2 counts optimizados con aggregate
        espacios_stats = EspacioParqueo.objects.aggregate(
            total=Count("id"),
            disponibles=Count("id", filter=Q(estado="disponible")),
        )

        # Multas: 1 aggregate para count + sum
        multas_stats = Multa.objects.filter(estado="pendiente").aggregate(
            count=Count("id"),
            monto=Sum("monto"),
        )

        return DashboardStatsType(
            total_vehiculos=Vehiculo.objects.filter(estado="activo").count(),
            vehiculos_activos_hoy=accesos_stats["vehiculos_distintos"] or 0,
            espacios_disponibles=espacios_stats["disponibles"] or 0,
            total_espacios=espacios_stats["total"] or 0,
            multas_pendientes=multas_stats["count"] or 0,
            monto_multas_pendientes=float(multas_stats["monto"] or 0),
            visitantes_activos=Visita.objects.filter(estado="activa").count(),
            accesos_hoy=accesos_stats["total"] or 0,
            total_usuarios=Usuario.objects.filter(is_active=True).count(),
            apelaciones_pendientes=ApelacionMulta.objects.filter(estado="pendiente").count(),
        )

    @strawberry.field
    def accesos_ultima_semana(self, info: Info) -> List[AccesosDiaType]:
        """
        1 query total (antes: 14).
        TruncDate agrupa por día; iteramos el rango y buscamos en el dict.
        """
        hoy = timezone.now().date()
        inicio = hoy - timedelta(days=6)
        por_dia = _accesos_por_rango(inicio, hoy)

        return [
            AccesosDiaType(
                fecha=((hoy - timedelta(days=i)).strftime("%d/%m")),
                entradas=por_dia.get(hoy - timedelta(days=i), {}).get("entradas", 0),
                salidas =por_dia.get(hoy - timedelta(days=i), {}).get("salidas",  0),
            )
            for i in range(6, -1, -1)
        ]

    # ── Reportes ───────────────────────────────────────────

    @strawberry.field
    def reporte_accesos(self, info: Info, dias: int = 30) -> List[ReporteAccesosDiaType]:
        """
        1 query total (antes: 2×N — hasta 180 para 90 días).
        """
        dias = min(max(dias, 1), 90)
        hoy  = timezone.now().date()
        inicio = hoy - timedelta(days=dias - 1)
        por_dia = _accesos_por_rango(inicio, hoy)

        resultado = []
        for i in range(dias - 1, -1, -1):
            fecha = hoy - timedelta(days=i)
            d = por_dia.get(fecha, {})
            entradas = d.get("entradas", 0)
            salidas  = d.get("salidas", 0)
            resultado.append(ReporteAccesosDiaType(
                fecha     = fecha.strftime("%d/%m"),
                fecha_iso = fecha.isoformat(),
                entradas  = entradas,
                salidas   = salidas,
                total     = entradas + salidas,
            ))
        return resultado

    @strawberry.field
    def reporte_multas_por_tipo(self, info: Info) -> List[ReporteMultaTipoType]:
        """
        1 query con Count(filter=Q(...)) (antes: 5 queries × N tipos — 35 para 7 tipos).
        """
        from apps.multas.models import TipoMulta

        tipos = TipoMulta.objects.annotate(
            cantidad   = Count("multas"),
            monto_total= Sum("multas__monto"),
            pagadas    = Count("multas", filter=Q(multas__estado="pagada")),
            pendientes = Count("multas", filter=Q(multas__estado="pendiente")),
            apeladas   = Count("multas", filter=Q(multas__estado="apelada")),
        ).filter(cantidad__gt=0).order_by("nombre")

        return [
            ReporteMultaTipoType(
                tipo_nombre = t.nombre,
                cantidad    = t.cantidad,
                monto_total = float(t.monto_total or 0),
                pagadas     = t.pagadas,
                pendientes  = t.pendientes,
                apeladas    = t.apeladas,
            )
            for t in tipos
        ]

    @strawberry.field
    def reporte_resumen_multas(self, info: Info) -> ReporteResumenMultasType:
        from apps.multas.models import Multa, PagoMulta

        total_recaudado = PagoMulta.objects.aggregate(total=Sum("monto_pagado"))["total"] or 0
        stats = Multa.objects.aggregate(
            total=Count("id"),
            pendientes=Count("id", filter=Q(estado="pendiente")),
            pagadas=Count("id", filter=Q(estado="pagada")),
            apeladas=Count("id", filter=Q(estado="apelada")),
            canceladas=Count("id", filter=Q(estado="cancelada")),
            monto_pendiente=Sum("monto", filter=Q(estado="pendiente")),
        )

        return ReporteResumenMultasType(
            total_multas          = stats["total"] or 0,
            monto_total_recaudado = float(total_recaudado),
            monto_total_pendiente = float(stats["monto_pendiente"] or 0),
            pagadas               = stats["pagadas"] or 0,
            pendientes            = stats["pendientes"] or 0,
            apeladas              = stats["apeladas"] or 0,
            canceladas            = stats["canceladas"] or 0,
        )

    @strawberry.field
    def reporte_ocupacion_zonas(self, info: Info) -> List[ReporteZonaOcupacionType]:
        """
        1 query con annotate (antes: 5 queries × N zonas — 25 para 5 zonas).
        """
        from apps.parqueos.models import ZonaParqueo

        zonas = ZonaParqueo.objects.filter(activo=True).annotate(
            total_esp   = Count("espacios"),
            disp        = Count("espacios", filter=Q(espacios__estado="disponible")),
            ocup        = Count("espacios", filter=Q(espacios__estado="ocupado")),
            reserv      = Count("espacios", filter=Q(espacios__estado="reservado")),
            manten      = Count("espacios", filter=Q(espacios__estado="mantenimiento")),
        ).order_by("nombre")

        return [
            ReporteZonaOcupacionType(
                zona_nombre          = z.nombre,
                ubicacion            = z.ubicacion or "—",
                total_espacios       = z.total_esp,
                disponibles          = z.disp,
                ocupados             = z.ocup,
                reservados           = z.reserv,
                mantenimiento        = z.manten,
                porcentaje_ocupacion = round(z.ocup / z.total_esp * 100, 1) if z.total_esp > 0 else 0.0,
            )
            for z in zonas
        ]

    @strawberry.field
    def reporte_vehiculos_por_tipo(self, info: Info) -> List[ReporteVehiculoGrupoType]:
        from apps.vehiculos.models import TipoVehiculo
        tipos = TipoVehiculo.objects.annotate(total=Count("vehiculos")).filter(total__gt=0).order_by("-total")
        return [ReporteVehiculoGrupoType(nombre=t.nombre, cantidad=t.total) for t in tipos]

    @strawberry.field
    def reporte_vehiculos_por_estado(self, info: Info) -> List[ReporteVehiculoGrupoType]:
        from apps.vehiculos.models import Vehiculo
        ETIQUETAS = {"activo": "Activo", "inactivo": "Inactivo", "sancionado": "Sancionado"}
        resultado = Vehiculo.objects.values("estado").annotate(total=Count("id")).order_by("-total")
        return [
            ReporteVehiculoGrupoType(nombre=ETIQUETAS.get(r["estado"], r["estado"]), cantidad=r["total"])
            for r in resultado
        ]
