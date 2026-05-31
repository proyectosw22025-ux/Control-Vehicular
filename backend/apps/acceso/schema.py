import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
import hashlib
import uuid
from django.utils import timezone
from datetime import timedelta

from .models import PuntoAcceso, QrSesion, PaseTemporal, RegistroAcceso, AuditLog, AlertaAcceso
from datetime import date


def _validar_transicion_acceso(vehiculo, tipo_solicitado: str) -> None:
    """
    Máquina de estados para accesos: entrada → salida → entrada → salida...

    Reglas:
      - 'entrada': se bloquea si el último registro es también 'entrada'
                   (el vehículo ya está adentro)
      - 'salida':  se bloquea si no hay registros previos O el último ya fue 'salida'
                   (el vehículo no está adentro — no puede salir)

    Aplica a QR y manual para garantizar consistencia en toda la capa de dominio.
    """
    ultimo = (
        RegistroAcceso.objects
        .filter(vehiculo=vehiculo)
        .order_by("-timestamp")
        .values("tipo")
        .first()
    )

    if tipo_solicitado == "entrada":
        if ultimo and ultimo["tipo"] == "entrada":
            raise Exception(
                f"El vehículo {vehiculo.placa} ya está dentro del campus. "
                "Registre la salida antes de permitir una nueva entrada."
            )
    elif tipo_solicitado == "salida":
        if not ultimo:
            raise Exception(
                f"El vehículo {vehiculo.placa} no tiene registros de entrada. "
                "No se puede registrar una salida sin una entrada previa."
            )
        if ultimo["tipo"] == "salida":
            raise Exception(
                f"El vehículo {vehiculo.placa} ya está fuera del campus. "
                "No se puede registrar una salida si el vehículo no ingresó."
            )
from .utils import log_audit


@strawberry.type
class PuntoAccesoType:
    id: int
    nombre: str
    ubicacion: str
    tipo: str
    activo: bool

    @strawberry.field
    def lat(self) -> Optional[float]:
        return float(self.latitud) if self.latitud is not None else None

    @strawberry.field
    def lng(self) -> Optional[float]:
        return float(self.longitud) if self.longitud is not None else None


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

    @strawberry.field
    def tipo_vehiculo(self) -> Optional[str]:
        if self.vehiculo and self.vehiculo.tipo_id:
            return self.vehiculo.tipo.nombre
        return None

    @strawberry.field
    def marca_modelo(self) -> Optional[str]:
        if self.vehiculo:
            return f"{self.vehiculo.marca} {self.vehiculo.modelo}".strip()
        return None

    @strawberry.field
    def alertas_detectadas(self) -> List["AlertaAccesoType"]:
        """Alertas activas detectadas para este vehículo en el momento del registro."""
        return getattr(self, "_alertas_detectadas", [])


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
class VehiculoTemporalType:
    id:           int
    placa:        str
    tipo:         str
    destino:      str
    responsable:  str
    hora_ingreso: datetime
    hora_limite:  datetime
    hora_salida:  Optional[datetime]
    activo:       bool
    observacion:  str

    @strawberry.field
    def tipo_display(self) -> str:
        from apps.acceso.models import VehiculoTemporal as _VT
        return dict(_VT.TIPOS).get(self.tipo, self.tipo)

    @strawberry.field
    def minutos_restantes(self) -> int:
        delta = self.hora_limite - timezone.now()
        return max(0, int(delta.total_seconds() / 60))

    @strawberry.field
    def vencido(self) -> bool:
        return self.activo and timezone.now() > self.hora_limite


@strawberry.type
class AlertaAccesoType:
    id: int
    tipo_anomalia: str
    severidad: str
    descripcion: str
    fecha: datetime
    fecha_analisis: date
    revisada: bool

    @strawberry.field
    def vehiculo_placa(self) -> Optional[str]:
        return self.vehiculo.placa if self.vehiculo_id else None

    @strawberry.field
    def vehiculo_id_val(self) -> Optional[int]:
        return self.vehiculo_id


