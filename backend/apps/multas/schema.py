"""
Módulo Multas — Strawberry GraphQL Schema

Correcciones aplicadas:
  - Auth en queries: solo propietario o personal autorizado accede a sus multas.
  - Propietario verificado en pagar_multa y apelar_multa.
  - transaction.atomic() en operaciones multi-tabla (registrar, pagar, resolver).
  - Notificaciones en hilo daemon para no bloquear la request HTTP del guardia.
  - monto_override > 0 y descripcion no vacía.
  - log_audit en resolver_apelacion (operación crítica).
  - resuelto_por_nombre expuesto en ApelacionMultaType.
"""
import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from django.db import transaction
from django.utils import timezone

from .models import TipoMulta, Multa, PagoMulta, ApelacionMulta


# ── Types ──────────────────────────────────────────────────────────────────

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
        if self.registrado_por:
            return f"{self.registrado_por.nombre} {self.registrado_por.apellido}"
        return None

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

    @strawberry.field
    def resuelto_por_nombre(self) -> Optional[str]:
        """Admin que resolvió la apelación — trazabilidad completa."""
        if self.resuelto_por:
            return f"{self.resuelto_por.nombre} {self.resuelto_por.apellido}"
        return None


# ── Inputs ─────────────────────────────────────────────────────────────────

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


# ── Notificación async (no bloquea la request del guardia) ─────────────────

