import hashlib
import hmac
import secrets
import struct
import time
import uuid
from django.db import models
from django.conf import settings

QR_INTERVAL = 30  # segundos por ventana TOTP


def _totp_para_ventana(secret: str, ventana: int) -> str:
    """Calcula el código TOTP para una ventana de tiempo específica."""
    key = bytes.fromhex(secret) if len(secret) == 64 else secret.encode()
    msg = struct.pack(">Q", ventana)
    h = hmac.new(key, msg, hashlib.sha256).digest()
    offset = h[-1] & 0x0F
    code = struct.unpack(">I", h[offset: offset + 4])[0] & 0x7FFFFFFF
    return str(code % 100_000_000).zfill(8)


def generar_qr_dinamico(secret: str) -> tuple[str, int]:
    """
    Retorna (codigo_actual, segundos_restantes).
    El código es válido hasta que cambie la ventana de tiempo.
    """
    ahora = time.time()
    ventana = int(ahora) // QR_INTERVAL
    segundos_restantes = QR_INTERVAL - int(ahora) % QR_INTERVAL
    return _totp_para_ventana(secret, ventana), segundos_restantes


def validar_qr_dinamico(secret: str, codigo: str, tolerancia: int = 1) -> bool:
    """
    Valida un código TOTP. Permite ±tolerancia ventanas para compensar
    desfase de reloj entre el dispositivo del guardia y el servidor.
    Un código válido solo sirve para un vehículo: el que tiene ese secret.
    """
    ventana = int(time.time()) // QR_INTERVAL
    for delta in range(-tolerancia, tolerancia + 1):
        if _totp_para_ventana(secret, ventana + delta) == str(codigo).zfill(8):
            return True
    return False


class TipoVehiculo(models.Model):
    nombre = models.CharField(max_length=60, unique=True)
    descripcion = models.TextField(blank=True)

    class Meta:
        db_table = "tipos_vehiculo"
        verbose_name = "Tipo de vehículo"
        verbose_name_plural = "Tipos de vehículo"

    def __str__(self):
        return self.nombre


class Vehiculo(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente de aprobación"),
        ("activo", "Activo"),
        ("inactivo", "Inactivo"),
        ("sancionado", "Sancionado"),
    ]

    placa = models.CharField(max_length=20, unique=True)
    tipo = models.ForeignKey(
        TipoVehiculo, on_delete=models.PROTECT, related_name="vehiculos"
    )
    propietario = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="vehiculos"
    )
    marca = models.CharField(max_length=60)
    modelo = models.CharField(max_length=60)
    anio = models.PositiveSmallIntegerField()
    color = models.CharField(max_length=40)
    estado = models.CharField(max_length=15, choices=ESTADOS, default="pendiente")
    # ── Alerta de seguridad (lista negra) — ORTOGONAL al estado ─────────────
    # Un vehículo robado o con acceso revocado puede estar 'activo' y a la vez
    # 'en_alerta'. No se mezcla con `estado` a propósito: son ejes distintos.
    # Al escanearse en el portón dispara una AlertaAcceso crítica y deniega el
    # acceso con un mensaje de seguridad, dejando registrado el intento.
    en_alerta     = models.BooleanField(default=False, db_index=True)
    motivo_alerta = models.CharField(max_length=200, blank=True)
    # Carril express: vehículos frecuentes (docentes/administrativos de planta).
    # El guardia los despacha de inmediato con un indicador visual, sin pasos
    # extra — descongestiona el carril general en hora pico.
    es_frecuente  = models.BooleanField(default=False, db_index=True)
    foto = models.ImageField(upload_to="vehiculos/fotos/", blank=True, null=True)
    # ── Campos extendidos (todos opcionales, backward-compatible) ──────────
    numero_motor    = models.CharField(max_length=30, blank=True)
    numero_chasis   = models.CharField(max_length=30, blank=True)
    num_puertas     = models.PositiveSmallIntegerField(null=True, blank=True)
    cilindrada      = models.CharField(max_length=10, blank=True)
    color_hex       = models.CharField(max_length=7, blank=True)
    foto_vehiculo   = models.URLField(blank=True)
    numero_soat     = models.CharField(max_length=30, blank=True)
    capacidad_carga = models.CharField(max_length=20, blank=True)
    # ───────────────────────────────────────────────────────────────────────
    codigo_qr = models.CharField(
        max_length=64, unique=True, blank=True,
        help_text="Hash SHA-256 estático (legacy). Se mantiene para compatibilidad con QrSesion.",
    )
    qr_secret = models.CharField(
        max_length=64, blank=True,
        help_text="Clave secreta para QR dinámico TOTP. NUNCA se expone al cliente directamente.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vehiculos"
        verbose_name = "Vehículo"
        verbose_name_plural = "Vehículos"
        indexes = [
            models.Index(fields=["codigo_qr"]),
            models.Index(fields=["estado"],     name="vehiculos_estado_idx"),
            models.Index(fields=["created_at"], name="vehiculos_created_at_idx"),
        ]

    def save(self, *args, **kwargs):
        if not self.codigo_qr:
            self.codigo_qr = hashlib.sha256(
                f"{self.placa}-{uuid.uuid4()}".encode()
            ).hexdigest()
        if not self.qr_secret:
            self.qr_secret = secrets.token_hex(32)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.placa} - {self.marca} {self.modelo} ({self.anio})"


