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


def _ultimo_tipo_acceso(vehiculo) -> "str | None":
    """Tipo del último registro de acceso del vehículo, o None si nunca tuvo."""
    ultimo = (
        RegistroAcceso.objects
        .filter(vehiculo=vehiculo)
        .order_by("-timestamp", "-pk")  # -pk desempata timestamps idénticos
        .values("tipo")
        .first()
    )
    return ultimo["tipo"] if ultimo else None


def _inferir_tipo_acceso(vehiculo) -> str:
    """
    Modo "Auto": deduce si este acceso es entrada o salida según el estado real
    del vehículo (su último registro). Si está dentro → toca salir; si está
    fuera o nunca entró → toca entrar. Elimina el toggle manual del guardia y
    los errores de dirección en hora pico (la causa #1 de colas a contraflujo).
    """
    return "salida" if _ultimo_tipo_acceso(vehiculo) == "entrada" else "entrada"


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
    ultimo_tipo = _ultimo_tipo_acceso(vehiculo)
    ultimo = {"tipo": ultimo_tipo} if ultimo_tipo else None

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
class DestinatarioSuggestionType:
    """Resultado de búsqueda para autocompletar el destinatario en delegaciones."""
    id: int
    ci: str
    nombre_completo: str
    roles: str  # "Docente", "Estudiante", "Administrador", etc.


@strawberry.type
class QrDelegacionType:
    id: int
    codigo_hash: str
    motivo: str
    tipo_delegacion: str
    usos_max: int
    usos_actual: int
    tipo_destinatario: str
    destinatario_nombre: str
    destinatario_ci: str
    fecha_generacion: datetime
    fecha_expiracion: datetime

    @strawberry.field
    def usado(self) -> bool:
        """Compatibilidad: True cuando todos los usos fueron consumidos."""
        return self.usos_actual >= self.usos_max

    @strawberry.field
    def usos_restantes(self) -> int:
        return self.usos_restantes  # propiedad del modelo

    @strawberry.field
    def tipo_delegacion_display(self) -> str:
        labels = {"entrada": "Solo entrada", "salida": "Solo salida", "ambos": "Entrada y salida"}
        return labels.get(self.tipo_delegacion, self.tipo_delegacion)

    @strawberry.field
    def placa_vehiculo(self) -> str:
        return self.vehiculo.placa

    @strawberry.field
    def vigente(self) -> bool:
        return self.vigente  # propiedad del modelo

    @strawberry.field
    def url_qr(self) -> str:
        return self.url_qr  # propiedad del modelo

    @strawberry.field
    def destinatario_display(self) -> str:
        return self.destinatario_display  # propiedad del modelo


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
    def imagen_url(self) -> Optional[str]:
        """Foto-evidencia del acceso (frame del OCR), si se capturó."""
        return self.imagen_url or None

    @strawberry.field
    def es_frecuente(self) -> bool:
        """Vehículo de carril express — el guardia lo despacha de inmediato."""
        return bool(getattr(self.vehiculo, "es_frecuente", False)) if self.vehiculo else False

    @strawberry.field
    def propietario_nombre(self) -> Optional[str]:
        """Nombre del dueño registrado — el guardia verifica de un vistazo."""
        p = getattr(self.vehiculo, "propietario", None) if self.vehiculo else None
        return f"{p.nombre} {p.apellido}".strip() if p else None

    @strawberry.field
    def propietario_foto_url(self) -> Optional[str]:
        """
        Foto del dueño registrado para verificación visual de identidad en el
        portón (¿quien conduce es el dueño?). Cero fricción: solo se muestra.
        """
        p = getattr(self.vehiculo, "propietario", None) if self.vehiculo else None
        return (getattr(p, "foto_url", "") or None) if p else None

    @strawberry.field
    def propietario_rol(self) -> Optional[str]:
        """
        Rol del dueño (Estudiante / Docente / Personal Administrativo) para que el
        guardia identifique de inmediato el tipo de miembro en el portón. Prioriza
        el rol de identidad universitaria cuando el usuario tiene varios.
        """
        p = getattr(self.vehiculo, "propietario", None) if self.vehiculo else None
        if not p:
            return None
        nombres = [ur.rol.nombre for ur in p.usuario_roles.select_related("rol").all()]
        for preferido in ("Docente", "Estudiante", "Personal Administrativo",
                          "Guardia", "Administrador"):
            if preferido in nombres:
                return preferido
        return nombres[0] if nombres else None

    @strawberry.field
    def alertas_detectadas(self) -> List["AlertaAccesoType"]:
        """Alertas activas detectadas para este vehículo en el momento del registro."""
        return getattr(self, "_alertas_detectadas", [])

    @strawberry.field
    def destinatario_delegacion(self) -> Optional[str]:
        """
        Para QR de delegación: muestra quién estaba autorizado a usar el pase.
        Ej: 'Carlos Pérez · CI: 7654321 [Miembro UAGRM]'
        El guardia usa este dato para verificar la identidad del conductor.
        """
        return getattr(self, "_destinatario_delegacion", None)

    @strawberry.field
    def espacio_sugerido(self) -> Optional["EspacioSugeridoType"]:
        """
        Tras una ENTRADA, primer espacio libre compatible con el rol del
        propietario — para que el guardia lo asigne con un toque desde la
        misma tarjeta de confirmación, sin navegar al módulo de Parqueos.
        """
        return getattr(self, "_espacio_sugerido", None)


@strawberry.type
class EspacioSugeridoType:
    espacio_id: int
    numero: str
    zona_nombre: str
    categoria_nombre: str
    vehiculo_id: int


@strawberry.type
class VehiculoEnCampusType:
    """Vehículo que sigue dentro del campus (último acceso = entrada)."""
    vehiculo_id: int
    placa: str
    marca_modelo: str
    propietario_nombre: str
    propietario_telefono: str
    hora_entrada: datetime
    espacio_parqueo: Optional[str]  # "Zona B #07" o None si no tiene sesión activa


@strawberry.type
class MetricaQrPermanenteType:
    """Uso del QR permanente legacy — para decidir su deprecación."""
    dias: int
    total_accesos: int
    accesos_qr_permanente: int
    porcentaje: float
    habilitado: bool


