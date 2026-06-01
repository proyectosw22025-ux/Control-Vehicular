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
    latitud  = models.DecimalField(max_digits=12, decimal_places=8, null=True, blank=True)
    longitud = models.DecimalField(max_digits=12, decimal_places=8, null=True, blank=True)

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


class VehiculoTemporal(models.Model):
    """
    Vehículos externos sin registro en el sistema: proveedores, mantenimiento,
    emergencias, visitantes espontáneos. El guardia los registra con placa,
    tipo y duración máxima. Al vencer el tiempo sin salida → alerta automática.
    """
    TIPOS = [
        ("proveedor",     "Proveedor / Entrega"),
        ("mantenimiento", "Servicio de Mantenimiento"),
        ("emergencia",    "Emergencia / Ambulancia"),
        ("visitante",     "Visitante sin pre-registro"),
        ("otro",          "Otro"),
    ]

    placa          = models.CharField(max_length=15)
    tipo           = models.CharField(max_length=15, choices=TIPOS, default="visitante")
    destino        = models.CharField(max_length=150)
    responsable    = models.CharField(max_length=100, blank=True)
    hora_ingreso   = models.DateTimeField(auto_now_add=True)
    hora_limite    = models.DateTimeField()
    hora_salida    = models.DateTimeField(null=True, blank=True)
    activo         = models.BooleanField(default=True)
    observacion    = models.TextField(blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="vehiculos_temporales_registrados",
    )

    class Meta:
        db_table     = "vehiculos_temporales"
        verbose_name = "Vehículo temporal"
        ordering     = ["-hora_ingreso"]

    def __str__(self):
        return f"{self.placa} ({self.get_tipo_display()}) — hasta {self.hora_limite:%H:%M}"

    @property
    def minutos_restantes(self) -> int:
        from django.utils import timezone
        delta = self.hora_limite - timezone.now()
        return max(0, int(delta.total_seconds() / 60))

    @property
    def vencido(self) -> bool:
        from django.utils import timezone
        return self.activo and timezone.now() > self.hora_limite


class AutorizacionAccesoExterno(models.Model):
    """
    Pre-autorización emitida por un administrativo/secretaria para que un
    proveedor o contratista externo ingrese al campus en una ventana horaria.
    El proveedor recibe un QR por email; el guardia lo escanea como cualquier otro QR.
    """
    placa           = models.CharField(max_length=15)
    empresa         = models.CharField(max_length=150)
    motivo          = models.CharField(max_length=250)
    dependencia     = models.ForeignKey(
        "visitantes.DependenciaUAGRM",
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="autorizaciones_externas",
    )
    email_proveedor = models.CharField(max_length=254, blank=True)
    autorizado_por  = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="autorizaciones_externas_emitidas",
    )
    valido_desde    = models.DateTimeField()
    valido_hasta    = models.DateTimeField()
    codigo_acceso   = models.CharField(max_length=24, unique=True)
    activo          = models.BooleanField(default=True)
    usado           = models.BooleanField(default=False)
    email_enviado   = models.BooleanField(default=False)
    fecha_creacion  = models.DateTimeField(auto_now_add=True)
    observacion     = models.TextField(blank=True)

    class Meta:
        db_table     = "autorizaciones_acceso_externo"
        verbose_name = "Autorización de acceso externo"
        ordering     = ["-fecha_creacion"]

    def __str__(self):
        return f"Auth {self.codigo_acceso} — {self.empresa} ({self.placa})"

    @property
    def vigente(self) -> bool:
        from django.utils import timezone
        return (
            self.activo and not self.usado
            and self.valido_desde <= timezone.now() <= self.valido_hasta
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
        ("temporal",     "Acceso temporal de proveedor/externo"),
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
    metodo_acceso = models.CharField(max_length=15, choices=METODOS, default="qr_dinamico")
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


class UbicacionVehiculo(models.Model):
    """
    Última posición GPS conocida de un vehículo dentro del campus.
    Actualizada en tiempo real vía POST /api/rastreo/ubicacion/.
    Se usa para el mapa de rastreo en vivo del módulo de Telemetría.
    """
    vehiculo  = models.OneToOneField(
        "vehiculos.Vehiculo", on_delete=models.CASCADE, related_name="ubicacion_actual"
    )
    latitud   = models.DecimalField(max_digits=12, decimal_places=8)
    longitud  = models.DecimalField(max_digits=12, decimal_places=8)
    velocidad = models.FloatField(default=0.0)   # km/h estimada por el GPS
    timestamp = models.DateTimeField(auto_now=True)
    activo    = models.BooleanField(default=True)  # False cuando sale del campus

    class Meta:
        db_table = "ubicaciones_vehiculo"
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.vehiculo.placa} @ ({self.latitud}, {self.longitud})"


class AlertaAcceso(models.Model):
    """Anomalías de acceso detectadas por el Celery task diario — Sprint D2."""
    TIPOS = [
        ("frecuencia_excesiva",  "Frecuencia excesiva de accesos"),
        ("horario_inusual",      "Acceso fuera de horario habitual"),
        ("punto_inusual",        "Punto de acceso inusual"),
        ("vehiculo_sancionado",  "Vehículo sancionado con acceso reciente"),
        ("placas_similares",     "Placas similares (posible clonación)"),
    ]
    SEVERIDADES = [
        ("info",        "Informativa"),
        ("advertencia", "Advertencia"),
        ("critica",     "Crítica"),
    ]

    vehiculo       = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.CASCADE,
        related_name="alertas_acceso", null=True, blank=True,
    )
    tipo_anomalia  = models.CharField(max_length=25, choices=TIPOS)
    severidad      = models.CharField(max_length=12, choices=SEVERIDADES, default="advertencia")
    descripcion    = models.TextField()
    fecha          = models.DateTimeField(auto_now_add=True)
    fecha_analisis = models.DateField()
    revisada       = models.BooleanField(default=False)
    revisada_por   = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="alertas_revisadas",
    )
    fecha_revision = models.DateTimeField(null=True, blank=True)
    datos_extra    = models.JSONField(default=dict)

    class Meta:
        db_table = "alertas_acceso"
        ordering = ["-fecha"]
        indexes  = [models.Index(fields=["revisada", "fecha_analisis"])]

    def __str__(self):
        placa = self.vehiculo.placa if self.vehiculo else "—"
        return f"{self.get_tipo_anomalia_display()} · {placa} · {self.fecha_analisis}"


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
