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
    foto = models.ImageField(upload_to="vehiculos/fotos/", blank=True, null=True)
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
        indexes = [models.Index(fields=["codigo_qr"])]

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
