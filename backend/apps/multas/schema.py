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
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden ver las multas pendientes")
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
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden registrar multas")
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
        # Cerrar sesión de parqueo activa si el vehículo es sancionado
        from apps.parqueos.models import SesionParqueo
        from django.utils import timezone as tz
        sesion_activa = SesionParqueo.objects.filter(vehiculo=vehiculo, estado="activa").first()
        if sesion_activa:
            sesion_activa.hora_salida = tz.now()
            sesion_activa.estado = "cerrada"
            sesion_activa.save()
            sesion_activa.espacio.estado = "disponible"
            sesion_activa.espacio.save()
        log_audit(
            user, "multa_registrada",
            f"Multa '{tipo.nombre}' Bs {monto} registrada para {vehiculo.placa}",
            request=info.context.request,
        )

        propietario = getattr(vehiculo, "propietario", None)
        if propietario:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            enviar_notificacion(
                usuario=propietario,
                titulo=f"Multa registrada — {vehiculo.placa}",
                mensaje=f"Se registró una multa por '{tipo.nombre}' de Bs {monto}. {input.descripcion}",
                tipo_codigo="multa_registrada",
            )
            enviar_email(
                usuario=propietario,
                asunto=f"Multa registrada para vehículo {vehiculo.placa}",
                cuerpo=(
                    f"Hola {propietario.nombre},\n\n"
                    f"Se registró una multa para tu vehículo {vehiculo.placa}:\n"
                    f"  Tipo: {tipo.nombre}\n"
                    f"  Monto: Bs {monto}\n"
                    f"  Descripción: {input.descripcion}\n\n"
                    f"Ingresa al sistema para ver los detalles y realizar el pago.\n"
                ),
            )

        return multa

    @strawberry.mutation
    def pagar_multa(self, info: Info, input: PagarMultaInput) -> PagoMultaType:
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        multa = Multa.objects.filter(pk=input.multa_id, estado="pendiente").first()
        if not multa:
            raise Exception("Multa pendiente no encontrada")
        if input.metodo_pago not in ["efectivo", "transferencia", "qr_pago"]:
            raise Exception("Método de pago inválido")
        pago = PagoMulta.objects.create(
            multa=multa, monto_pagado=multa.monto, metodo_pago=input.metodo_pago,
            comprobante=input.comprobante or "",
            registrado_por=user,
        )
        multa.estado = "pagada"
        multa.save()
        if not Multa.objects.filter(vehiculo=multa.vehiculo, estado="pendiente").exists():
            multa.vehiculo.estado = "activo"
            multa.vehiculo.save()
        log_audit(
            user, "multa_pagada",
            f"Multa #{multa.id} pagada vía {input.metodo_pago} para {multa.vehiculo.placa}",
            request=info.context.request,
        )
        return pago

    @strawberry.mutation
    def apelar_multa(self, info: Info, input: ApelarMultaInput) -> ApelacionMultaType:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        multa = Multa.objects.filter(pk=input.multa_id, estado="pendiente").first()
        if not multa:
            raise Exception("Multa pendiente no encontrada")
        if ApelacionMulta.objects.filter(multa=multa).exists():
            raise Exception("Esta multa ya tiene una apelación registrada")
        apelacion = ApelacionMulta.objects.create(multa=multa, usuario=user, motivo=input.motivo)
        multa.estado = "apelada"
        multa.save()
        return apelacion

    @strawberry.mutation
    def resolver_apelacion(self, info: Info, input: ResolverApelacionInput) -> ApelacionMultaType:
        from apps.usuarios.utils import tiene_rol
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden resolver apelaciones")
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
