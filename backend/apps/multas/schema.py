import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from django.utils import timezone

from .models import TipoMulta, Multa, PagoMulta, ApelacionMulta


@strawberry.type
class TipoMultaType:
    id: int
    nombre: str
    descripcion: str
    monto_base: Decimal


@strawberry.type
class MultaType:
    id: int
    monto: Decimal
    descripcion: str
    fecha: datetime
    estado: str

    @strawberry.field
    def tipo(self) -> TipoMultaType:
        return self.tipo

    @strawberry.field
    def placa_vehiculo(self) -> str:
        return self.vehiculo.placa

    @strawberry.field
    def registrado_por_nombre(self) -> Optional[str]:
        return f"{self.registrado_por.nombre} {self.registrado_por.apellido}" if self.registrado_por else None

    @strawberry.field
    def tiene_apelacion(self) -> bool:
        return ApelacionMulta.objects.filter(multa_id=self.id).exists()


@strawberry.type
class PagoMultaType:
    id: int
    fecha_pago: datetime
    monto_pagado: Decimal
    metodo_pago: str
    comprobante: str


@strawberry.type
class ApelacionMultaType:
    id: int
    motivo: str
    estado: str
    respuesta: str
    fecha: datetime
    fecha_resolucion: Optional[datetime]

    @strawberry.field
    def usuario_nombre(self) -> str:
        return f"{self.usuario.nombre} {self.usuario.apellido}"


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

@strawberry.input
class RegistrarMultaInput:
    vehiculo_id: int
    tipo_id: int
    descripcion: str
    monto_override: Optional[Decimal] = None


@strawberry.input
class PagarMultaInput:
    multa_id: int
    metodo_pago: str
    comprobante: Optional[str] = ""


@strawberry.input
class ApelarMultaInput:
    multa_id: int
    usuario_id: int
    motivo: str


@strawberry.input
class ResolverApelacionInput:
    apelacion_id: int
    aprobada: bool
    respuesta: str


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class MultasQuery:
    @strawberry.field
    def multas_vehiculo(self, info: Info, vehiculo_id: int, estado: Optional[str] = None) -> List[MultaType]:
        qs = Multa.objects.filter(vehiculo_id=vehiculo_id).select_related(
            "tipo", "vehiculo", "registrado_por"
        ).order_by("-fecha")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def multas_pendientes(self, info: Info) -> List[MultaType]:
        return list(
            Multa.objects.filter(estado="pendiente")
            .select_related("tipo", "vehiculo").order_by("-fecha")
        )

    @strawberry.field
    def multa(self, info: Info, id: int) -> Optional[MultaType]:
        return Multa.objects.select_related("tipo", "vehiculo", "registrado_por").filter(pk=id).first()

    @strawberry.field
    def tipos_multa(self, info: Info) -> List[TipoMultaType]:
        return list(TipoMulta.objects.all().order_by("nombre"))

    @strawberry.field
    def apelaciones_pendientes(self, info: Info) -> List[ApelacionMultaType]:
        return list(
            ApelacionMulta.objects.filter(estado="pendiente")
            .select_related("multa", "usuario").order_by("fecha")
        )


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class MultasMutation:
    @strawberry.mutation
    def registrar_multa(self, info: Info, input: RegistrarMultaInput) -> MultaType:
        from apps.vehiculos.models import Vehiculo
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        tipo = TipoMulta.objects.filter(pk=input.tipo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if not tipo:
            raise Exception("Tipo de multa no encontrado")
        monto = input.monto_override if input.monto_override is not None else tipo.monto_base
        registrado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        multa = Multa.objects.create(
            vehiculo=vehiculo, tipo=tipo, monto=monto,
            descripcion=input.descripcion, registrado_por=registrado_por,
        )
        vehiculo.estado = "sancionado"
        vehiculo.save()
        return multa

    @strawberry.mutation
    def pagar_multa(self, info: Info, input: PagarMultaInput) -> PagoMultaType:
        multa = Multa.objects.filter(pk=input.multa_id, estado="pendiente").first()
        if not multa:
            raise Exception("Multa pendiente no encontrada")
        if input.metodo_pago not in ["efectivo", "transferencia", "qr_pago"]:
            raise Exception("Método de pago inválido")
        pago = PagoMulta.objects.create(
            multa=multa, monto_pagado=multa.monto, metodo_pago=input.metodo_pago,
            comprobante=input.comprobante or "",
            registrado_por=info.context.request.user if info.context.request.user.is_authenticated else None,
        )
        multa.estado = "pagada"
        multa.save()
        if not Multa.objects.filter(vehiculo=multa.vehiculo, estado="pendiente").exists():
            multa.vehiculo.estado = "activo"
            multa.vehiculo.save()
        return pago

    @strawberry.mutation
    def apelar_multa(self, info: Info, input: ApelarMultaInput) -> ApelacionMultaType:
        from apps.usuarios.models import Usuario
        multa = Multa.objects.filter(pk=input.multa_id, estado="pendiente").first()
        if not multa:
            raise Exception("Multa pendiente no encontrada")
        if ApelacionMulta.objects.filter(multa=multa).exists():
            raise Exception("Esta multa ya tiene una apelación registrada")
        usuario = Usuario.objects.filter(pk=input.usuario_id).first()
        if not usuario:
            raise Exception("Usuario no encontrado")
        apelacion = ApelacionMulta.objects.create(multa=multa, usuario=usuario, motivo=input.motivo)
        multa.estado = "apelada"
        multa.save()
        return apelacion

    @strawberry.mutation
    def resolver_apelacion(self, info: Info, input: ResolverApelacionInput) -> ApelacionMultaType:
        apelacion = ApelacionMulta.objects.select_related("multa").filter(
            pk=input.apelacion_id, estado="pendiente"
        ).first()
        if not apelacion:
            raise Exception("Apelación pendiente no encontrada")
        resuelto_por = info.context.request.user if info.context.request.user.is_authenticated else None
        apelacion.estado = "aprobada" if input.aprobada else "rechazada"
        apelacion.respuesta = input.respuesta
        apelacion.fecha_resolucion = timezone.now()
        apelacion.resuelto_por = resuelto_por
        apelacion.save()
        if input.aprobada:
            apelacion.multa.estado = "cancelada"
            apelacion.multa.save()
            if not Multa.objects.filter(
                vehiculo=apelacion.multa.vehiculo, estado__in=["pendiente", "apelada"]
            ).exists():
                apelacion.multa.vehiculo.estado = "activo"
                apelacion.multa.vehiculo.save()
        else:
            apelacion.multa.estado = "pendiente"
            apelacion.multa.save()
        return apelacion