def _broadcast_alerta_ws(alerta, vehiculo):
    """Envía alerta nueva al canal de notificaciones de guardias y admins."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from apps.usuarios.models import UsuarioRol

        layer = get_channel_layer()
        if not layer:
            return
        ids = (
            UsuarioRol.objects
            .filter(rol__nombre__in=["Guardia", "Administrador"])
            .values_list("usuario_id", flat=True)
            .distinct()
        )
        iconos = {"critica": "🔴", "advertencia": "🟠", "info": "🔵"}
        for uid in ids:
            async_to_sync(layer.group_send)(
                f"notificaciones_usuario_{uid}",
                {
                    "type":       "notificacion_nueva",
                    "id":         alerta.pk,
                    "titulo":     f"{iconos.get(alerta.severidad,'⚠')} Alerta — {vehiculo.placa}",
                    "mensaje":    alerta.descripcion,
                    "fecha":      alerta.fecha.isoformat(),
                    "tipo_codigo": "alerta_acceso",
                    "datos_extra": {
                        "alerta_id":     alerta.pk,
                        "tipo_anomalia": alerta.tipo_anomalia,
                        "severidad":     alerta.severidad,
                        "placa":         vehiculo.placa,
                        "descripcion":   alerta.descripcion,
                    },
                },
            )
    except Exception:
        pass


def _detectar_anomalias_acceso(vehiculo, tipo_acceso: str) -> list:
    """
    Detecta anomalías en tiempo real al registrar un acceso QR o manual.
    Crea AlertaAcceso si se encuentran, hace broadcast WS y retorna la lista.

    Detecta:
      1. Frecuencia excesiva: >3 entradas en las últimas 2 horas
      2. Multas pendientes/apeladas: vehículo con deudas activas
    """
    from datetime import timedelta
    if tipo_acceso != "entrada":
        return []

    nuevas = []
    ahora  = timezone.now()
    hoy    = ahora.date()

    # ── 1. Frecuencia excesiva de accesos ─────────────────────────────────────
    ventana   = ahora - timedelta(hours=2)
    conteo    = RegistroAcceso.objects.filter(
        vehiculo=vehiculo, tipo="entrada", timestamp__gte=ventana
    ).count()
    if conteo >= 3:
        ya_existe = AlertaAcceso.objects.filter(
            vehiculo=vehiculo,
            tipo_anomalia="frecuencia_excesiva",
            revisada=False,
            fecha__gte=ventana,
        ).exists()
        if not ya_existe:
            a = AlertaAcceso.objects.create(
                vehiculo=vehiculo,
                tipo_anomalia="frecuencia_excesiva",
                severidad="advertencia",
                descripcion=(
                    f"{vehiculo.placa} registró {conteo + 1} entradas en 2 horas — "
                    "posible uso irregular o error de registro."
                ),
                fecha_analisis=hoy,
                datos_extra={"entradas_recientes": conteo + 1},
            )
            _broadcast_alerta_ws(a, vehiculo)
            nuevas.append(a)

    # ── 2. Multas pendientes o apeladas ───────────────────────────────────────
    try:
        from apps.multas.models import Multa
        multas = Multa.objects.filter(
            vehiculo=vehiculo, estado__in=["pendiente", "apelada"]
        ).count()
        if multas > 0:
            ya_existe = AlertaAcceso.objects.filter(
                vehiculo=vehiculo,
                tipo_anomalia="vehiculo_sancionado",
                revisada=False,
                fecha__gte=ahora - timedelta(hours=24),
            ).exists()
            if not ya_existe:
                a = AlertaAcceso.objects.create(
                    vehiculo=vehiculo,
                    tipo_anomalia="vehiculo_sancionado",
                    severidad="critica",
                    descripcion=(
                        f"{vehiculo.placa} tiene {multas} multa(s) sin pagar. "
                        "El vehículo debería estar sancionado."
                    ),
                    fecha_analisis=hoy,
                    datos_extra={"multas_pendientes": multas},
                )
                _broadcast_alerta_ws(a, vehiculo)
                nuevas.append(a)
    except Exception:
        pass

    return nuevas


def _sincronizar_rastreo(vehiculo, punto, tipo_acceso: str, registro, propietario):
    """
    Vincula el registro de acceso QR con el sistema de rastreo en vivo.
    Entrada → el vehículo aparece en el mapa en la portería usada.
    Salida  → el vehículo desaparece del mapa.
    """
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        from apps.acceso.models import UbicacionVehiculo

        layer = get_channel_layer()
        if not layer:
            return

        propietario_nombre = (
            f"{propietario.nombre} {propietario.apellido}" if propietario else "—"
        )
        propietario_id = propietario.pk if propietario else 0
        tipo_vehiculo  = vehiculo.tipo.nombre if vehiculo.tipo else "Automóvil"

        if tipo_acceso == "entrada":
            # Colocar el vehículo en el mapa en la portería de entrada
            UbicacionVehiculo.objects.update_or_create(
                vehiculo=vehiculo,
                defaults={
                    "latitud":  punto.latitud,
                    "longitud": punto.longitud,
                    "velocidad": 0.0,
                    "activo":   True,
                },
            )
            evento = {
                "type":            "evento_acceso",
                "vehiculo_id":     vehiculo.pk,
                "placa":           vehiculo.placa,
                "evento":          "entrada",
                "punto_acceso":    punto.nombre,
                "lat":             float(punto.latitud),
                "lng":             float(punto.longitud),
                "timestamp":       registro.timestamp.isoformat(),
                "propietario":     propietario_nombre,
                "propietario_id":  propietario_id,
                "tipo_vehiculo":   tipo_vehiculo,
                "fuente":          "qr",
            }
        else:
            # Desactivar rastreo al salir
            UbicacionVehiculo.objects.filter(vehiculo=vehiculo).update(activo=False)
            evento = {
                "type":            "evento_acceso",
                "vehiculo_id":     vehiculo.pk,
                "placa":           vehiculo.placa,
                "evento":          "salida",
                "punto_acceso":    punto.nombre,
                "lat":             float(punto.latitud) if punto.latitud else None,
                "lng":             float(punto.longitud) if punto.longitud else None,
                "timestamp":       registro.timestamp.isoformat(),
                "propietario":     propietario_nombre,
                "propietario_id":  propietario_id,
                "tipo_vehiculo":   tipo_vehiculo,
                "fuente":          "qr",
            }

        async_to_sync(layer.group_send)("rastreo_campus", evento)
        if propietario_id:
            async_to_sync(layer.group_send)(f"rastreo_usuario_{propietario_id}", evento)
    except Exception:
        pass   # El rastreo es auxiliar — no debe romper el registro de acceso


@strawberry.type
class AccesoQuery:
    @strawberry.field
    def puntos_acceso(self, info: Info) -> List[PuntoAccesoType]:
        return list(PuntoAcceso.objects.filter(activo=True))

    @strawberry.field
    def qr_delegaciones_vehiculo(self, info: Info, vehiculo_id: int) -> List[QrDelegacionType]:
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        vehiculo = __import__("apps.vehiculos.models", fromlist=["Vehiculo"]).Vehiculo.objects.filter(pk=vehiculo_id).first()
        if not vehiculo:
            return []
        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes ver las delegaciones de tus propios vehículos")
        return list(QrSesion.objects.filter(
            vehiculo_id=vehiculo_id, usado=False, fecha_expiracion__gt=timezone.now()
        ).select_related("vehiculo").order_by("-fecha_generacion"))

    @strawberry.field
    def mis_delegaciones(self, info: Info) -> List[QrDelegacionType]:
        """
        Todas las delegaciones vigentes (no usadas, no expiradas) del usuario
        autenticado, agrupadas por sus vehículos.
        """
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        return list(
            QrSesion.objects
            .select_related("vehiculo")
            .filter(
                vehiculo__propietario=user,
                usado=False,
                fecha_expiracion__gt=timezone.now(),
            )
            .order_by("-fecha_generacion")
        )

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

    @strawberry.field
    def vehiculos_temporales_activos(
        self, info: Info
    ) -> List[VehiculoTemporalType]:
        """Vehículos temporales actualmente en campus — solo Guardia y Admin."""
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.models import VehiculoTemporal
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores")
        return list(
            VehiculoTemporal.objects
            .filter(activo=True)
            .select_related("registrado_por")
            .order_by("hora_limite")
        )

    @strawberry.field
    def alertas_activas_panel(
        self, info: Info, limite: int = 30
    ) -> List[AlertaAccesoType]:
        """
        Alertas no revisadas de las últimas 24h — panel del guardia en tiempo real.
        Ordenadas: critica → advertencia → info.
        Acceso: Guardia y Administrador.
        """
        from apps.usuarios.utils import tiene_rol
        from datetime import timedelta
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores")
        desde = timezone.now() - timedelta(hours=24)
        alertas = list(
            AlertaAcceso.objects
            .filter(revisada=False, fecha__gte=desde)
            .select_related("vehiculo")
            .order_by("-fecha")[:limite]
        )
        orden = {"critica": 0, "advertencia": 1, "info": 2}
        alertas.sort(key=lambda a: orden.get(a.severidad, 3))
        return alertas

    @strawberry.field
    def alertas_acceso(
        self,
        info: Info,
        revisadas: bool = False,
        limite: int = 50,
    ) -> List[AlertaAccesoType]:
        """Anomalías de acceso detectadas por el análisis diario — solo admin."""
        from apps.usuarios.utils import tiene_rol
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden ver las alertas de acceso")
        return list(
            AlertaAcceso.objects
            .filter(revisada=revisadas)
            .select_related("vehiculo", "revisada_por")
            .order_by("-fecha")[:limite]
        )

    @strawberry.field
    def conteo_alertas_acceso(self, info: Info) -> int:
        """Número de alertas sin revisar — para badge en Dashboard."""
        from apps.usuarios.utils import tiene_rol
        if not tiene_rol(info.context.request.user, "Administrador"):
            return 0
        return AlertaAcceso.objects.filter(revisada=False).count()

    @strawberry.field
    def mis_accesos(
        self,
        info: Info,
        limite: int = 50,
        tipo: Optional[str] = None,
    ) -> List[RegistroAccesoType]:
        """
        Historial de entradas y salidas del usuario autenticado.
        Filtra por los vehículos de los que es propietario.
        Disponible para cualquier usuario registrado.
        """
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        qs = (
            RegistroAcceso.objects
            .select_related("punto_acceso", "vehiculo__tipo")
            .filter(vehiculo__propietario=user)
            .order_by("-timestamp")
        )
        if tipo in ("entrada", "salida"):
            qs = qs.filter(tipo=tipo)

        return list(qs[:min(limite, 200)])


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class AccesoMutation:
    @strawberry.mutation
    def generar_qr_delegacion(self, info: Info, input: GenerarQrDelegacionInput) -> QrDelegacionType:
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        vehiculo = Vehiculo.objects.select_related("propietario").filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")

        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes generar QR de delegación para tus propios vehículos")

        if vehiculo.estado == "pendiente":
            raise Exception("Vehículo pendiente de aprobación, no puede generar QR de delegación")
        if vehiculo.estado == "sancionado":
            raise Exception("Vehículo sancionado, no puede generar QR de delegación")
        if vehiculo.estado == "inactivo":
            raise Exception("Vehículo inactivo, no puede generar QR de delegación")

        if not input.motivo.strip():
            raise Exception("El motivo de la delegación es obligatorio")

        codigo_hash = hashlib.sha256(f"{vehiculo.placa}-{uuid.uuid4()}".encode()).hexdigest()
        horas = max(1, min(input.horas_validez or 24, 168))

        qr = QrSesion.objects.create(
            vehiculo=vehiculo,
            codigo_hash=codigo_hash,
            motivo=input.motivo.strip(),
            fecha_expiracion=timezone.now() + timedelta(hours=horas),
            generado_por=user,
        )
        log_audit(
            user, "qr_delegacion_generado",
            f"QR temporal generado para {vehiculo.placa} — {horas}h — motivo: {input.motivo[:60]}",
            request=info.context.request,
        )
        return qr

    @strawberry.mutation
    def revocar_qr_delegacion(self, info: Info, qr_id: int) -> bool:
        """
        Revoca (invalida) un QR de delegación activo antes de que sea usado.
        Solo el propietario del vehículo o un administrador puede revocar.
        """
        from apps.usuarios.utils import tiene_rol

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        qr = QrSesion.objects.select_related("vehiculo__propietario").filter(pk=qr_id).first()
        if not qr:
            raise Exception("Delegación no encontrada")

        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_personal and qr.vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes revocar delegaciones de tus propios vehículos")

        if qr.usado:
            raise Exception("Este QR ya fue utilizado y no puede revocarse")

        # Forzar expiración inmediata — no eliminamos para mantener trazabilidad
        qr.fecha_expiracion = timezone.now() - timedelta(seconds=1)
        qr.save(update_fields=["fecha_expiracion"])
        log_audit(
            user, "qr_delegacion_revocada",
            f"QR #{qr_id} revocado para {qr.vehiculo.placa}",
            request=info.context.request,
        )
        return True

    @strawberry.mutation
    def registrar_acceso(self, info: Info, input: ValidarAccesoInput) -> RegistroAccesoType:
        """
        Registra la entrada o salida de un vehículo mediante QR.
        Delega la validación del código al servicio AccesoService,
        que maneja concurrencia con select_for_update y caché Redis.
        """
        from .services import resolver_codigo

        if input.tipo not in ["entrada", "salida"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida")

        punto = PuntoAcceso.objects.filter(pk=input.punto_acceso_id, activo=True).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado o inactivo")

        # Resolver código — maneja TOTP, delegación y pase temporal de forma atómica
        resultado = resolver_codigo(input.codigo)

        # Validar transición de estado (entrada/salida) — máquina de estados completa
        if resultado.vehiculo:
            _validar_transicion_acceso(resultado.vehiculo, input.tipo)

        registrado_por = info.context.request.user if info.context.request.user.is_authenticated else None

        registro = RegistroAcceso.objects.create(
            punto_acceso=punto,
            vehiculo=resultado.vehiculo,
            qr_delegacion=resultado.qr_delegacion,
            pase_temporal=resultado.pase_temporal,
            tipo=input.tipo,
            metodo_acceso=resultado.metodo_acceso,
            registrado_por=registrado_por,
        )

        log_audit(
            registrado_por,
            "registrar_acceso",
            f"{input.tipo.capitalize()} de {resultado.vehiculo.placa} en {punto.nombre} vía {resultado.metodo_acceso}",
            request=info.context.request,
        )

        propietario = getattr(resultado.vehiculo, "propietario", None)

        # ── Fix 2: Al registrar SALIDA, cerrar automáticamente la SesionParqueo activa ──
        # El espacio debe liberarse cuando el vehículo sale del campus, no solo
        # cuando el guardia lo hace manualmente desde el módulo de Parqueos.
        if input.tipo == "salida" and resultado.vehiculo:
            from apps.parqueos.models import SesionParqueo as _SP
            sesion_activa = (
                _SP.objects
                .select_related("espacio")
                .filter(vehiculo=resultado.vehiculo, estado="activa")
                .first()
            )
            if sesion_activa:
                sesion_activa.hora_salida = timezone.now()
                sesion_activa.estado = "cerrada"
                sesion_activa.save(update_fields=["hora_salida", "estado"])
                sesion_activa.espacio.estado = "disponible"
                sesion_activa.espacio.save(update_fields=["estado"])
                log_audit(
                    registrado_por, "sesion_parqueo_auto_cerrada",
                    f"Sesión de {resultado.vehiculo.placa} cerrada automáticamente al registrar salida QR",
                    request=info.context.request,
                )

        if propietario:
            from apps.notificaciones.utils import enviar_notificacion
            accion = "entró a" if input.tipo == "entrada" else "salió de"
            enviar_notificacion(
                usuario=propietario,
                titulo=f"Vehículo {accion} la universidad",
                mensaje=f"{resultado.vehiculo.placa} registró {input.tipo} en {punto.nombre}.",
                tipo_codigo="acceso_vehiculo",
            )
            # Fix 3: Incluir vehiculo_id en datos_extra para que el frontend
            # pueda pre-seleccionar el vehículo en el demo de guía de parqueo.
            if input.tipo == "entrada":
                enviar_notificacion(
                    usuario=propietario,
                    titulo=f"🏫 Bienvenido al campus — {resultado.vehiculo.placa}",
                    mensaje="¿Deseas orientación para encontrar un lugar de estacionamiento disponible?",
                    tipo_codigo="orientacion_parqueo",
                    datos_extra={
                        "vehiculo_id":     resultado.vehiculo.pk,
                        "placa":           resultado.vehiculo.placa,
                        "punto_acceso":    punto.nombre,
                        "punto_acceso_id": punto.pk,
                        "punto_lat":       float(punto.latitud) if punto.latitud is not None else None,
                        "punto_lng":       float(punto.longitud) if punto.longitud is not None else None,
                    },
                )

        # ── Detección de anomalías en tiempo real ─────────────────────────────
        # Detecta frecuencia excesiva y multas pendientes; crea AlertaAcceso
        # y hace broadcast WS a guardias. El response incluye las alertas.
        alertas_detectadas: list = []
        if resultado.vehiculo:
            # Alertas existentes no revisadas para este vehículo
            alertas_existentes = list(
                AlertaAcceso.objects
                .filter(vehiculo=resultado.vehiculo, revisada=False)
                .select_related("vehiculo")
                .order_by("-severidad", "-fecha")[:5]
            )
            # Detectar nuevas anomalías en tiempo real
            alertas_nuevas = _detectar_anomalias_acceso(resultado.vehiculo, input.tipo)
            alertas_detectadas = alertas_existentes + alertas_nuevas

            # Auto-observación si hay alertas críticas
            if any(a.severidad == "critica" for a in alertas_detectadas):
                criticas_desc = "; ".join(
                    a.descripcion[:60] for a in alertas_detectadas if a.severidad == "critica"
                )
                registro.observacion = f"Entrada con alertas críticas: {criticas_desc}"
                registro.save(update_fields=["observacion"])

        registro._alertas_detectadas = alertas_detectadas

        # ── Rastreo en vivo: sincronizar estado del vehículo en el mapa ──────
        if resultado.vehiculo and punto.latitud is not None:
            _sincronizar_rastreo(resultado.vehiculo, punto, input.tipo, registro, propietario)

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
        if vehiculo.estado == "pendiente":
            raise Exception("Vehículo pendiente de aprobación. No puede ingresar hasta ser aprobado por el administrador.")
        if vehiculo.estado == "sancionado":
            raise Exception("Vehículo sancionado. No puede ingresar hasta regularizar sus multas.")
        if vehiculo.estado == "inactivo":
            raise Exception("Vehículo inactivo. Contacte a la administración.")

        # Validar transición de estado (entrada/salida) — máquina de estados completa
        _validar_transicion_acceso(vehiculo, input.tipo)

        registrado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        registro = RegistroAcceso.objects.create(
            punto_acceso=punto,
            vehiculo=vehiculo,
            tipo=input.tipo,
            metodo_acceso="manual",
            observacion=input.observacion or "",
            registrado_por=registrado_por,
        )
        log_audit(
            registrado_por,
            "acceso_manual",
            f"{input.tipo.capitalize()} manual de {vehiculo.placa} en {punto.nombre}",
            request=info.context.request,
        )

        # Fix 2: cerrar SesionParqueo activa también en acceso manual de SALIDA
        if input.tipo == "salida":
            from apps.parqueos.models import SesionParqueo as _SP
            sesion = _SP.objects.select_related("espacio").filter(vehiculo=vehiculo, estado="activa").first()
            if sesion:
                sesion.hora_salida = timezone.now()
                sesion.estado = "cerrada"
                sesion.save(update_fields=["hora_salida", "estado"])
                sesion.espacio.estado = "disponible"
                sesion.espacio.save(update_fields=["estado"])

        # Detección de anomalías (manual — misma lógica que acceso QR)
        alertas_detectadas: list = []
        alertas_existentes = list(
            AlertaAcceso.objects
            .filter(vehiculo=vehiculo, revisada=False)
            .select_related("vehiculo")
            .order_by("-severidad", "-fecha")[:5]
        )
        alertas_nuevas = _detectar_anomalias_acceso(vehiculo, input.tipo)
        alertas_detectadas = alertas_existentes + alertas_nuevas
        registro._alertas_detectadas = alertas_detectadas

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
    def crear_punto_acceso(
        self, info: Info, nombre: str, tipo: str,
        ubicacion: Optional[str] = "",
        latitud: Optional[float] = None,
        longitud: Optional[float] = None,
    ) -> PuntoAccesoType:
        if tipo not in ["entrada", "salida", "ambos"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida, ambos")
        return PuntoAcceso.objects.create(
            nombre=nombre, tipo=tipo, ubicacion=ubicacion or "",
            latitud=latitud, longitud=longitud,
        )

    @strawberry.mutation
    def actualizar_coords_punto_acceso(
        self, info: Info, punto_id: int,
        latitud: float, longitud: float,
        ubicacion: Optional[str] = None,
    ) -> PuntoAccesoType:
        """Actualiza las coordenadas GPS de una portería existente."""
        punto = PuntoAcceso.objects.filter(pk=punto_id).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado")
        punto.latitud  = latitud
        punto.longitud = longitud
        if ubicacion is not None:
            punto.ubicacion = ubicacion
        punto.save(update_fields=["latitud", "longitud"] + (["ubicacion"] if ubicacion is not None else []))
        return punto

    # ── Acceso temporal de proveedores y vehículos externos ──────────────────

    @strawberry.mutation
    def registrar_acceso_temporal(
        self, info: Info,
        placa:        str,
        tipo:         str,
        destino:      str,
        duracion_horas: float,
        responsable:  Optional[str] = "",
        observacion:  Optional[str] = "",
    ) -> "VehiculoTemporalType":
        """
        Registra un vehículo externo (proveedor, mantenimiento, emergencia).
        Solo Guardia y Admin. La placa no necesita estar en el sistema.
        Genera alerta automática si el vehículo no sale al vencer el tiempo.
        """
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.models import VehiculoTemporal
        from datetime import timedelta

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores pueden registrar acceso temporal")

        tipos_validos = [t[0] for t in VehiculoTemporal.TIPOS]
        if tipo not in tipos_validos:
            raise Exception(f"Tipo inválido. Opciones: {', '.join(tipos_validos)}")

        duracion_horas = max(0.5, min(float(duracion_horas), 8.0))  # 30min mínimo, 8h máximo
        placa_upper = placa.strip().upper()

        if not placa_upper:
            raise Exception("La placa es obligatoria")

        # Regla: una placa no puede tener más de un acceso temporal activo
        if VehiculoTemporal.objects.filter(placa=placa_upper, activo=True).exists():
            raise Exception(f"El vehículo {placa_upper} ya tiene un acceso temporal activo")

        # Advertir si la placa coincide con un vehículo registrado en el sistema
        from apps.vehiculos.models import Vehiculo
        veh_registrado = Vehiculo.objects.filter(placa=placa_upper).first()
        nota = ""
        if veh_registrado:
            nota = f"Nota: {placa_upper} está registrado en el sistema (propietario: {veh_registrado.propietario}). "

        hora_limite = timezone.now() + timedelta(hours=duracion_horas)

        vt = VehiculoTemporal.objects.create(
            placa=placa_upper,
            tipo=tipo,
            destino=destino.strip(),
            responsable=(responsable or "").strip(),
            hora_limite=hora_limite,
            observacion=(nota + (observacion or "")).strip(),
            registrado_por=user,
        )

        # Buscar punto de acceso actual del guardia (desde localStorage no aplica en backend)
        # Se usa el primer punto activo como referencia para el RegistroAcceso
        punto = PuntoAcceso.objects.filter(activo=True).first()
        if punto:
            RegistroAcceso.objects.create(
                punto_acceso=punto,
                vehiculo=None,
                tipo="entrada",
                metodo_acceso="temporal",
                observacion=f"Acceso temporal — {vt.get_tipo_display()} — {vt.destino}",
                registrado_por=user,
            )

        log_audit(user, "acceso_temporal_entrada",
                  f"Acceso temporal: {placa_upper} ({vt.get_tipo_display()}) hasta {hora_limite:%H:%M}",
                  request=info.context.request)

        # Lanzar Celery task que alerta al guardia cuando vence el tiempo
        try:
            from apps.acceso.tasks import vigilar_vencimiento_temporal
            vigilar_vencimiento_temporal.apply_async(
                args=[vt.pk, False],
                eta=hora_limite,
            )
            vigilar_vencimiento_temporal.apply_async(
                args=[vt.pk, True],
                eta=hora_limite + timedelta(minutes=30),
            )
        except Exception:
            pass  # Celery no disponible — la BD ya tiene el registro

        return vt

    @strawberry.mutation
    def registrar_salida_temporal(
        self, info: Info, placa: str, observacion: Optional[str] = ""
    ) -> "VehiculoTemporalType":
        """Registra la salida de un vehículo temporal por placa."""
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.models import VehiculoTemporal

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores pueden registrar salida temporal")

        placa_upper = placa.strip().upper()
        vt = VehiculoTemporal.objects.filter(placa=placa_upper, activo=True).first()
        if not vt:
            raise Exception(f"No hay acceso temporal activo para la placa {placa_upper}")

        vt.activo     = False
        vt.hora_salida = timezone.now()
        if observacion:
            vt.observacion = f"{vt.observacion} | Salida: {observacion}".strip(" |")
        vt.save(update_fields=["activo", "hora_salida", "observacion"])

        punto = PuntoAcceso.objects.filter(activo=True).first()
        if punto:
            RegistroAcceso.objects.create(
                punto_acceso=punto,
                vehiculo=None,
                tipo="salida",
                metodo_acceso="temporal",
                observacion=f"Salida temporal — {vt.get_tipo_display()} — {vt.destino}",
                registrado_por=user,
            )

        log_audit(user, "acceso_temporal_salida",
                  f"Salida temporal: {placa_upper} ({vt.get_tipo_display()})",
                  request=info.context.request)
        return vt

    @strawberry.mutation
    def marcar_alerta_revisada(self, info: Info, alerta_id: int) -> AlertaAccesoType:
        """Marca una alerta de acceso como revisada — Guardia y Admin."""
        from apps.usuarios.utils import tiene_rol
        admin = info.context.request.user
        if not (tiene_rol(admin, "Administrador") or tiene_rol(admin, "Guardia")):
            raise Exception("Solo guardias y administradores pueden revisar alertas")
        alerta = AlertaAcceso.objects.select_related("vehiculo").filter(pk=alerta_id).first()
        if not alerta:
            raise Exception("Alerta no encontrada")
        alerta.revisada = True
        alerta.revisada_por = admin
        alerta.fecha_revision = timezone.now()
        alerta.save(update_fields=["revisada", "revisada_por", "fecha_revision"])
        return alerta
