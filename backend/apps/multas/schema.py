"""
Módulo Infracciones — Strawberry GraphQL Schema

Modelo de dominio: una `Infraccion` es el HECHO registrado (el guardia/admin
constata que el vehículo violó una norma). De ella se deriva una `Sancion`,
cuya naturaleza depende del tipo de infracción — puede ser una amonestación
(no bloquea el vehículo), una multa económica, una suspensión de acceso o un
reporte a Bienestar Estudiantil. Esta separación permite registrar faltas
leves sin forzar un cobro ni bloquear el vehículo, algo que el modelo anterior
("Multa" fusionaba hecho + consecuencia económica) no permitía expresar.

Correcciones heredadas del módulo anterior (preservadas):
  - Auth en queries: solo propietario o personal autorizado accede a sus datos.
  - Propietario verificado en pagar_sancion y apelar_infraccion.
  - transaction.atomic() en operaciones multi-tabla (registrar, pagar, resolver).
  - Notificaciones en hilo daemon para no bloquear la request HTTP del guardia.
  - monto_override > 0 (cuando aplica) y descripcion no vacía.
  - log_audit en operaciones críticas, incluida resolver_apelacion.
"""
import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from decimal import Decimal
from django.db import transaction
from django.utils import timezone

from .models import TipoInfraccion, Infraccion, Sancion, PagoSancion, ApelacionInfraccion

# Tipos de sanción que no requieren ninguna acción del usuario para considerarse
# resueltos — se crean directamente en estado "cumplida" y NO bloquean el vehículo.
SANCIONES_AUTO_CUMPLIDAS = ("amonestacion",)


# ── Types ──────────────────────────────────────────────────────────────────

@strawberry.type
class TipoInfraccionType:
    id: int
    nombre: str
    descripcion: str
    gravedad: str
    tipo_sancion_sugerido: str
    monto_base: Optional[Decimal]


@strawberry.type
class SancionType:
    id: int
    tipo_sancion: str
    monto: Optional[Decimal]
    estado: str
    fecha: datetime

    @strawberry.field
    def infraccion_id(self) -> int:
        return self.infraccion_id

    @strawberry.field
    def placa_vehiculo(self) -> str:
        return self.infraccion.vehiculo.placa

    @strawberry.field
    def tipo_infraccion_nombre(self) -> str:
        return self.infraccion.tipo.nombre

    @strawberry.field
    def descripcion_infraccion(self) -> str:
        return self.infraccion.descripcion


@strawberry.type
class InfraccionType:
    id: int
    descripcion: str
    fecha: datetime
    estado: str

    @strawberry.field
    def tipo(self) -> TipoInfraccionType:
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
        return ApelacionInfraccion.objects.filter(infraccion_id=self.id).exists()

    @strawberry.field
    def sancion(self) -> Optional[SancionType]:
        return getattr(self, "sancion", None)


@strawberry.type
class PagoSancionType:
    id: int
    fecha_pago: datetime
    monto_pagado: Decimal
    metodo_pago: str
    comprobante: str
    comprobante_url: str
    referencia_pago: str


@strawberry.type
class ApelacionInfraccionType:
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
class RegistrarInfraccionInput:
    vehiculo_id: int
    tipo_id: int
    descripcion: str
    tipo_sancion_override: Optional[str] = None
    monto_override: Optional[Decimal] = None


@strawberry.input
class PagarSancionInput:
    sancion_id: int
    metodo_pago: str
    comprobante: Optional[str] = ""
    comprobante_url: Optional[str] = ""      # URL Cloudinary del comprobante digital
    referencia_pago: Optional[str] = ""     # Código de transacción/referencia bancaria


@strawberry.input
class ConfirmarPagoInput:
    sancion_id: int
    aprobado: bool
    observacion: Optional[str] = ""


@strawberry.input
class MarcarSancionCumplidaInput:
    sancion_id: int
    observacion: Optional[str] = ""


@strawberry.input
class ApelarInfraccionInput:
    infraccion_id: int
    motivo: str


