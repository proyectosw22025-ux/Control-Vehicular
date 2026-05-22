from django.db import models
from django.conf import settings


class TipoVisita(models.Model):
    nombre = models.CharField(max_length=60, unique=True)
    descripcion = models.TextField(blank=True)
    requiere_vehiculo = models.BooleanField(default=False)
    duracion_esperada_horas = models.PositiveSmallIntegerField(
        default=4,
        help_text="Umbral en horas. Pasado este tiempo se notifica al anfitrión y se auto-cierra si no hay respuesta.",
    )

    class Meta:
        db_table = "tipos_visita"
        verbose_name = "Tipo de visita"
        verbose_name_plural = "Tipos de visita"

    def __str__(self):
        return self.nombre


class Visitante(models.Model):
    nombre = models.CharField(max_length=100)
    apellido = models.CharField(max_length=100)
    ci = models.CharField(max_length=20, unique=True, verbose_name="Cédula de identidad")
    telefono = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    foto = models.ImageField(upload_to="visitantes/fotos/", blank=True, null=True)
    procedencia = models.CharField(
        max_length=120, blank=True, default="",
        help_text="Ciudad, empresa o institución de procedencia.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "visitantes"
        verbose_name = "Visitante"
        verbose_name_plural = "Visitantes"

    def __str__(self):
        return f"{self.nombre} {self.apellido} ({self.ci})"


class Visita(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente"),
        ("activa", "Activa"),
        ("completada", "Completada"),
        ("cancelada", "Cancelada"),
    ]

    visitante = models.ForeignKey(
        Visitante, on_delete=models.PROTECT, related_name="visitas"
    )
    anfitrion = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="visitas_como_anfitrion",
    )
    tipo_visita = models.ForeignKey(
        TipoVisita,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="visitas",
    )
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="visitas",
    )
    motivo = models.TextField()
    estado = models.CharField(max_length=12, choices=ESTADOS, default="pendiente")
    fecha_entrada = models.DateTimeField(null=True, blank=True)
    fecha_salida = models.DateTimeField(null=True, blank=True)
    observaciones = models.TextField(blank=True)
    TIPO_CIERRE = [
        ("manual_guardia",       "Registrada por guardia"),
        ("confirmado_anfitrion", "Confirmada por anfitrión"),
        ("auto",                 "Auto-cerrada — salida no verificada"),
    ]
    tipo_cierre = models.CharField(
        max_length=25, blank=True, default="", choices=TIPO_CIERRE,
    )
    notificacion_anfitrion_enviada = models.BooleanField(default=False)
    num_acompanantes = models.PositiveSmallIntegerField(
        default=0,
        help_text="Personas adicionales que ingresan con el visitante.",
    )
    # Placa del vehículo propio del visitante (texto libre — puede ser placa, TAXI, A PIE, etc.)
    # Distinto del FK vehiculo, que es para vehículos registrados en el sistema UAGRM
    placa_vehiculo_visitante = models.CharField(
        max_length=20, blank=True, default="",
        help_text="Placa, TAXI, BUS o vacío si vino a pie. Solo para vehículos externos."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "visitas"
        verbose_name = "Visita"
        verbose_name_plural = "Visitas"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.visitante} → {self.anfitrion} [{self.get_estado_display()}]"
