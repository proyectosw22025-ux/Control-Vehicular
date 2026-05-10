import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
import hashlib
import uuid
from django.utils import timezone
from datetime import timedelta

from .models import PuntoAcceso, QrSesion, PaseTemporal, RegistroAcceso, AuditLog


@strawberry.type
class PuntoAccesoType:
    id: int
    nombre: str
    ubicacion: str
    tipo: str
    activo: bool


@strawberry.type
class QrDelegacionType:
    id: int
    codigo_hash: str
    motivo: str
    fecha_generacion: datetime
    fecha_expiracion: datetime
    usado: bool

    @strawberry.field
    def placa_vehiculo(self) -> str:
        return self.vehiculo.placa

    @strawberry.field
    def vigente(self) -> bool:
        return not self.usado and self.fecha_expiracion > timezone.now()


@strawberry.type
class PaseTemporalType:
    id: int
    codigo: str
    valido_desde: datetime
    valido_hasta: datetime
    usos_max: int
    usos_actual: int
    activo: bool

    @strawberry.field
    def vigente(self) -> bool:
        ahora = timezone.now()
        return (
            self.activo
            and self.valido_desde <= ahora <= self.valido_hasta
            and self.usos_actual < self.usos_max
        )

    @strawberry.field
    def usos_restantes(self) -> int:
        return max(0, self.usos_max - self.usos_actual)


@strawberry.type
class RegistroAccesoType:
    id: int
    tipo: str
    metodo_acceso: str
    timestamp: datetime
    observacion: str

    @strawberry.field
    def punto_nombre(self) -> str:
        return self.punto_acceso.nombre

    @strawberry.field
    def placa_vehiculo(self) -> Optional[str]:
        return self.vehiculo.placa if self.vehiculo else None


@strawberry.type
class AuditLogType:
    id: int
    accion: str
    descripcion: str
    ip: Optional[str]
    created_at: datetime

    @strawberry.field
    def usuario_nombre(self) -> str:
        if self.usuario:
            return f"{self.usuario.nombre} {self.usuario.apellido}"
        return "Sistema"


def _log_audit(usuario, accion: str, descripcion: str, request=None):
    ip = None
    if request:
        x_fwd = request.META.get("HTTP_X_FORWARDED_FOR")
        ip = x_fwd.split(",")[0].strip() if x_fwd else request.META.get("REMOTE_ADDR")
    AuditLog.objects.create(
        accion=accion,
        descripcion=descripcion,
        usuario=usuario if getattr(usuario, "is_authenticated", False) else None,
        ip=ip,
    )


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

@strawberry.input
class GenerarQrDelegacionInput:
    vehiculo_id: int
    motivo: str
    horas_validez: Optional[int] = 24


@strawberry.input
class ValidarAccesoInput:
    punto_acceso_id: int
    codigo: str
    tipo: str


@strawberry.input
class AccesoManualInput:
    punto_acceso_id: int
    placa: str
    tipo: str
    observacion: Optional[str] = ""


