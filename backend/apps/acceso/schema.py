import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
import hashlib
import uuid
from django.utils import timezone
from datetime import timedelta

from .models import PuntoAcceso, QrSesion, PaseTemporal, RegistroAcceso


@strawberry.type
class PuntoAccesoType:
    id: int
    nombre: str
    ubicacion: str
    tipo: str
    activo: bool


@strawberry.type
class QrSesionType:
    id: int
    codigo_hash: str
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
    timestamp: datetime
    observacion: str

    @strawberry.field
    def punto_nombre(self) -> str:
        return self.punto_acceso.nombre

    @strawberry.field
    def placa_vehiculo(self) -> Optional[str]:
        return self.vehiculo.placa if self.vehiculo else None


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

@strawberry.input
class GenerarQrInput:
    vehiculo_id: int
    horas_validez: Optional[int] = 8


@strawberry.input
class ValidarAccesoInput:
    punto_acceso_id: int
    codigo: str
    tipo: str


@strawberry.input
class CrearPaseTemporalInput:
    vehiculo_id: Optional[int] = None
    visitante_id: Optional[int] = None
    valido_desde: str
    valido_hasta: str
    usos_max: Optional[int] = 1


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class AccesoQuery:
    @strawberry.field
    def puntos_acceso(self, info: Info) -> List[PuntoAccesoType]:
        return list(PuntoAcceso.objects.filter(activo=True))

    @strawberry.field
    def qr_activos_vehiculo(self, info: Info, vehiculo_id: int) -> List[QrSesionType]:
        return list(QrSesion.objects.filter(
            vehiculo_id=vehiculo_id, usado=False, fecha_expiracion__gt=timezone.now()
        ))

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


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class AccesoMutation:
    @strawberry.mutation
    def generar_qr(self, info: Info, input: GenerarQrInput) -> QrSesionType:
        from apps.vehiculos.models import Vehiculo
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if vehiculo.estado == "sancionado":
            raise Exception("Vehículo sancionado, no puede generar QR")
        codigo_hash = hashlib.sha256(f"{vehiculo.placa}-{uuid.uuid4()}".encode()).hexdigest()
        horas = max(1, min(input.horas_validez or 8, 24))
        return QrSesion.objects.create(
            vehiculo=vehiculo,
            codigo_hash=codigo_hash,
            fecha_expiracion=timezone.now() + timedelta(hours=horas),
        )

    @strawberry.mutation
    def registrar_acceso(self, info: Info, input: ValidarAccesoInput) -> RegistroAccesoType:
        if input.tipo not in ["entrada", "salida"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida")
        punto = PuntoAcceso.objects.filter(pk=input.punto_acceso_id, activo=True).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado o inactivo")
        qr_sesion = pase_temporal = vehiculo = None
        qr = QrSesion.objects.filter(codigo_hash=input.codigo, usado=False).select_related("vehiculo").first()
        if qr:
            if qr.fecha_expiracion <= timezone.now():
                raise Exception("QR expirado")
            qr.usado = True
            qr.save()
            qr_sesion = qr
            vehiculo = qr.vehiculo
        else:
            pase = PaseTemporal.objects.filter(codigo=input.codigo).first()
            if pase:
                ahora = timezone.now()
                if not (pase.activo and pase.valido_desde <= ahora <= pase.valido_hasta and pase.usos_actual < pase.usos_max):
                    raise Exception("Pase temporal inválido o expirado")
                pase.usos_actual += 1
                pase.save()
                pase_temporal = pase
                vehiculo = pase.vehiculo
            else:
                raise Exception("Código QR o pase temporal no válido")
        registrado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        return RegistroAcceso.objects.create(
            punto_acceso=punto, vehiculo=vehiculo, qr_sesion=qr_sesion,
            pase_temporal=pase_temporal, tipo=input.tipo, registrado_por=registrado_por,
        )

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
            usos_max=input.usos_max or 1, generado_por=generado_por,
        )

    @strawberry.mutation
    def crear_punto_acceso(self, info: Info, nombre: str, tipo: str, ubicacion: Optional[str] = "") -> PuntoAccesoType:
        if tipo not in ["entrada", "salida", "ambos"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida, ambos")
        return PuntoAcceso.objects.create(nombre=nombre, tipo=tipo, ubicacion=ubicacion or "")
