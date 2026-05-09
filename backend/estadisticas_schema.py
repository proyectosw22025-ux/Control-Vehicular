import strawberry
from strawberry.types import Info
from typing import List
from django.utils import timezone
from datetime import timedelta
from django.db.models import Sum, Count


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


# ── Query ──────────────────────────────────────────────────

@strawberry.type
class EstadisticasQuery:

    # ── Dashboard ─────────────────────────────────────────

    @strawberry.field
    def dashboard_stats(self, info: Info) -> DashboardStatsType:
        from apps.vehiculos.models import Vehiculo
        from apps.parqueos.models import EspacioParqueo
        from apps.multas.models import Multa, ApelacionMulta
        from apps.visitantes.models import Visita
        from apps.acceso.models import RegistroAcceso
        from apps.usuarios.models import Usuario

        hoy = timezone.now().date()
        monto = Multa.objects.filter(estado="pendiente").aggregate(
            total=Sum("monto")
        )["total"] or 0

        return DashboardStatsType(
            total_vehiculos=Vehiculo.objects.filter(estado="activo").count(),
            vehiculos_activos_hoy=(
                RegistroAcceso.objects
                .filter(tipo="entrada", timestamp__date=hoy)
                .values("vehiculo").distinct().count()
            ),
            espacios_disponibles=EspacioParqueo.objects.filter(estado="disponible").count(),
            total_espacios=EspacioParqueo.objects.count(),
            multas_pendientes=Multa.objects.filter(estado="pendiente").count(),
            monto_multas_pendientes=float(monto),
            visitantes_activos=Visita.objects.filter(estado="activa").count(),
            accesos_hoy=RegistroAcceso.objects.filter(timestamp__date=hoy).count(),
            total_usuarios=Usuario.objects.filter(is_active=True).count(),
            apelaciones_pendientes=ApelacionMulta.objects.filter(estado="pendiente").count(),
        )

    @strawberry.field
    def accesos_ultima_semana(self, info: Info) -> List[AccesosDiaType]:
        from apps.acceso.models import RegistroAcceso

        hoy = timezone.now().date()
        resultado = []
        for i in range(6, -1, -1):
            fecha = hoy - timedelta(days=i)
            entradas = RegistroAcceso.objects.filter(tipo="entrada", timestamp__date=fecha).count()
            salidas  = RegistroAcceso.objects.filter(tipo="salida",  timestamp__date=fecha).count()
            resultado.append(AccesosDiaType(
                fecha=fecha.strftime("%d/%m"),
                entradas=entradas,
                salidas=salidas,
            ))
        return resultado

    # ── Reportes ───────────────────────────────────────────

    @strawberry.field
    def reporte_accesos(self, info: Info, dias: int = 30) -> List[ReporteAccesosDiaType]:
        """Accesos por día para los últimos N días (máx 90)."""
        from apps.acceso.models import RegistroAcceso

        dias = min(max(dias, 1), 90)
        hoy  = timezone.now().date()
        resultado = []

        for i in range(dias - 1, -1, -1):
            fecha    = hoy - timedelta(days=i)
            entradas = RegistroAcceso.objects.filter(tipo="entrada", timestamp__date=fecha).count()
            salidas  = RegistroAcceso.objects.filter(tipo="salida",  timestamp__date=fecha).count()
            resultado.append(ReporteAccesosDiaType(
                fecha      = fecha.strftime("%d/%m"),
                fecha_iso  = fecha.isoformat(),
                entradas   = entradas,
                salidas    = salidas,
                total      = entradas + salidas,
            ))
        return resultado

    @strawberry.field
    def reporte_multas_por_tipo(self, info: Info) -> List[ReporteMultaTipoType]:
        """Multas agrupadas por tipo con montos y estados."""
        from apps.multas.models import Multa, TipoMulta

        tipos = TipoMulta.objects.all().order_by("nombre")
        resultado = []

        for tipo in tipos:
            qs = Multa.objects.filter(tipo=tipo)
            monto = qs.aggregate(total=Sum("monto"))["total"] or 0
            resultado.append(ReporteMultaTipoType(
                tipo_nombre = tipo.nombre,
                cantidad    = qs.count(),
                monto_total = float(monto),
                pagadas     = qs.filter(estado="pagada").count(),
                pendientes  = qs.filter(estado="pendiente").count(),
                apeladas    = qs.filter(estado="apelada").count(),
            ))
        # Solo incluir tipos que tengan al menos 1 multa registrada
        return [r for r in resultado if r.cantidad > 0]

    @strawberry.field
    def reporte_resumen_multas(self, info: Info) -> ReporteResumenMultasType:
        """Resumen global de multas."""
        from apps.multas.models import Multa, PagoMulta

        total_recaudado = PagoMulta.objects.aggregate(
            total=Sum("monto_pagado")
        )["total"] or 0
        monto_pendiente = Multa.objects.filter(estado="pendiente").aggregate(
            total=Sum("monto")
        )["total"] or 0

        return ReporteResumenMultasType(
            total_multas             = Multa.objects.count(),
            monto_total_recaudado    = float(total_recaudado),
            monto_total_pendiente    = float(monto_pendiente),
            pagadas                  = Multa.objects.filter(estado="pagada").count(),
            pendientes               = Multa.objects.filter(estado="pendiente").count(),
            apeladas                 = Multa.objects.filter(estado="apelada").count(),
            canceladas               = Multa.objects.filter(estado="cancelada").count(),
        )

    @strawberry.field
    def reporte_ocupacion_zonas(self, info: Info) -> List[ReporteZonaOcupacionType]:
        """Ocupación actual de cada zona de parqueo."""
        from apps.parqueos.models import ZonaParqueo, EspacioParqueo

        zonas = ZonaParqueo.objects.filter(activo=True).order_by("nombre")
        resultado = []

        for zona in zonas:
            qs = EspacioParqueo.objects.filter(zona=zona)
            total        = qs.count()
            disponibles  = qs.filter(estado="disponible").count()
            ocupados     = qs.filter(estado="ocupado").count()
            reservados   = qs.filter(estado="reservado").count()
            manten       = qs.filter(estado="mantenimiento").count()
            pct = round((ocupados / total * 100), 1) if total > 0 else 0.0

            resultado.append(ReporteZonaOcupacionType(
                zona_nombre          = zona.nombre,
                ubicacion            = zona.ubicacion or "—",
                total_espacios       = total,
                disponibles          = disponibles,
                ocupados             = ocupados,
                reservados           = reservados,
                mantenimiento        = manten,
                porcentaje_ocupacion = pct,
            ))
        return resultado

    @strawberry.field
    def reporte_vehiculos_por_tipo(self, info: Info) -> List[ReporteVehiculoGrupoType]:
        """Vehículos agrupados por tipo."""
        from apps.vehiculos.models import TipoVehiculo, Vehiculo

        tipos = TipoVehiculo.objects.annotate(
            total=Count("vehiculos")
        ).filter(total__gt=0).order_by("-total")

        return [
            ReporteVehiculoGrupoType(nombre=t.nombre, cantidad=t.total)
            for t in tipos
        ]

    @strawberry.field
    def reporte_vehiculos_por_estado(self, info: Info) -> List[ReporteVehiculoGrupoType]:
        """Vehículos agrupados por estado."""
        from apps.vehiculos.models import Vehiculo

        ETIQUETAS = {"activo": "Activo", "inactivo": "Inactivo", "sancionado": "Sancionado"}
        resultado = (
            Vehiculo.objects
            .values("estado")
            .annotate(total=Count("id"))
            .order_by("-total")
        )
        return [
            ReporteVehiculoGrupoType(
                nombre   = ETIQUETAS.get(r["estado"], r["estado"]),
                cantidad = r["total"],
            )
            for r in resultado
        ]