@strawberry.input
class CrearPaseTemporalInput:
    vehiculo_id: Optional[int] = None
    visitante_id: Optional[int] = None
    valido_desde: str
    valido_hasta: str
    usos_max: Optional[int] = 2


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class AccesoQuery:
    @strawberry.field
    def puntos_acceso(self, info: Info) -> List[PuntoAccesoType]:
        return list(PuntoAcceso.objects.filter(activo=True))

    @strawberry.field
    def qr_delegaciones_vehiculo(self, info: Info, vehiculo_id: int) -> List[QrDelegacionType]:
        return list(QrSesion.objects.filter(
            vehiculo_id=vehiculo_id, usado=False, fecha_expiracion__gt=timezone.now()
        ).select_related("vehiculo"))

    @strawberry.field
    def registros_acceso(
        self, info: Info,
        vehiculo_id: Optional[int] = None,
        punto_id: Optional[int] = None,
        limite: int = 50,
    ) -> List[RegistroAccesoType]:
        qs = RegistroAcceso.objects.select_related("punto_acceso", "vehiculo").order_by("-timestamp")
        if vehiculo_id:
            qs = qs.filter(vehiculo_id=vehiculo_id)
        if punto_id:
            qs = qs.filter(punto_acceso_id=punto_id)
        return list(qs[:limite])

    @strawberry.field
    def validar_pase(self, info: Info, codigo: str) -> PaseTemporalType:
        pase = PaseTemporal.objects.filter(codigo=codigo).first()
        if not pase:
            raise Exception("Pase no encontrado")
        ahora = timezone.now()
        if not (pase.activo and pase.valido_desde <= ahora <= pase.valido_hasta and pase.usos_actual < pase.usos_max):
            raise Exception("Pase inválido, expirado o sin usos disponibles")
        return pase

    @strawberry.field
    def audit_log(self, info: Info, limite: int = 200) -> List[AuditLogType]:
        from apps.usuarios.utils import tiene_rol
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden ver el registro de auditoría")
        return list(AuditLog.objects.select_related("usuario")[:limite])


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class AccesoMutation:
    @strawberry.mutation
    def generar_qr_delegacion(self, info: Info, input: GenerarQrDelegacionInput) -> QrDelegacionType:
        from apps.vehiculos.models import Vehiculo
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if vehiculo.estado == "pendiente":
            raise Exception("Vehículo pendiente de aprobación, no puede generar QR de delegación")
        if vehiculo.estado == "sancionado":
            raise Exception("Vehículo sancionado, no puede generar QR de delegación")
        if vehiculo.estado == "inactivo":
            raise Exception("Vehículo inactivo, no puede generar QR de delegación")
        codigo_hash = hashlib.sha256(f"{vehiculo.placa}-{uuid.uuid4()}".encode()).hexdigest()
        horas = max(1, min(input.horas_validez or 24, 168))
        generado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        return QrSesion.objects.create(
            vehiculo=vehiculo,
            codigo_hash=codigo_hash,
            motivo=input.motivo,
            fecha_expiracion=timezone.now() + timedelta(hours=horas),
            generado_por=generado_por,
        )

    @strawberry.mutation
    def registrar_acceso(self, info: Info, input: ValidarAccesoInput) -> RegistroAccesoType:
        from apps.vehiculos.models import Vehiculo
        if input.tipo not in ["entrada", "salida"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida")
        punto = PuntoAcceso.objects.filter(pk=input.punto_acceso_id, activo=True).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado o inactivo")

        qr_delegacion = pase_temporal = vehiculo = None
        metodo_acceso = None

        # Nivel 1: QR permanente del vehículo
        vehiculo = Vehiculo.objects.filter(codigo_qr=input.codigo).first()
        if vehiculo:
            if vehiculo.estado == "pendiente":
                raise Exception("Vehículo pendiente de aprobación. Espere la confirmación del administrador.")
            if vehiculo.estado == "sancionado":
                raise Exception("Vehículo sancionado. Regularice sus multas para acceder.")
            if vehiculo.estado == "inactivo":
                raise Exception("Vehículo inactivo. Contacte a la administración.")
            metodo_acceso = "qr_permanente"
        else:
            # Nivel 2: QR de delegación
            qr = QrSesion.objects.filter(codigo_hash=input.codigo, usado=False).select_related("vehiculo").first()
            if qr:
                if qr.fecha_expiracion <= timezone.now():
                    raise Exception("QR de delegación expirado")
                if qr.vehiculo.estado in ("pendiente", "inactivo"):
                    raise Exception(f"Vehículo no habilitado para acceso (estado: {qr.vehiculo.estado}).")
                if qr.vehiculo.estado == "sancionado":
                    raise Exception("Vehículo sancionado. No puede ingresar.")
                qr.usado = True
                qr.save()
                qr_delegacion = qr
                vehiculo = qr.vehiculo
                metodo_acceso = "qr_delegacion"
            else:
                # Nivel 3: Pase temporal para visitantes
                pase = PaseTemporal.objects.filter(codigo=input.codigo).first()
                if pase:
                    ahora = timezone.now()
                    if not (pase.activo and pase.valido_desde <= ahora <= pase.valido_hasta and pase.usos_actual < pase.usos_max):
                        raise Exception("Pase temporal inválido o expirado")
                    pase.usos_actual += 1
                    pase.save()
                    pase_temporal = pase
                    vehiculo = pase.vehiculo
                    metodo_acceso = "pase_temporal"
                else:
                    raise Exception("Código no reconocido. Verifique el QR o pase temporal.")

        registrado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        registro = RegistroAcceso.objects.create(
            punto_acceso=punto,
            vehiculo=vehiculo,
            qr_delegacion=qr_delegacion,
            pase_temporal=pase_temporal,
            tipo=input.tipo,
            metodo_acceso=metodo_acceso,
            registrado_por=registrado_por,
        )
        _log_audit(
            registrado_por,
            "registrar_acceso",
            f"{input.tipo.capitalize()} de {vehiculo.placa if vehiculo else '?'} en {punto.nombre} vía {metodo_acceso}",
            request=info.context.request,
        )

        # Notificar al propietario del vehículo
        propietario = getattr(vehiculo, "propietario", None)
        if propietario:
            from apps.notificaciones.utils import enviar_notificacion
            accion = "entró a" if input.tipo == "entrada" else "salió de"
            enviar_notificacion(
                usuario=propietario,
                titulo=f"Vehículo {accion} la universidad",
                mensaje=f"{vehiculo.placa} registró {input.tipo} en {punto.nombre}.",
                tipo_codigo="acceso_vehiculo",
            )

        return registro

    @strawberry.mutation
    def registrar_acceso_manual(self, info: Info, input: AccesoManualInput) -> RegistroAccesoType:
        from apps.vehiculos.models import Vehiculo
        if input.tipo not in ["entrada", "salida"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida")
        punto = PuntoAcceso.objects.filter(pk=input.punto_acceso_id, activo=True).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado o inactivo")
        vehiculo = Vehiculo.objects.filter(placa=input.placa.upper()).first()
        if not vehiculo:
            raise Exception(f"Vehículo con placa {input.placa.upper()} no registrado en el sistema")
        if vehiculo.estado == "sancionado":
            raise Exception("Vehículo sancionado. No puede ingresar hasta regularizar sus multas.")
        if vehiculo.estado == "inactivo":
            raise Exception("Vehículo inactivo. Contacte a la administración.")
        registrado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        registro = RegistroAcceso.objects.create(
            punto_acceso=punto,
            vehiculo=vehiculo,
            tipo=input.tipo,
            metodo_acceso="manual",
            observacion=input.observacion or "",
            registrado_por=registrado_por,
        )
        _log_audit(
            registrado_por,
            "acceso_manual",
            f"{input.tipo.capitalize()} manual de {vehiculo.placa} en {punto.nombre}",
            request=info.context.request,
        )
        return registro

    @strawberry.mutation
    def crear_pase_temporal(self, info: Info, input: CrearPaseTemporalInput) -> PaseTemporalType:
        from datetime import datetime as dt
        from apps.vehiculos.models import Vehiculo
        from apps.visitantes.models import Visitante
        tz = timezone.get_current_timezone()
        valido_desde = dt.fromisoformat(input.valido_desde).replace(tzinfo=tz)
        valido_hasta = dt.fromisoformat(input.valido_hasta).replace(tzinfo=tz)
        if valido_hasta <= valido_desde:
            raise Exception("La fecha de fin debe ser posterior a la de inicio")
        if not input.vehiculo_id and not input.visitante_id:
            raise Exception("Debe especificar al menos un vehículo o visitante para el pase")
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first() if input.vehiculo_id else None
        visitante = Visitante.objects.filter(pk=input.visitante_id).first() if input.visitante_id else None
        if input.vehiculo_id and not vehiculo:
            raise Exception("Vehículo no encontrado")
        if input.visitante_id and not visitante:
            raise Exception("Visitante no encontrado")
        generado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        return PaseTemporal.objects.create(
            vehiculo=vehiculo, visitante=visitante,
            codigo=uuid.uuid4().hex[:12].upper(),
            valido_desde=valido_desde, valido_hasta=valido_hasta,
            usos_max=input.usos_max or 2, generado_por=generado_por,
        )

    @strawberry.mutation
    def crear_punto_acceso(self, info: Info, nombre: str, tipo: str, ubicacion: Optional[str] = "") -> PuntoAccesoType:
        if tipo not in ["entrada", "salida", "ambos"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida, ambos")
        return PuntoAcceso.objects.create(nombre=nombre, tipo=tipo, ubicacion=ubicacion or "")
