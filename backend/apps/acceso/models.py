from django.db import models
from django.conf import settings
from django.utils import timezone


class PuntoAcceso(models.Model):
    TIPOS = [
        ("entrada", "Entrada"),
        ("salida", "Salida"),
        ("ambos", "Entrada y Salida"),
    ]

    nombre = models.CharField(max_length=80)
    ubicacion = models.CharField(max_length=150, blank=True)
    tipo = models.CharField(max_length=8, choices=TIPOS, default="ambos")
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = "puntos_acceso"
        verbose_name = "Punto de acceso"
        verbose_name_plural = "Puntos de acceso"

    def __str__(self):
        return f"{self.nombre} ({self.get_tipo_display()})"


class QrSesion(models.Model):
    """
    QR de delegación: el dueño autoriza a otra persona a ingresar su vehículo
    por un período limitado. El acceso diario normal usa el codigo_qr permanente
    del modelo Vehiculo — este registro es solo para casos de delegación temporal.
    """
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.CASCADE, related_name="qr_delegaciones"
    )
    codigo_hash = models.CharField(max_length=64, unique=True)
    motivo = models.CharField(
        max_length=150, blank=True,
        help_text="Razón de la delegación (préstamo a familiar, autorización especial, etc.)",
    )
    fecha_generacion = models.DateTimeField(auto_now_add=True)
    fecha_expiracion = models.DateTimeField()
    usado = models.BooleanField(default=False)
    generado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="qr_delegaciones_generados",
    )

    class Meta:
        db_table = "qr_delegaciones"
        verbose_name = "QR de delegación"
        verbose_name_plural = "QR de delegaciones"
        indexes = [models.Index(fields=["codigo_hash"])]

    def __str__(self):
        return f"QR delegación {self.vehiculo.placa} - exp: {self.fecha_expiracion}"

    @property
    def vigente(self):
        return not self.usado and self.fecha_expiracion > timezone.now()


class PaseTemporal(models.Model):
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pases_temporales",
    )
    visitante = models.ForeignKey(
        "visitantes.Visitante",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="pases_temporales",
    )
    codigo = models.CharField(max_length=20, unique=True)
    valido_desde = models.DateTimeField()
    valido_hasta = models.DateTimeField()
    usos_max = models.PositiveSmallIntegerField(default=1)
    usos_actual = models.PositiveSmallIntegerField(default=0)
    activo = models.BooleanField(default=True)
    generado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="pases_generados",
    )

    class Meta:
        db_table = "pases_temporales"
        verbose_name = "Pase temporal"
        verbose_name_plural = "Pases temporales"

    def __str__(self):
        return f"Pase {self.codigo} (válido hasta {self.valido_hasta})"

    @property
    def vigente(self):
        ahora = timezone.now()
        return (
            self.activo
            and self.valido_desde <= ahora <= self.valido_hasta
            and self.usos_actual < self.usos_max
        )


class RegistroAcceso(models.Model):
    TIPOS = [
        ("entrada", "Entrada"),
        ("salida", "Salida"),
    ]
    METODOS = [
        ("qr_dinamico",  "QR dinámico TOTP (seguro, caduca cada 30s)"),
        ("qr_permanente","QR permanente del vehículo (legacy)"),
        ("qr_delegacion","QR de delegación"),
        ("pase_temporal", "Pase temporal"),
        ("manual",       "Ingreso manual por guardia"),
    ]

    punto_acceso = models.ForeignKey(
        PuntoAcceso, on_delete=models.PROTECT, related_name="registros"
    )
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registros_acceso",
    )
    qr_delegacion = models.ForeignKey(
        QrSesion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registros",
    )
    pase_temporal = models.ForeignKey(
        PaseTemporal,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registros",
    )
    tipo = models.CharField(max_length=8, choices=TIPOS)
    metodo_acceso = models.CharField(max_length=15, choices=METODOS, default="qr_permanente")
    timestamp = models.DateTimeField(auto_now_add=True)
    observacion = models.TextField(blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registros_acceso_registrados",
    )

    class Meta:
        db_table = "registros_acceso"
        verbose_name = "Registro de acceso"
        verbose_name_plural = "Registros de acceso"
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.get_tipo_display()} - {self.vehiculo} en {self.punto_acceso} ({self.timestamp})"


class AuditLog(models.Model):
    accion = models.CharField(max_length=60)
    descripcion = models.TextField()
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="audit_logs",
    )
    ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "audit_logs"
        verbose_name = "Registro de auditoría"
        verbose_name_plural = "Registros de auditoría"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.accion} — {self.usuario} — {self.created_at}"