@strawberry.type
class AforoCampusType:
    """Control de aforo: vehículos dentro vs. capacidad máxima."""
    dentro: int
    maximo: int          # 0 = sin límite configurado
    porcentaje: float    # 0 si no hay límite
    estado: str          # disponible | alto | lleno | sin_limite


@strawberry.type
class MetricaDespachoType:
    """
    Throughput del portón — sustenta con datos que NO se generan colas.
    'segundos_mediana' = tiempo típico entre dos vehículos consecutivos.
    """
    punto_nombre: str
    total_accesos: int
    segundos_mediana: Optional[int]   # mediana del intervalo entre accesos
    accesos_por_hora: float           # promedio en la ventana
    hora_pico: Optional[int]          # hora (0-23) con más accesos


def _contar_vehiculos_en_campus() -> int:
    """Vehículos cuyo último registro de acceso es 'entrada' (siguen dentro)."""
    from django.db.models import OuterRef, Subquery
    return (
        RegistroAcceso.objects
        .filter(vehiculo__isnull=False, tipo="entrada")
        .filter(pk=Subquery(
            RegistroAcceso.objects
            .filter(vehiculo=OuterRef("vehiculo"))
            .order_by("-timestamp", "-pk")
            .values("pk")[:1]
        ))
        .count()
    )


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
    tipo_delegacion: Optional[str] = "ambos"      # "entrada" | "salida" | "ambos"
    tipo_destinatario: Optional[str] = "externo"  # "externo" | "registrado"
    destinatario_nombre: Optional[str] = ""
    destinatario_ci: Optional[str] = ""


@strawberry.input
class ValidarAccesoInput:
    punto_acceso_id: int
    codigo: str
    tipo: str  # "entrada" | "salida" | "auto" (el backend infiere la dirección)


@strawberry.input
class AccesoManualInput:
    punto_acceso_id: int
    placa: str
    tipo: str  # "entrada" | "salida" | "auto"
    observacion: Optional[str] = ""
    imagen_evidencia: Optional[str] = None  # frame base64 del OCR (opcional)


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
class AutorizacionAccesoExternoType:
    id:               int
    placa:            str
    empresa:          str
    motivo:           str
    email_proveedor:  str
    valido_desde:     datetime
    valido_hasta:     datetime
    codigo_acceso:    str
    activo:           bool
    usado:            bool
    usos_max:         int
    usos_actual:      int
    email_enviado:    bool
    fecha_creacion:   datetime
    observacion:      str

    @strawberry.field
    def usos_restantes(self) -> int:
        return max(0, self.usos_max - self.usos_actual)

    @strawberry.field
    def dependencia_nombre(self) -> Optional[str]:
        return self.dependencia.nombre if self.dependencia_id else None

    @strawberry.field
    def dependencia_ubicacion(self) -> Optional[str]:
        return self.dependencia.ubicacion if self.dependencia_id else None

    @strawberry.field
    def autorizado_por_nombre(self) -> str:
        if self.autorizado_por_id:
            p = self.autorizado_por
            return f"{p.nombre} {p.apellido}"
        return "—"

    @strawberry.field
    def vigente(self) -> bool:
        return (
            self.activo and not self.usado
            and self.valido_desde <= timezone.now() <= self.valido_hasta
        )

    @strawberry.field
    def estado(self) -> str:
        if not self.activo:
            return "revocada"
        if self.usado:
            return "usada"
        ahora = timezone.now()
        if ahora < self.valido_desde:
            return "pendiente"
        if ahora > self.valido_hasta:
            return "vencida"
        return "vigente"

    @strawberry.field
    def url_verificacion(self) -> str:
        from django.conf import settings
        base = getattr(settings, "FRONTEND_URL",
                       "https://control-vehicular-six.vercel.app")
        return f"{base}/autorizacion/{self.codigo_acceso}"


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

    @strawberry.field
    def espacio_parqueo(self) -> Optional[str]:
        """Espacio de parqueo asignado a este temporal, o None — para el panel."""
        from apps.parqueos.models import SesionParqueo
        sesion = (
            SesionParqueo.objects
            .select_related("espacio__zona")
            .filter(vehiculo_temporal_id=self.id, estado="activa")
            .first()
        )
        return f"{sesion.espacio.zona.nombre} #{sesion.espacio.numero}" if sesion else None


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


def _subir_evidencia_async(registro_id: int, imagen_b64: str) -> None:
    """
    Sube el frame de evidencia a Cloudinary en un hilo daemon y guarda la URL
    en el RegistroAcceso. NUNCA bloquea el registro de acceso (anti-cola): si
    falla o Cloudinary no está configurado, el acceso ya quedó registrado igual.
    """
    import threading
    from django.conf import settings

    if not getattr(settings, "_cloudinary_configurado", False):
        return

    def _worker():
        try:
            import cloudinary.uploader
            data = imagen_b64 if imagen_b64.startswith("data:") else f"data:image/jpeg;base64,{imagen_b64}"
            res = cloudinary.uploader.upload(
                data, folder="accesos_evidencia", resource_type="image",
            )
            url = res.get("secure_url") or res.get("url")
            if url:
                RegistroAcceso.objects.filter(pk=registro_id).update(imagen_url=url)
        except Exception:
            pass  # la evidencia es best-effort; el acceso ya está registrado

    threading.Thread(target=_worker, daemon=True).start()