class DocumentoVehiculo(models.Model):
    TIPOS = [
        ("soat", "SOAT"),
        ("tecnica", "Revisión técnica"),
        ("circulacion", "Permiso de circulación"),
        ("otro", "Otro"),
    ]

    vehiculo = models.ForeignKey(
        Vehiculo, on_delete=models.CASCADE, related_name="documentos"
    )
    tipo_doc = models.CharField(max_length=15, choices=TIPOS)
    numero = models.CharField(max_length=60)
    fecha_vencimiento = models.DateField()
    archivo = models.FileField(upload_to="vehiculos/documentos/", blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "documentos_vehiculo"
        verbose_name = "Documento de vehículo"
        verbose_name_plural = "Documentos de vehículo"

    def __str__(self):
        return f"{self.vehiculo.placa} - {self.get_tipo_doc_display()}"


class VehiculoEstadoHistorial(models.Model):
    """Rastrea cada cambio de estado de un Vehiculo con motivo y responsable."""
    vehiculo        = models.ForeignKey(Vehiculo, on_delete=models.CASCADE, related_name="historial_estados")
    estado_anterior = models.CharField(max_length=15, blank=True)
    estado_nuevo    = models.CharField(max_length=15)
    motivo          = models.TextField(blank=True)
    usuario         = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="cambios_estado_vehiculo",
    )
    fecha = models.DateTimeField(default=None)  # set in pre_save signal; editable allows migration override

    class Meta:
        db_table = "vehiculo_estado_historial"
        ordering = ["-fecha"]
        verbose_name = "Historial de estado"
        verbose_name_plural = "Historial de estados"

    def __str__(self):
        return f"{self.vehiculo.placa}: {self.estado_anterior or '∅'} → {self.estado_nuevo}"

    def save(self, *args, **kwargs):
        if self.fecha is None:
            from django.utils import timezone
            self.fecha = timezone.now()
        super().save(*args, **kwargs)


class HistorialPropietario(models.Model):
    vehiculo = models.ForeignKey(
        Vehiculo, on_delete=models.CASCADE, related_name="historial_propietarios"
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="historial_vehiculos",
    )
    fecha_inicio = models.DateField()
    fecha_fin = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "historial_propietarios"
        verbose_name = "Historial de propietario"
        verbose_name_plural = "Historial de propietarios"
        ordering = ["-fecha_inicio"]

    def __str__(self):
        return f"{self.vehiculo.placa} → {self.usuario} desde {self.fecha_inicio}"


# ── Señales: trazabilidad de cambios de estado ────────────────────────────
from django.db.models.signals import pre_save, post_save  # noqa: E402
from django.dispatch import receiver  # noqa: E402


@receiver(pre_save, sender=Vehiculo)
def _capturar_estado_previo(sender, instance, **kwargs):
    """Captura el estado actual antes del save para compararlo después."""
    if instance.pk:
        instance._estado_anterior = (
            Vehiculo.objects.values_list("estado", flat=True)
            .filter(pk=instance.pk)
            .first()
        )
    else:
        instance._estado_anterior = None


@receiver(post_save, sender=Vehiculo)
def _registrar_cambio_estado(sender, instance, created, **kwargs):
    """Crea un VehiculoEstadoHistorial cuando el estado del Vehiculo cambia."""
    update_fields = kwargs.get("update_fields")
    # Saltar si se guardaron otros campos pero no 'estado'
    if not created and update_fields is not None and "estado" not in update_fields:
        return
    estado_anterior = getattr(instance, "_estado_anterior", None) or ""
    if created or estado_anterior != instance.estado:
        VehiculoEstadoHistorial.objects.create(
            vehiculo=instance,
            estado_anterior=estado_anterior,
            estado_nuevo=instance.estado,
            motivo=getattr(instance, "_cambio_motivo", "Vehículo registrado" if created else ""),
            usuario=getattr(instance, "_cambio_usuario", None),
        )
