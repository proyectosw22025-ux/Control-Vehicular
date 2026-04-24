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
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.CASCADE, related_name="qr_sesiones"
    )
    imagen_qr = models.ImageField(upload_to="acceso/qr/", blank=True, null=True)
    codigo_hash = models.CharField(max_length=64, unique=True)
    fecha_generacion = models.DateTimeField(auto_now_add=True)
    fecha_expiracion = models.DateTimeField()
    usado = models.BooleanField(default=False)
    sesion_parqueo = models.ForeignKey(
        "parqueos.SesionParqueo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="qr_sesiones",
    )

    class Meta:
        db_table = "qr_sesiones"
        verbose_name = "QR de sesión"
        verbose_name_plural = "QR de sesiones"
        indexes = [models.Index(fields=["codigo_hash"])]

    def __str__(self):
        return f"QR {self.vehiculo.placa} - exp: {self.fecha_expiracion}"

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
    qr_sesion = models.ForeignKey(
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