def _verificar_alerta_seguridad(vehiculo, punto, registrado_por, request) -> None:
    """
    Si el vehículo está en la lista de alerta de seguridad (robo/búsqueda):
    crea una AlertaAcceso CRÍTICA en tiempo real (broadcast a guardias), audita
    el intento y DENIEGA el acceso con un mensaje de seguridad específico.

    Llamado al inicio de registrar_acceso / registrar_acceso_manual. La alerta
    queda como registro del intento aunque el acceso se deniegue.
    """
    from datetime import timedelta
    if not vehiculo or not getattr(vehiculo, "en_alerta", False):
        return
    motivo = vehiculo.motivo_alerta or "Vehículo reportado / acceso restringido"
    # Evitar spam de alertas idénticas en una ventana corta.
    ya_existe = AlertaAcceso.objects.filter(
        vehiculo=vehiculo, tipo_anomalia="vehiculo_en_alerta",
        revisada=False, fecha__gte=timezone.now() - timedelta(minutes=10),
    ).exists()
    if not ya_existe:
        alerta = AlertaAcceso.objects.create(
            vehiculo=vehiculo,
            tipo_anomalia="vehiculo_en_alerta",
            severidad="critica",
            descripcion=(
                f"⚠ {vehiculo.placa} EN ALERTA DE SEGURIDAD: {motivo}. "
                f"Intento de acceso en {punto.nombre}. Dé aviso a seguridad."
            ),
            fecha_analisis=timezone.now().date(),
            datos_extra={"motivo": motivo, "punto": punto.nombre},
        )
        _broadcast_alerta_ws(alerta, vehiculo)
    log_audit(
        registrado_por, "acceso_denegado_alerta",
        f"Acceso DENEGADO a {vehiculo.placa} (alerta de seguridad: {motivo}) en {punto.nombre}",
        request=request,
    )
    raise Exception(
        f"⚠ VEHÍCULO EN ALERTA DE SEGURIDAD: {motivo}. "
        "Acceso denegado — dé aviso a seguridad de inmediato."
    )