def _notificar_multa_async(propietario, vehiculo, tipo_nombre: str, monto, descripcion: str) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            from apps.notificaciones.email_templates import email_multa_registrada
            enviar_notificacion(
                usuario=propietario,
                titulo=f"Multa registrada — {vehiculo.placa}",
                mensaje=f"Multa por '{tipo_nombre}' de Bs {monto}. {descripcion}",
                tipo_codigo="multa_registrada",
            )
            asunto, html = email_multa_registrada(
                propietario.nombre, vehiculo.placa, tipo_nombre, str(monto), descripcion
            )
            enviar_email(
                usuario=propietario,
                asunto=asunto,
                cuerpo=f"Multa de Bs {monto} registrada para {vehiculo.placa}.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


def _notificar_pago_async(propietario, vehiculo, monto, metodo_pago: str) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_email
            from apps.notificaciones.email_templates import email_multa_pagada
            asunto, html = email_multa_pagada(
                propietario.nombre, vehiculo.placa, str(monto), metodo_pago
            )
            enviar_email(
                usuario=propietario,
                asunto=asunto,
                cuerpo=f"Tu multa de Bs {monto} fue pagada.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


# ── Queries ────────────────────────────────────────────────────────────────

@strawberry.type
class MultasQuery:

    @strawberry.field
    def multas_vehiculo(
        self, info: Info, vehiculo_id: int, estado: Optional[str] = None
    ) -> List[MultaType]:
        """
        Solo el propietario del vehículo o personal autorizado puede
        ver las multas de un vehículo específico.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.vehiculos.models import Vehiculo
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        vehiculo = Vehiculo.objects.filter(pk=vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")

        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes ver las multas de tus propios vehículos")

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
            .select_related("tipo", "vehiculo", "registrado_por")
            .order_by("-fecha")
        )

    @strawberry.field
    def multa(self, info: Info, id: int) -> Optional[MultaType]:
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        m = Multa.objects.select_related(
            "tipo", "vehiculo__propietario", "registrado_por"
        ).filter(pk=id).first()
        if not m:
            return None
        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and m.vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes ver las multas de tus propios vehículos")
        return m

    @strawberry.field
    def tipos_multa(self, info: Info) -> List[TipoMultaType]:
        return list(TipoMulta.objects.all().order_by("nombre"))

    @strawberry.field
    def apelaciones_pendientes(self, info: Info) -> List[ApelacionMultaType]:
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden ver las apelaciones pendientes")
        return list(
            ApelacionMulta.objects.filter(estado="pendiente")
            .select_related("multa__vehiculo", "usuario", "resuelto_por")
            .order_by("fecha")
        )


# ── Mutations ──────────────────────────────────────────────────────────────

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

        if not input.descripcion.strip():
            raise Exception("La descripción de la infracción es obligatoria")

        vehiculo = Vehiculo.objects.select_related("propietario").filter(pk=input.vehiculo_id).first()
        tipo = TipoMulta.objects.filter(pk=input.tipo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if not tipo:
            raise Exception("Tipo de multa no encontrado")

        monto = input.monto_override if input.monto_override is not None else tipo.monto_base
        if monto <= 0:
            raise Exception("El monto de la multa debe ser mayor a cero")

        with transaction.atomic():
            multa = Multa.objects.create(
                vehiculo=vehiculo, tipo=tipo, monto=monto,
                descripcion=input.descripcion.strip(), registrado_por=user,
            )
            vehiculo.estado = "sancionado"
            vehiculo.save(update_fields=["estado"])

            # Cerrar sesión de parqueo activa — no puede seguir estacionado si es sancionado
            from apps.parqueos.models import SesionParqueo
            sesion = SesionParqueo.objects.filter(vehiculo=vehiculo, estado="activa").first()
            if sesion:
                sesion.hora_salida = timezone.now()
                sesion.estado = "cerrada"
                sesion.save(update_fields=["hora_salida", "estado"])
                sesion.espacio.estado = "disponible"
                sesion.espacio.save(update_fields=["estado"])

            log_audit(
                user, "multa_registrada",
                f"Multa '{tipo.nombre}' Bs {monto} para {vehiculo.placa}",
                request=info.context.request,
            )

        # Notificar fuera de la transacción para no bloquear el commit
        if vehiculo.propietario:
            _notificar_multa_async(
                vehiculo.propietario, vehiculo, tipo.nombre, monto, input.descripcion
            )
        return multa

    @strawberry.mutation
    def pagar_multa(self, info: Info, input: PagarMultaInput) -> PagoMultaType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        multa = Multa.objects.select_related("vehiculo__propietario").filter(
            pk=input.multa_id, estado="pendiente"
        ).first()
        if not multa:
            raise Exception("Multa pendiente no encontrada")

        # El pago va por ventanilla de administración de la UAGRM.
        # Solo el propietario o un administrador pueden registrarlo.
        # El guardia registra infracciones, NO procesa pagos.
        es_admin = tiene_rol(user, "Administrador")
        if not es_admin and multa.vehiculo.propietario_id != user.pk:
            raise Exception(
                "Solo el propietario del vehículo o un administrador pueden registrar el pago"
            )

        METODOS = ["efectivo", "transferencia", "qr_pago"]
        if input.metodo_pago not in METODOS:
            raise Exception(f"Método de pago inválido. Opciones: {', '.join(METODOS)}")

        with transaction.atomic():
            pago = PagoMulta.objects.create(
                multa=multa,
                monto_pagado=multa.monto,
                metodo_pago=input.metodo_pago,
                comprobante=input.comprobante or "",
                registrado_por=user,
            )
            multa.estado = "pagada"
            multa.save(update_fields=["estado"])

            # Rehabilitar vehículo si no quedan multas pendientes
            if not Multa.objects.filter(vehiculo=multa.vehiculo, estado="pendiente").exists():
                multa.vehiculo.estado = "activo"
                multa.vehiculo.save(update_fields=["estado"])

            log_audit(
                user, "multa_pagada",
                f"Multa #{multa.id} pagada vía {input.metodo_pago} — {multa.vehiculo.placa}",
                request=info.context.request,
            )

        _notificar_pago_async(
            multa.vehiculo.propietario, multa.vehiculo, multa.monto, input.metodo_pago
        )
        return pago

    @strawberry.mutation
    def apelar_multa(self, info: Info, input: ApelarMultaInput) -> ApelacionMultaType:
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        if not input.motivo.strip():
            raise Exception("El motivo de la apelación es obligatorio")

        multa = Multa.objects.select_related("vehiculo__propietario").filter(
            pk=input.multa_id, estado="pendiente"
        ).first()
        if not multa:
            raise Exception("Multa pendiente no encontrada")

        # Solo el propietario del vehículo puede apelar su propia multa
        if multa.vehiculo.propietario_id != user.pk:
            raise Exception("Solo el propietario del vehículo puede apelar esta multa")

        if ApelacionMulta.objects.filter(multa=multa).exists():
            raise Exception("Esta multa ya tiene una apelación registrada")

        with transaction.atomic():
            apelacion = ApelacionMulta.objects.create(
                multa=multa, usuario=user, motivo=input.motivo.strip()
            )
            multa.estado = "apelada"
            multa.save(update_fields=["estado"])
            log_audit(
                user, "multa_apelada",
                f"Multa #{multa.id} apelada por {user.ci} — {multa.vehiculo.placa}",
                request=info.context.request,
            )
        return apelacion

    @strawberry.mutation
    def resolver_apelacion(self, info: Info, input: ResolverApelacionInput) -> ApelacionMultaType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden resolver apelaciones")

        if not input.respuesta.strip():
            raise Exception("La respuesta de resolución es obligatoria")

        apelacion = (
            ApelacionMulta.objects
            .select_related("multa__vehiculo", "usuario")
            .filter(pk=input.apelacion_id, estado="pendiente")
            .first()
        )
        if not apelacion:
            raise Exception("Apelación pendiente no encontrada")

        with transaction.atomic():
            apelacion.estado          = "aprobada" if input.aprobada else "rechazada"
            apelacion.respuesta       = input.respuesta.strip()
            apelacion.fecha_resolucion = timezone.now()
            apelacion.resuelto_por    = user
            apelacion.save()

            if input.aprobada:
                apelacion.multa.estado = "cancelada"
                apelacion.multa.save(update_fields=["estado"])
                # Rehabilitar vehículo si no quedan multas activas
                sin_multas_activas = not Multa.objects.filter(
                    vehiculo=apelacion.multa.vehiculo,
                    estado__in=["pendiente", "apelada"],
                ).exists()
                if sin_multas_activas:
                    apelacion.multa.vehiculo.estado = "activo"
                    apelacion.multa.vehiculo.save(update_fields=["estado"])
            else:
                apelacion.multa.estado = "pendiente"
                apelacion.multa.save(update_fields=["estado"])

            resultado = "aprobada" if input.aprobada else "rechazada"
            log_audit(
                user, "apelacion_resuelta",
                f"Apelación #{apelacion.id} {resultado} por {user.ci} — "
                f"multa #{apelacion.multa.id} ({apelacion.multa.vehiculo.placa})",
                request=info.context.request,
            )

        return apelacion