@strawberry.input
class ResolverApelacionInput:
    apelacion_id: int
    aprobada: bool
    respuesta: str


# ── Helpers de dominio ─────────────────────────────────────────────────────

def _sin_sanciones_activas(vehiculo) -> bool:
    """True si el vehículo no tiene sanciones pendientes/en revisión asociadas."""
    return not Sancion.objects.filter(
        infraccion__vehiculo=vehiculo,
        estado__in=["pendiente", "en_revision"],
    ).exists()


def _rehabilitar_si_corresponde(vehiculo) -> None:
    if _sin_sanciones_activas(vehiculo):
        vehiculo.estado = "activo"
        vehiculo.save(update_fields=["estado"])


# ── Notificación async (no bloquea la request del guardia) ─────────────────

def _notificar_infraccion_async(propietario, vehiculo, tipo_nombre: str, tipo_sancion: str, monto, descripcion: str) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            from apps.notificaciones.email_templates import email_infraccion_registrada
            detalle_sancion = f"Bs {monto}" if monto is not None else tipo_sancion.replace("_", " ")
            enviar_notificacion(
                usuario=propietario,
                titulo=f"Infracción registrada — {vehiculo.placa}",
                mensaje=f"Infracción '{tipo_nombre}'. Sanción: {detalle_sancion}. {descripcion}",
                tipo_codigo="infraccion_registrada",
            )
            asunto, html = email_infraccion_registrada(
                propietario.nombre, vehiculo.placa, tipo_nombre, tipo_sancion, monto, descripcion
            )
            enviar_email(
                usuario=propietario,
                asunto=asunto,
                cuerpo=f"Se registró una infracción para {vehiculo.placa}.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


def _notificar_sancion_cumplida_async(propietario, vehiculo, sancion) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_email
            from apps.notificaciones.email_templates import email_sancion_cumplida
            asunto, html = email_sancion_cumplida(
                propietario.nombre, vehiculo.placa, sancion.tipo_sancion, sancion.monto
            )
            enviar_email(
                usuario=propietario,
                asunto=asunto,
                cuerpo=f"Tu sanción para {vehiculo.placa} fue marcada como cumplida.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


# ── Queries ────────────────────────────────────────────────────────────────

@strawberry.type
class InfraccionesQuery:

    @strawberry.field
    def infracciones_vehiculo(
        self, info: Info, vehiculo_id: int, estado: Optional[str] = None
    ) -> List[InfraccionType]:
        """
        Solo el propietario del vehículo o personal autorizado puede
        ver las infracciones de un vehículo específico.
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
            raise Exception("Solo puedes ver las infracciones de tus propios vehículos")

        qs = Infraccion.objects.filter(vehiculo_id=vehiculo_id).select_related(
            "tipo", "vehiculo", "registrado_por", "sancion"
        ).order_by("-fecha")
        if estado:
            qs = qs.filter(estado=estado)
        return list(qs)

    @strawberry.field
    def sanciones_pendientes(self, info: Info) -> List[SancionType]:
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden ver las sanciones pendientes")
        # Incluye "en_revision" para que el admin vea comprobantes pendientes de verificar
        return list(
            Sancion.objects.filter(estado__in=["pendiente", "en_revision"])
            .select_related("infraccion__tipo", "infraccion__vehiculo", "infraccion__registrado_por")
            .order_by("-fecha")
        )

    @strawberry.field
    def pagos_en_revision(self, info: Info) -> List[SancionType]:
        """Comprobantes de pago digital pendientes de verificación por el admin."""
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden ver pagos en revisión")
        return list(
            Sancion.objects.filter(estado="en_revision")
            .select_related("infraccion__tipo", "infraccion__vehiculo__propietario", "pago")
            .order_by("-fecha")
        )

    @strawberry.field
    def infraccion(self, info: Info, id: int) -> Optional[InfraccionType]:
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        i = Infraccion.objects.select_related(
            "tipo", "vehiculo__propietario", "registrado_por", "sancion"
        ).filter(pk=id).first()
        if not i:
            return None
        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and i.vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes ver las infracciones de tus propios vehículos")
        return i

    @strawberry.field
    def tipos_infraccion(self, info: Info) -> List[TipoInfraccionType]:
        return list(TipoInfraccion.objects.all().order_by("nombre"))

    @strawberry.field
    def apelaciones_pendientes(self, info: Info) -> List[ApelacionInfraccionType]:
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden ver las apelaciones pendientes")
        return list(
            ApelacionInfraccion.objects.filter(estado="pendiente")
            .select_related("infraccion__vehiculo", "usuario", "resuelto_por")
            .order_by("fecha")
        )


# ── Mutations ──────────────────────────────────────────────────────────────

@strawberry.type
class InfraccionesMutation:

    @strawberry.mutation
    def registrar_infraccion(self, info: Info, input: RegistrarInfraccionInput) -> InfraccionType:
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo guardias y administradores pueden registrar infracciones")

        if not input.descripcion.strip():
            raise Exception("La descripción de la infracción es obligatoria")

        vehiculo = Vehiculo.objects.select_related("propietario").filter(pk=input.vehiculo_id).first()
        tipo = TipoInfraccion.objects.filter(pk=input.tipo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if not tipo:
            raise Exception("Tipo de infracción no encontrado")

        tipo_sancion = (input.tipo_sancion_override or tipo.tipo_sancion_sugerido).strip()
        opciones_validas = [c[0] for c in TipoInfraccion.TIPOS_SANCION]
        if tipo_sancion not in opciones_validas:
            raise Exception(f"Tipo de sanción inválido. Opciones: {', '.join(opciones_validas)}")

        monto = None
        if tipo_sancion == "multa_economica":
            monto = input.monto_override if input.monto_override is not None else tipo.monto_base
            if monto is None or monto <= 0:
                raise Exception("El monto de la sanción económica debe ser mayor a cero")

        with transaction.atomic():
            infraccion = Infraccion.objects.create(
                vehiculo=vehiculo, tipo=tipo,
                descripcion=input.descripcion.strip(), registrado_por=user,
            )
            estado_inicial = "cumplida" if tipo_sancion in SANCIONES_AUTO_CUMPLIDAS else "pendiente"
            sancion = Sancion.objects.create(
                infraccion=infraccion, tipo_sancion=tipo_sancion,
                monto=monto, estado=estado_inicial,
            )

            # Solo bloquea el vehículo si la sanción exige alguna acción —
            # una simple amonestación no debe impedirle circular.
            if estado_inicial != "cumplida":
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
                user, "infraccion_registrada",
                f"Infracción '{tipo.nombre}' ({sancion.get_tipo_sancion_display()}) para {vehiculo.placa}",
                request=info.context.request,
            )

        # Notificar fuera de la transacción para no bloquear el commit
        if vehiculo.propietario:
            _notificar_infraccion_async(
                vehiculo.propietario, vehiculo, tipo.nombre, tipo_sancion, monto, input.descripcion
            )
        infraccion.sancion = sancion
        return infraccion

    @strawberry.mutation
    def pagar_sancion(self, info: Info, input: PagarSancionInput) -> PagoSancionType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        sancion = Sancion.objects.select_related("infraccion__vehiculo__propietario").filter(
            pk=input.sancion_id, tipo_sancion="multa_economica", estado="pendiente"
        ).first()
        if not sancion:
            raise Exception("Sanción económica pendiente no encontrada")

        vehiculo = sancion.infraccion.vehiculo

        # El pago va por ventanilla de administración de la UAGRM.
        # Solo el propietario o un administrador pueden registrarlo.
        # El guardia registra infracciones, NO procesa pagos.
        es_admin = tiene_rol(user, "Administrador")
        if not es_admin and vehiculo.propietario_id != user.pk:
            raise Exception(
                "Solo el propietario del vehículo o un administrador pueden registrar el pago"
            )

        METODOS = ["efectivo", "transferencia", "qr_pago", "banca_movil"]
        if input.metodo_pago not in METODOS:
            raise Exception(f"Método de pago inválido. Opciones: {', '.join(METODOS)}")

        # Pagos digitales REQUIEREN comprobante para verificación del admin
        METODOS_DIGITALES = ["transferencia", "qr_pago", "banca_movil"]
        es_digital = input.metodo_pago in METODOS_DIGITALES
        if es_digital and not es_admin:
            if not (input.comprobante_url or "").strip():
                raise Exception(
                    "Los pagos digitales requieren subir el comprobante/screenshot "
                    "para que el administrador verifique la transacción."
                )

        with transaction.atomic():
            pago = PagoSancion.objects.create(
                sancion=sancion,
                monto_pagado=sancion.monto,
                metodo_pago=input.metodo_pago,
                comprobante=input.comprobante or "",
                comprobante_url=input.comprobante_url or "",
                referencia_pago=input.referencia_pago or "",
                registrado_por=user,
            )
            if es_digital and not es_admin:
                # Pago digital pendiente de verificación → admin debe confirmar
                sancion.estado = "en_revision"
                sancion.save(update_fields=["estado"])
                log_audit(
                    user, "pago_en_revision",
                    f"Sanción #{sancion.id} — comprobante enviado vía {input.metodo_pago}, en revisión",
                    request=info.context.request,
                )
            else:
                # Efectivo en ventanilla o admin → pago inmediato verificado
                sancion.estado = "cumplida"
                sancion.save(update_fields=["estado"])
                _rehabilitar_si_corresponde(vehiculo)
                log_audit(
                    user, "sancion_cumplida",
                    f"Sanción #{sancion.id} pagada vía {input.metodo_pago} — {vehiculo.placa}",
                    request=info.context.request,
                )

        _notificar_sancion_cumplida_async(vehiculo.propietario, vehiculo, sancion) \
            if sancion.estado == "cumplida" else None
        return pago

    @strawberry.mutation
    def confirmar_pago_sancion(self, info: Info, input: ConfirmarPagoInput) -> SancionType:
        """
        Admin confirma o rechaza un comprobante de pago digital (en_revision → cumplida/pendiente).
        Este es el paso que separa un sistema de cobros confiable de uno que fía por confianza.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden confirmar pagos")

        sancion = Sancion.objects.select_related("infraccion__vehiculo__propietario").filter(
            pk=input.sancion_id, estado="en_revision"
        ).first()
        if not sancion:
            raise Exception("Sanción en revisión no encontrada")

        vehiculo = sancion.infraccion.vehiculo

        with transaction.atomic():
            if input.aprobado:
                sancion.estado = "cumplida"
                sancion.save(update_fields=["estado"])
                _rehabilitar_si_corresponde(vehiculo)
                log_audit(user, "sancion_cumplida",
                    f"Pago de sanción #{sancion.id} CONFIRMADO por {user.ci}",
                    request=info.context.request)
            else:
                # Rechazado → vuelve a pendiente para que el propietario pague correctamente
                sancion.estado = "pendiente"
                sancion.save(update_fields=["estado"])
                # Eliminar el pago rechazado para que pueda enviarse uno nuevo
                sancion.pago.delete()
                log_audit(user, "pago_rechazado",
                    f"Pago de sanción #{sancion.id} RECHAZADO por {user.ci}. Obs: {input.observacion}",
                    request=info.context.request)

        if input.aprobado:
            _notificar_sancion_cumplida_async(vehiculo.propietario, vehiculo, sancion)
        return sancion

    @strawberry.mutation
    def marcar_sancion_cumplida(self, info: Info, input: MarcarSancionCumplidaInput) -> SancionType:
        """
        Cierra manualmente sanciones no económicas (suspensión de acceso, reporte a
        Bienestar) una vez que el área correspondiente confirma que se cumplieron —
        no pasan por un flujo de pago.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden marcar sanciones como cumplidas")

        sancion = Sancion.objects.select_related("infraccion__vehiculo__propietario").filter(
            pk=input.sancion_id, estado="pendiente"
        ).exclude(tipo_sancion="multa_economica").first()
        if not sancion:
            raise Exception("Sanción pendiente no monetaria no encontrada")

        vehiculo = sancion.infraccion.vehiculo

        with transaction.atomic():
            sancion.estado = "cumplida"
            sancion.save(update_fields=["estado"])
            _rehabilitar_si_corresponde(vehiculo)
            log_audit(
                user, "sancion_cumplida",
                f"Sanción #{sancion.id} ({sancion.get_tipo_sancion_display()}) marcada cumplida por "
                f"{user.ci} — {vehiculo.placa}. Obs: {input.observacion}",
                request=info.context.request,
            )

        _notificar_sancion_cumplida_async(vehiculo.propietario, vehiculo, sancion)
        return sancion

    @strawberry.mutation
    def apelar_infraccion(self, info: Info, input: ApelarInfraccionInput) -> ApelacionInfraccionType:
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        if not input.motivo.strip():
            raise Exception("El motivo de la apelación es obligatorio")

        infraccion = Infraccion.objects.select_related("vehiculo__propietario").filter(
            pk=input.infraccion_id, estado="registrada"
        ).first()
        if not infraccion:
            raise Exception("Infracción registrada no encontrada")

        # Solo el propietario del vehículo puede apelar su propia infracción
        if infraccion.vehiculo.propietario_id != user.pk:
            raise Exception("Solo el propietario del vehículo puede apelar esta infracción")

        if ApelacionInfraccion.objects.filter(infraccion=infraccion).exists():
            raise Exception("Esta infracción ya tiene una apelación registrada")

        with transaction.atomic():
            apelacion = ApelacionInfraccion.objects.create(
                infraccion=infraccion, usuario=user, motivo=input.motivo.strip()
            )
            infraccion.estado = "apelada"
            infraccion.save(update_fields=["estado"])
            log_audit(
                user, "infraccion_apelada",
                f"Infracción #{infraccion.id} apelada por {user.ci} — {infraccion.vehiculo.placa}",
                request=info.context.request,
            )
        return apelacion

    @strawberry.mutation
    def resolver_apelacion(self, info: Info, input: ResolverApelacionInput) -> ApelacionInfraccionType:
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.utils import log_audit

        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden resolver apelaciones")

        if not input.respuesta.strip():
            raise Exception("La respuesta de resolución es obligatoria")

        apelacion = (
            ApelacionInfraccion.objects
            .select_related("infraccion__vehiculo", "infraccion__sancion", "usuario")
            .filter(pk=input.apelacion_id, estado="pendiente")
            .first()
        )
        if not apelacion:
            raise Exception("Apelación pendiente no encontrada")

        infraccion = apelacion.infraccion
        vehiculo = infraccion.vehiculo

        with transaction.atomic():
            apelacion.estado          = "aprobada" if input.aprobada else "rechazada"
            apelacion.respuesta       = input.respuesta.strip()
            apelacion.fecha_resolucion = timezone.now()
            apelacion.resuelto_por    = user
            apelacion.save()

            if input.aprobada:
                infraccion.estado = "anulada"
                infraccion.save(update_fields=["estado"])
                # Anular la infracción cancela en cascada su sanción asociada
                sancion = getattr(infraccion, "sancion", None)
                if sancion is not None and sancion.estado in ("pendiente", "en_revision"):
                    sancion.estado = "cancelada"
                    sancion.save(update_fields=["estado"])
                _rehabilitar_si_corresponde(vehiculo)
            else:
                infraccion.estado = "confirmada"
                infraccion.save(update_fields=["estado"])

            resultado = "aprobada" if input.aprobada else "rechazada"
            log_audit(
                user, "apelacion_resuelta",
                f"Apelación #{apelacion.id} {resultado} por {user.ci} — "
                f"infracción #{infraccion.id} ({vehiculo.placa})",
                request=info.context.request,
            )

        return apelacion