def _detectar_anomalias_acceso(vehiculo, tipo_acceso: str) -> list:
    """
    Detecta anomalías en tiempo real al registrar un acceso QR o manual.
    Crea AlertaAcceso si se encuentran, hace broadcast WS y retorna la lista.

    Detecta:
      1. Frecuencia excesiva: >3 entradas en las últimas 2 horas
      2. Sanciones pendientes: vehículo con deudas activas
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

    # ── 2. Sanciones pendientes ────────────────────────────────────────────────
    try:
        from apps.multas.models import Sancion
        sanciones = Sancion.objects.filter(
            infraccion__vehiculo=vehiculo, estado__in=["pendiente", "en_revision"]
        ).count()
        if sanciones > 0:
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
                        f"{vehiculo.placa} tiene {sanciones} sanción(es) sin cumplir. "
                        "El vehículo debería estar sancionado."
                    ),
                    fecha_analisis=hoy,
                    datos_extra={"sanciones_pendientes": sanciones},
                )
                _broadcast_alerta_ws(a, vehiculo)
                nuevas.append(a)
    except Exception:
        pass

    # ── 3. Documentos vencidos (SOAT, técnica, circulación) ────────────────────
    # La universidad no debería permitir circular en su campus un vehículo sin
    # SOAT vigente. No bloqueamos el ingreso (alertamos, no fiscalizamos tránsito),
    # pero el guardia debe enterarse en garita — antes era invisible para él.
    try:
        from apps.vehiculos.models import DocumentoVehiculo
        vencidos = list(
            DocumentoVehiculo.objects.filter(
                vehiculo=vehiculo, fecha_vencimiento__lt=hoy
            ).order_by("fecha_vencimiento")
        )
        if vencidos:
            ya_existe = AlertaAcceso.objects.filter(
                vehiculo=vehiculo,
                tipo_anomalia="documento_vencido",
                revisada=False,
                fecha__gte=ahora - timedelta(hours=24),
            ).exists()
            if not ya_existe:
                detalle = ", ".join(
                    f"{d.get_tipo_doc_display()} (venció {d.fecha_vencimiento:%d/%m/%Y})"
                    for d in vencidos[:3]
                )
                # Crítico si algún documento lleva más de 30 días vencido.
                dias_max = max((hoy - d.fecha_vencimiento).days for d in vencidos)
                severidad = "critica" if dias_max > 30 else "advertencia"
                a = AlertaAcceso.objects.create(
                    vehiculo=vehiculo,
                    tipo_anomalia="documento_vencido",
                    severidad=severidad,
                    descripcion=f"{vehiculo.placa} circula con documento(s) vencido(s): {detalle}.",
                    fecha_analisis=hoy,
                    datos_extra={"documentos_vencidos": len(vencidos), "dias_max_vencido": dias_max},
                )
                _broadcast_alerta_ws(a, vehiculo)
                nuevas.append(a)
    except Exception:
        pass

    return nuevas


def _sugerir_espacio_parqueo(vehiculo):
    """
    Primer espacio disponible compatible con el rol del propietario, priorizando
    espacios cuya categoría coincide con su rol. Devuelve un EspacioSugeridoType
    o None. Se llama tras una entrada para ofrecer asignación de un toque.
    """
    try:
        from apps.parqueos.models import EspacioParqueo, SesionParqueo
        from apps.parqueos.schema import _motivo_incompatibilidad_categoria

        # Si el vehículo ya tiene sesión activa, no sugerir.
        if SesionParqueo.objects.filter(vehiculo=vehiculo, estado="activa").exists():
            return None

        libres = (
            EspacioParqueo.objects
            .filter(estado="disponible", zona__activo=True)
            .select_related("zona", "categoria")
            .order_by("zona__nombre", "numero")
        )
        # Primer espacio sin incompatibilidad de categoría (rol del propietario).
        elegido = next(
            (e for e in libres if _motivo_incompatibilidad_categoria(e, vehiculo) is None),
            None,
        )
        if not elegido:
            return None
        return EspacioSugeridoType(
            espacio_id=elegido.id,
            numero=elegido.numero,
            zona_nombre=elegido.zona.nombre,
            categoria_nombre=elegido.categoria.nombre,
            vehiculo_id=vehiculo.id,
        )
    except Exception:
        return None


def _enviar_email_autorizacion_async(auth) -> None:
    """Envía por email el QR de acceso al proveedor en un hilo daemon."""
    import threading
    from django.conf import settings

    def _enviar():
        try:
            from apps.notificaciones.utils import _enviar_email_sync
            from apps.notificaciones.email_templates import email_autorizacion_externa
            base = getattr(settings, "FRONTEND_URL",
                           "https://control-vehicular-six.vercel.app")
            url = f"{base}/autorizacion/{auth.codigo_acceso}"
            dep_nombre = auth.dependencia.nombre if auth.dependencia else "Campus UAGRM"
            asunto, html = email_autorizacion_externa(
                empresa       = auth.empresa,
                placa         = auth.placa,
                dependencia   = dep_nombre,
                motivo        = auth.motivo,
                valido_desde  = auth.valido_desde.strftime("%d/%m/%Y %H:%M"),
                valido_hasta  = auth.valido_hasta.strftime("%d/%m/%Y %H:%M"),
                codigo        = auth.codigo_acceso,
                url           = url,
            )
            _enviar_email_sync(
                auth.email_proveedor, asunto,
                f"Su código de acceso es: {auth.codigo_acceso}\n{url}",
                html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


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
        from django.db.models import F
        return list(QrSesion.objects.filter(
            vehiculo_id=vehiculo_id,
            fecha_expiracion__gt=timezone.now(),
            usos_actual__lt=F("usos_max"),
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
        from django.db.models import F
        return list(
            QrSesion.objects
            .select_related("vehiculo")
            .filter(
                vehiculo__propietario=user,
                fecha_expiracion__gt=timezone.now(),
                usos_actual__lt=F("usos_max"),
            )
            .order_by("-fecha_generacion")
        )

    @strawberry.field
    def buscar_destinatario_uagrm(self, info: Info, query: str) -> List[DestinatarioSuggestionType]:
        """
        Busca miembros UAGRM registrados por CI o nombre para autocompletar
        el destinatario de una delegación. Devuelve máximo 6 resultados.
        Requiere al menos 2 caracteres de búsqueda.
        """
        from apps.usuarios.models import Usuario
        from django.db.models import Q

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        q = query.strip()
        if len(q) < 2:
            return []

        usuarios = (
            Usuario.objects
            .filter(
                Q(ci__icontains=q)
                | Q(nombre__icontains=q)
                | Q(apellido__icontains=q),
                is_active=True,
            )
            .prefetch_related("usuario_roles__rol")
            .exclude(pk=user.pk)  # no se delega a sí mismo
            [:6]
        )

        resultado = []
        for u in usuarios:
            roles_nombres = [ur.rol.nombre for ur in u.usuario_roles.all()]
            roles_str = ", ".join(roles_nombres) if roles_nombres else "Sin rol"
            resultado.append(DestinatarioSuggestionType(
                id=u.pk,
                ci=u.ci,
                nombre_completo=f"{u.nombre} {u.apellido}",
                roles=roles_str,
            ))
        return resultado

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
    def vehiculos_en_campus(self, info: Info) -> List["VehiculoEnCampusType"]:
        """
        Parte de control: vehículos cuyo último registro de acceso es ENTRADA
        (siguen dentro). Para el corte de jornada del guardia y la pregunta
        "¿qué queda adentro?". Incluye espacio de parqueo y hora de ingreso.
        Solo Guardia/Administrador.
        """
        from apps.usuarios.utils import tiene_rol
        from django.db.models import OuterRef, Subquery
        from apps.parqueos.models import SesionParqueo
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores pueden ver el parte de campus")

        # Último tipo de acceso por vehículo, vía subconsulta correlacionada.
        ultimo_tipo = (
            RegistroAcceso.objects
            .filter(vehiculo=OuterRef("vehiculo"))
            .order_by("-timestamp", "-pk")
            .values("tipo")[:1]
        )
        # Registros que SON el último de su vehículo y son entrada.
        dentro = (
            RegistroAcceso.objects
            .filter(vehiculo__isnull=False, tipo="entrada")
            .annotate(_ult=Subquery(ultimo_tipo))
            .filter(_ult="entrada")
            .filter(pk=Subquery(
                RegistroAcceso.objects
                .filter(vehiculo=OuterRef("vehiculo"))
                .order_by("-timestamp", "-pk")
                .values("pk")[:1]
            ))
            .select_related("vehiculo__propietario")
            .order_by("timestamp")
        )

        # Sesiones de parqueo activas por vehículo (un solo query).
        sesiones = {
            s.vehiculo_id: s
            for s in SesionParqueo.objects.filter(estado="activa").select_related("espacio__zona")
        }

        resultado = []
        for reg in dentro:
            v = reg.vehiculo
            sesion = sesiones.get(v.id)
            espacio_txt = (
                f"{sesion.espacio.zona.nombre} #{sesion.espacio.numero}"
                if sesion else None
            )
            prop = v.propietario
            resultado.append(VehiculoEnCampusType(
                vehiculo_id=v.id,
                placa=v.placa,
                marca_modelo=f"{v.marca} {v.modelo}".strip(),
                propietario_nombre=f"{prop.nombre} {prop.apellido}" if prop else "—",
                propietario_telefono=getattr(prop, "telefono", "") or "",
                hora_entrada=reg.timestamp,
                espacio_parqueo=espacio_txt,
            ))
        return resultado

    @strawberry.field
    def aforo_campus(self, info: Info) -> AforoCampusType:
        """
        Vehículos dentro del campus vs. capacidad máxima configurada. Para el
        semáforo de aforo del guardia (seguridad/evacuación y evitar colas de
        salida cuando ya no caben). Solo Guardia/Administrador.
        """
        from django.conf import settings as _settings
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores pueden ver el aforo")

        dentro = _contar_vehiculos_en_campus()
        maximo = int(getattr(_settings, "AFORO_MAXIMO_CAMPUS", 0) or 0)
        if maximo <= 0:
            return AforoCampusType(dentro=dentro, maximo=0, porcentaje=0.0, estado="sin_limite")
        pct = round(dentro / maximo * 100, 1)
        estado = "lleno" if dentro >= maximo else ("alto" if pct >= 85 else "disponible")
        return AforoCampusType(dentro=dentro, maximo=maximo, porcentaje=pct, estado=estado)

    @strawberry.field
    def metricas_despacho(self, info: Info, dias: int = 7) -> List[MetricaDespachoType]:
        """
        Tiempo de despacho por punto de acceso en los últimos N días: cuánto
        tarda en promedio entre un vehículo y el siguiente (mediana del intervalo)
        y la hora pico. Responde con datos a "¿cuánto agilizaron el acceso?".
        Solo Guardia/Administrador.
        """
        import statistics
        from collections import Counter
        from datetime import timedelta
        from apps.usuarios.utils import tiene_rol
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores pueden ver estas métricas")

        desde = timezone.now() - timedelta(days=max(1, dias))
        horas_ventana = max(1, dias) * 24
        resultado = []
        for punto in PuntoAcceso.objects.filter(activo=True):
            ts = list(
                RegistroAcceso.objects
                .filter(punto_acceso=punto, timestamp__gte=desde)
                .order_by("timestamp")
                .values_list("timestamp", flat=True)
            )
            total = len(ts)
            if total == 0:
                continue
            # Intervalos entre accesos consecutivos (en segundos).
            deltas = [
                (ts[i] - ts[i - 1]).total_seconds()
                for i in range(1, total)
                if (ts[i] - ts[i - 1]).total_seconds() < 3600  # ignora pausas largas (noche)
            ]
            mediana = int(statistics.median(deltas)) if deltas else None
            # Hora pico (en zona horaria local).
            horas = Counter(timezone.localtime(t).hour for t in ts)
            pico = horas.most_common(1)[0][0] if horas else None
            resultado.append(MetricaDespachoType(
                punto_nombre=punto.nombre,
                total_accesos=total,
                segundos_mediana=mediana,
                accesos_por_hora=round(total / horas_ventana, 2),
                hora_pico=pico,
            ))
        return resultado

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
    def metricas_qr_permanente(self, info: Info, dias: int = 30) -> "MetricaQrPermanenteType":
        """
        Cuántos accesos de los últimos N días usaron el QR permanente (legacy)
        vs. el total. Informa la decisión de deprecarlo: si el porcentaje es
        marginal, se puede apagar (QR_PERMANENTE_HABILITADO=False) sin afectar
        prácticamente a nadie. Solo Administrador.
        """
        from datetime import timedelta
        from django.conf import settings as _settings
        from apps.usuarios.utils import tiene_rol
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden ver estas métricas")
        desde = timezone.now() - timedelta(days=dias)
        base = RegistroAcceso.objects.filter(timestamp__gte=desde)
        total = base.count()
        permanente = base.filter(metodo_acceso="qr_permanente").count()
        pct = round(permanente / total * 100, 1) if total else 0.0
        return MetricaQrPermanenteType(
            dias=dias,
            total_accesos=total,
            accesos_qr_permanente=permanente,
            porcentaje=pct,
            habilitado=getattr(_settings, "QR_PERMANENTE_HABILITADO", True),
        )

    @strawberry.field
    def autorizaciones_externas(
        self, info: Info, solo_activas: bool = True
    ) -> List[AutorizacionAccesoExternoType]:
        """Lista de autorizaciones externas — Admin y Guardia."""
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.models import AutorizacionAccesoExterno
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")):
            raise Exception("Solo admins y guardias")
        qs = AutorizacionAccesoExterno.objects.select_related(
            "dependencia", "autorizado_por"
        )
        if solo_activas:
            qs = qs.filter(activo=True)
        return list(qs.order_by("-fecha_creacion")[:100])

    @strawberry.field
    def verificar_autorizacion_externa(
        self, info: Info, codigo: str
    ) -> Optional[AutorizacionAccesoExternoType]:
        """Query pública — el proveedor verifica su autorización sin login."""
        from apps.acceso.models import AutorizacionAccesoExterno
        return (
            AutorizacionAccesoExterno.objects
            .filter(codigo_acceso=codigo.strip().upper())
            .select_related("dependencia", "autorizado_por")
            .first()
        )

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

        tipos_validos = {"entrada", "salida", "ambos"}
        tipo_del = (input.tipo_delegacion or "ambos").lower()
        if tipo_del not in tipos_validos:
            raise Exception("tipo_delegacion debe ser 'entrada', 'salida' o 'ambos'")

        # "ambos" permite 2 usos (uno para entrar, otro para salir)
        usos_max = 2 if tipo_del == "ambos" else 1
        horas = max(1, min(input.horas_validez or 24, 168))

        codigo_hash = hashlib.sha256(f"{vehiculo.placa}-{uuid.uuid4()}".encode()).hexdigest()

        # Validar destinatario
        tipo_dest = (input.tipo_destinatario or "externo").lower()
        if tipo_dest not in ("externo", "registrado"):
            raise Exception("tipo_destinatario debe ser 'externo' o 'registrado'")

        dest_nombre = (input.destinatario_nombre or "").strip()
        dest_ci     = (input.destinatario_ci or "").strip()

        if tipo_dest == "registrado":
            # Para miembro UAGRM: el CI es obligatorio y debe existir en el sistema
            if not dest_ci:
                raise Exception("Para un Miembro UAGRM debes ingresar su CI.")
            from apps.usuarios.models import Usuario as _Usuario
            dest_user = _Usuario.objects.filter(ci=dest_ci, is_active=True).first()
            if not dest_user:
                raise Exception(f"No se encontró ningún miembro activo con CI '{dest_ci}'.")
            # Llenar nombre desde el perfil si no se proporcionó
            if not dest_nombre:
                dest_nombre = dest_user.nombre_completo

        qr = QrSesion.objects.create(
            vehiculo=vehiculo,
            codigo_hash=codigo_hash,
            motivo=input.motivo.strip(),
            tipo_delegacion=tipo_del,
            usos_max=usos_max,
            usos_actual=0,
            fecha_expiracion=timezone.now() + timedelta(hours=horas),
            generado_por=user,
            tipo_destinatario=tipo_dest,
            destinatario_nombre=dest_nombre,
            destinatario_ci=dest_ci,
        )
        tipo_label = {"entrada": "solo entrada", "salida": "solo salida", "ambos": "entrada y salida"}
        dest_log = f" → {dest_nombre}" if dest_nombre else ""
        log_audit(
            user, "qr_delegacion_generado",
            f"QR temporal generado para {vehiculo.placa} — {tipo_label[tipo_del]} — {horas}h — {input.motivo[:60]}{dest_log}",
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

        if qr.usos_actual >= qr.usos_max:
            raise Exception("Este QR ya fue completamente utilizado y no puede revocarse")

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
        from apps.usuarios.utils import tiene_rol

        # El QR es la credencial del vehículo, pero quien lo escanea debe ser
        # personal de portón identificado. Sin esto, cualquiera que fotografíe
        # un QR (p.ej. el permanente legacy, que es estático) podría registrar
        # entradas/salidas remotamente y sin responsable en auditoría.
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida para registrar accesos")
        if not (tiene_rol(user, "Guardia") or tiene_rol(user, "Administrador")):
            raise Exception("Solo guardias y administradores pueden registrar accesos por QR")

        if input.tipo not in ["entrada", "salida", "auto"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida, auto")

        punto = PuntoAcceso.objects.filter(pk=input.punto_acceso_id, activo=True).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado o inactivo")

        # Resolver código — maneja TOTP, delegación y pase temporal de forma atómica.
        # En modo "auto" no validamos la dirección de la delegación antes de
        # resolver (aún no conocemos el vehículo); la derivamos justo después.
        tipo_para_resolver = None if input.tipo == "auto" else input.tipo
        resultado = resolver_codigo(input.codigo, tipo_acceso=tipo_para_resolver)

        # ── Modo "Auto": el backend deduce entrada/salida ──────────────────
        # - QR de delegación de una sola vía → esa es la dirección (su propósito).
        # - Resto (TOTP, permanente, "ambos") → según el estado del vehículo.
        # - Autorización externa sin historial → entrada.
        if input.tipo == "auto":
            deleg = resultado.qr_delegacion
            if deleg and deleg.tipo_delegacion in ("entrada", "salida"):
                tipo_efectivo = deleg.tipo_delegacion
            elif resultado.vehiculo:
                tipo_efectivo = _inferir_tipo_acceso(resultado.vehiculo)
            else:
                tipo_efectivo = "entrada"
        else:
            tipo_efectivo = input.tipo

        # Autorización externa: la dirección la fija el conteo de usos
        # (1er uso = entrada, 2do = salida), no el toggle del guardia.
        if resultado.autorizacion_externa and resultado.tipo_forzado:
            tipo_efectivo = resultado.tipo_forzado

        # Alerta de seguridad (lista negra): si aplica, deniega y alerta a seguridad.
        _verificar_alerta_seguridad(resultado.vehiculo, punto, user, info.context.request)

        # Validar transición de estado (entrada/salida) — máquina de estados completa
        if resultado.vehiculo:
            _validar_transicion_acceso(resultado.vehiculo, tipo_efectivo)

        registrado_por = user  # siempre autenticado — todo acceso QR tiene responsable

        # ── Autorización externa: observación automática con datos del proveedor ──
        obs_extra = ""
        if resultado.autorizacion_externa:
            auth = resultado.autorizacion_externa
            dep  = auth.dependencia.nombre if auth.dependencia else "Campus"
            obs_extra = f"Acceso autorizado: {auth.empresa} ({auth.placa}) → {dep}. Auth #{auth.pk}."

        registro = RegistroAcceso.objects.create(
            punto_acceso=punto,
            vehiculo=resultado.vehiculo,
            qr_delegacion=resultado.qr_delegacion,
            pase_temporal=resultado.pase_temporal,
            tipo=tipo_efectivo,
            metodo_acceso=resultado.metodo_acceso,
            observacion=obs_extra,
            registrado_por=registrado_por,
        )

        # Inyectar destinatario para que el guardia pueda verificar la identidad
        if resultado.qr_delegacion and resultado.qr_delegacion.destinatario_nombre:
            registro._destinatario_delegacion = resultado.qr_delegacion.destinatario_display

        placa_log = (
            resultado.vehiculo.placa if resultado.vehiculo
            else (resultado.autorizacion_externa.placa if resultado.autorizacion_externa else "?")
        )
        log_audit(
            registrado_por,
            "registrar_acceso",
            f"{tipo_efectivo.capitalize()} de {placa_log} en {punto.nombre} vía {resultado.metodo_acceso}",
            request=info.context.request,
        )

        propietario = getattr(resultado.vehiculo, "propietario", None) if resultado.vehiculo else None

        # ── Fix 2: Al registrar SALIDA, cerrar automáticamente la SesionParqueo activa ──
        # El espacio debe liberarse cuando el vehículo sale del campus, no solo
        # cuando el guardia lo hace manualmente desde el módulo de Parqueos.
        if tipo_efectivo == "salida" and resultado.vehiculo:
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
                # Invalidar cache del semáforo y avisar por WS — igual que el cierre manual
                from apps.parqueos.schema import broadcast_disponibilidad
                broadcast_disponibilidad(sesion_activa.espacio.zona_id)

        if propietario:
            from apps.notificaciones.utils import enviar_notificacion
            from django.utils import timezone as _tz
            hora_str = _tz.localtime().strftime("%H:%M")
            accion   = "entró a" if tipo_efectivo == "entrada" else "salió de"

            # Notificación en app (WebSocket) — siempre
            enviar_notificacion(
                usuario=propietario,
                titulo=f"Vehículo {accion} la universidad",
                mensaje=f"{resultado.vehiculo.placa} registró {tipo_efectivo} en {punto.nombre}.",
                tipo_codigo="acceso_vehiculo",
            )

            if tipo_efectivo == "entrada":
                # Notificación de orientación de parqueo (abre modal en la app)
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

                # WhatsApp: mensaje con menú interactivo (solo si tiene WA activo)
                if getattr(propietario, "whatsapp_activo", False) and propietario.telefono:
                    from apps.notificaciones.whatsapp import enviar_whatsapp
                    from apps.notificaciones.whatsapp_bot import menu_entrada_campus, guardar_sesion
                    telefono_clean = propietario.telefono.strip()
                    texto_wa, sesion = menu_entrada_campus(
                        placa       = resultado.vehiculo.placa,
                        punto       = punto.nombre,
                        hora        = hora_str,
                        vehiculo_id = resultado.vehiculo.pk,
                    )
                    if enviar_whatsapp(telefono_clean, texto_wa):
                        # Normalizar el número para guardar la sesión
                        from apps.notificaciones.whatsapp import _normalizar_telefono_bolivia
                        chat_id = _normalizar_telefono_bolivia(telefono_clean)
                        if chat_id:
                            guardar_sesion(chat_id.replace("@c.us", ""), sesion)

        # ── Detección de anomalías en tiempo real ─────────────────────────────
        # Detecta frecuencia excesiva y sanciones pendientes; crea AlertaAcceso
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
            alertas_nuevas = _detectar_anomalias_acceso(resultado.vehiculo, tipo_efectivo)
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
            _sincronizar_rastreo(resultado.vehiculo, punto, tipo_efectivo, registro, propietario)

        return registro

    @strawberry.mutation
    def registrar_acceso_manual(self, info: Info, input: AccesoManualInput) -> RegistroAccesoType:
        import re
        from django.db.models import Value
        from django.db.models.functions import Replace
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol

        # El registro de accesos es la evidencia central del control vehicular:
        # todo acceso manual debe tener un responsable identificado. Sin login, no hay registro.
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida para registrar accesos")
        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")

        if input.tipo not in ["entrada", "salida", "auto"]:
            raise Exception("Tipo inválido. Opciones: entrada, salida, auto")
        punto = PuntoAcceso.objects.filter(pk=input.punto_acceso_id, activo=True).first()
        if not punto:
            raise Exception("Punto de acceso no encontrado o inactivo")

        # La placa registrada (tecleada por el dueño al dar de alta el vehículo) y la
        # placa detectada (siempre normalizada por el OCR al formato canónico boliviano
        # "ABC-1234") pueden diferir solo en guiones/espacios — p.ej. "ZYX123" vs "ZYX-123".
        # Comparamos ambas sin separadores para que el lookup no falle por ese desfase.
        placa_sin_separadores = re.sub(r"[^A-Z0-9]", "", input.placa.upper())
        vehiculo = (
            Vehiculo.objects
            .annotate(_placa_comparable=Replace(Replace("placa", Value("-"), Value("")), Value(" "), Value("")))
            .filter(_placa_comparable=placa_sin_separadores)
            .first()
        )
        if not vehiculo:
            raise Exception(f"Vehículo con placa {input.placa.upper()} no registrado en el sistema")

        # Guardia/Admin registran cualquier vehículo (es su función en el portón).
        # Un usuario común solo puede declarar movimientos de SUS propios vehículos
        # — evita salidas/entradas falsas sobre placas ajenas y registros sin responsable.
        if not es_personal and vehiculo.propietario_id != user.pk:
            raise Exception(
                "Solo puedes registrar accesos de tus propios vehículos. "
                "El registro manual de otros vehículos es exclusivo del personal de seguridad."
            )

        # Alerta de seguridad (lista negra): prioridad sobre los mensajes de estado.
        _verificar_alerta_seguridad(vehiculo, punto, user, info.context.request)

        if vehiculo.estado == "pendiente":
            raise Exception("Vehículo pendiente de aprobación. No puede ingresar hasta ser aprobado por el administrador.")
        if vehiculo.estado == "sancionado":
            raise Exception("Vehículo sancionado. No puede ingresar hasta regularizar sus sanciones pendientes.")
        if vehiculo.estado == "inactivo":
            raise Exception("Vehículo inactivo. Contacte a la administración.")

        # Modo "Auto": deduce entrada/salida según el estado real del vehículo.
        tipo_efectivo = _inferir_tipo_acceso(vehiculo) if input.tipo == "auto" else input.tipo

        # Validar transición de estado (entrada/salida) — máquina de estados completa
        _validar_transicion_acceso(vehiculo, tipo_efectivo)

        registrado_por = user  # siempre autenticado — todo acceso manual tiene responsable
        registro = RegistroAcceso.objects.create(
            punto_acceso=punto,
            vehiculo=vehiculo,
            tipo=tipo_efectivo,
            metodo_acceso="manual",
            observacion=input.observacion or "",
            registrado_por=registrado_por,
        )
        log_audit(
            registrado_por,
            "acceso_manual",
            f"{tipo_efectivo.capitalize()} manual de {vehiculo.placa} en {punto.nombre}",
            request=info.context.request,
        )

        # Fix 2: cerrar SesionParqueo activa también en acceso manual de SALIDA
        if tipo_efectivo == "salida":
            from apps.parqueos.models import SesionParqueo as _SP
            sesion = _SP.objects.select_related("espacio").filter(vehiculo=vehiculo, estado="activa").first()
            if sesion:
                sesion.hora_salida = timezone.now()
                sesion.estado = "cerrada"
                sesion.save(update_fields=["hora_salida", "estado"])
                sesion.espacio.estado = "disponible"
                sesion.espacio.save(update_fields=["estado"])
                # Invalidar cache del semáforo y avisar por WS — igual que el cierre manual
                from apps.parqueos.schema import broadcast_disponibilidad
                broadcast_disponibilidad(sesion.espacio.zona_id)

        # Detección de anomalías (manual — misma lógica que acceso QR)
        alertas_detectadas: list = []
        alertas_existentes = list(
            AlertaAcceso.objects
            .filter(vehiculo=vehiculo, revisada=False)
            .select_related("vehiculo")
            .order_by("-severidad", "-fecha")[:5]
        )
        alertas_nuevas = _detectar_anomalias_acceso(vehiculo, tipo_efectivo)
        alertas_detectadas = alertas_existentes + alertas_nuevas
        registro._alertas_detectadas = alertas_detectadas

        # Evidencia fotográfica (best-effort, async — no bloquea el portón).
        if input.imagen_evidencia:
            _subir_evidencia_async(registro.pk, input.imagen_evidencia)

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

    # ── Autorizaciones de acceso externo ─────────────────────────────────────

    @strawberry.mutation
    def crear_autorizacion_externa(
        self, info: Info,
        placa:           str,
        empresa:         str,
        motivo:          str,
        valido_desde:    str,    # ISO datetime string
        valido_hasta:    str,    # ISO datetime string
        dependencia_id:  Optional[int] = None,
        email_proveedor: Optional[str] = "",
        observacion:     Optional[str] = "",
    ) -> AutorizacionAccesoExternoType:
        """
        Crea una pre-autorización de acceso para un proveedor o contratista externo.
        Genera un código QR único y lo envía por email si se proporciona.
        Solo Admin y Guardia pueden crear autorizaciones.
        """
        import uuid
        from datetime import datetime as dt
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.models import AutorizacionAccesoExterno
        from django.utils.timezone import make_aware, is_aware

        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not (tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")):
            raise Exception("Solo administradores y guardias pueden crear autorizaciones")

        placa_upper = placa.strip().upper()
        if not placa_upper or not empresa.strip() or not motivo.strip():
            raise Exception("Placa, empresa y motivo son obligatorios")

        tz = timezone.get_current_timezone()

        def _parsear(val: str):
            parsed = dt.fromisoformat(val)
            return parsed if is_aware(parsed) else make_aware(parsed, tz)

        desde = _parsear(valido_desde)
        hasta = _parsear(valido_hasta)

        if hasta <= desde:
            raise Exception("La fecha de fin debe ser posterior a la de inicio")
        if hasta <= timezone.now():
            raise Exception("La autorización no puede ser para una fecha ya pasada")

        # Máximo 7 días de vigencia
        from datetime import timedelta
        if (hasta - desde) > timedelta(days=7):
            raise Exception("El período máximo de una autorización es 7 días")

        # Verificar que no haya una autorización activa para la misma placa en el mismo período
        if AutorizacionAccesoExterno.objects.filter(
            placa=placa_upper, activo=True, usado=False,
            valido_desde__lt=hasta, valido_hasta__gt=desde,
        ).exists():
            raise Exception(f"Ya existe una autorización activa para {placa_upper} en ese período")

        dependencia = None
        if dependencia_id:
            from apps.visitantes.models import DependenciaUAGRM
            dependencia = DependenciaUAGRM.objects.filter(pk=dependencia_id, activo=True).first()

        codigo = uuid.uuid4().hex[:20].upper()

        auth = AutorizacionAccesoExterno.objects.create(
            placa=placa_upper,
            empresa=empresa.strip(),
            motivo=motivo.strip(),
            dependencia=dependencia,
            email_proveedor=(email_proveedor or "").strip(),
            autorizado_por=user,
            valido_desde=desde,
            valido_hasta=hasta,
            codigo_acceso=codigo,
            observacion=(observacion or "").strip(),
        )

        # Enviar email + QR por WhatsApp al proveedor
        if auth.email_proveedor:
            _enviar_email_autorizacion_async(auth)
            auth.email_enviado = True
            auth.save(update_fields=["email_enviado"])

        # WhatsApp: si el campo email_proveedor tiene formato de teléfono boliviano
        # O si hay un número en el campo de observación → enviar QR como imagen
        # Convención: admin puede poner "+59172345678" en email_proveedor si no tiene email
        telefono_prov = auth.email_proveedor if auth.email_proveedor and not "@" in auth.email_proveedor else ""
        if telefono_prov:
            try:
                from apps.notificaciones.whatsapp import enviar_whatsapp_qr
                base = getattr(__import__('django.conf', fromlist=['settings']).settings,
                               'FRONTEND_URL', 'https://control-vehicular-six.vercel.app')
                url_auth = f"{base}/autorizacion/{auth.codigo_acceso}"
                dep_nombre = auth.dependencia.nombre if auth.dependencia else "Campus"
                desde_str  = auth.valido_desde.strftime("%d/%m %H:%M")
                hasta_str  = auth.valido_hasta.strftime("%H:%M")
                caption = (
                    f"✅ *Autorización de acceso — UAGRM*\n"
                    f"Empresa: {auth.empresa}\n"
                    f"Placa: *{auth.placa}*\n"
                    f"Destino: {dep_nombre}\n"
                    f"Válido: {desde_str} - {hasta_str}\n"
                    f"Muestra este QR al guardia en portería."
                )
                enviar_whatsapp_qr(telefono_prov, auth.codigo_acceso, caption)
            except Exception:
                pass

        log_audit(
            user, "autorizacion_externa_creada",
            f"Auth externa: {placa_upper} — {empresa} "
            f"({desde.strftime('%d/%m %H:%M')} - {hasta.strftime('%d/%m %H:%M')})",
            request=info.context.request,
        )
        return auth

    @strawberry.mutation
    def revocar_autorizacion_externa(
        self, info: Info, auth_id: int
    ) -> AutorizacionAccesoExternoType:
        """Revoca una autorización activa — solo Admin."""
        from apps.usuarios.utils import tiene_rol
        from apps.acceso.models import AutorizacionAccesoExterno
        user = info.context.request.user
        if not tiene_rol(user, "Administrador") and not tiene_rol(user, "Guardia"):
            raise Exception("Solo admins y guardias pueden revocar autorizaciones")
        auth = AutorizacionAccesoExterno.objects.filter(pk=auth_id, activo=True).first()
        if not auth:
            raise Exception("Autorización no encontrada o ya revocada")
        auth.activo = False
        auth.observacion = (auth.observacion + " | Revocada manualmente").strip(" |")
        auth.save(update_fields=["activo", "observacion"])
        log_audit(user, "autorizacion_externa_revocada",
                  f"Revocada auth #{auth_id} — {auth.empresa} ({auth.placa})",
                  request=info.context.request)
        return auth

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

        # Si el temporal tenía un espacio de parqueo asignado, liberarlo.
        from apps.parqueos.models import SesionParqueo as _SP
        sesion = _SP.objects.select_related("espacio").filter(
            vehiculo_temporal=vt, estado="activa"
        ).first()
        if sesion:
            sesion.hora_salida = timezone.now()
            sesion.estado = "cerrada"
            sesion.save(update_fields=["hora_salida", "estado"])
            sesion.espacio.estado = "disponible"
            sesion.espacio.save(update_fields=["estado"])
            from apps.parqueos.schema import broadcast_disponibilidad
            broadcast_disponibilidad(sesion.espacio.zona_id)

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
