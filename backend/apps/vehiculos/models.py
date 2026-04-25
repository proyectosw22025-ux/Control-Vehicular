import hashlib
import uuid
from django.db import models
from django.conf import settings


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
    estado = models.CharField(max_length=15, choices=ESTADOS, default="activo")
    foto = models.ImageField(upload_to="vehiculos/fotos/", blank=True, null=True)
    codigo_qr = models.CharField(
        max_length=64, unique=True, blank=True,
        help_text="Hash SHA-256 generado al registrar el vehículo. Funciona mientras estado=activo.",
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
