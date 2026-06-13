from django.db import models
from django.conf import settings
from django.utils import timezone


class CategoriaEspacio(models.Model):
    nombre = models.CharField(max_length=60, unique=True)
    descripcion = models.TextField(blank=True)
    es_discapacidad = models.BooleanField(default=False)
    color = models.CharField(max_length=7, default="#3B82F6", help_text="Color hex para mapa visual")

    class Meta:
        db_table = "categorias_espacios"
        verbose_name = "Categoría de espacio"
        verbose_name_plural = "Categorías de espacios"

    def __str__(self):
        return self.nombre


class ZonaParqueo(models.Model):
    nombre = models.CharField(max_length=80, unique=True)
    descripcion = models.TextField(blank=True)
    ubicacion = models.CharField(max_length=150, blank=True)
    capacidad_total = models.PositiveIntegerField(default=0)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = "zonas_parqueo"
        verbose_name = "Zona de parqueo"
        verbose_name_plural = "Zonas de parqueo"

    def __str__(self):
        return self.nombre


class EspacioParqueo(models.Model):
    ESTADOS = [
        ("disponible", "Disponible"),
        ("ocupado", "Ocupado"),
        ("reservado", "Reservado"),
        ("mantenimiento", "En mantenimiento"),
    ]

    zona = models.ForeignKey(ZonaParqueo, on_delete=models.CASCADE, related_name="espacios")
    categoria = models.ForeignKey(
        CategoriaEspacio, on_delete=models.PROTECT, related_name="espacios"
    )
    numero = models.CharField(max_length=10)
    estado = models.CharField(max_length=15, choices=ESTADOS, default="disponible")
    ubicacion_referencia = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = "espacios_parqueo"
        unique_together = ("zona", "numero")
        verbose_name = "Espacio de parqueo"
        verbose_name_plural = "Espacios de parqueo"

    def __str__(self):
        return f"{self.zona.nombre} - #{self.numero} ({self.get_estado_display()})"


class SesionParqueo(models.Model):
    ESTADOS = [
        ("activa", "Activa"),
        ("cerrada", "Cerrada"),
        ("cancelada", "Cancelada"),
    ]

    espacio = models.ForeignKey(
        EspacioParqueo, on_delete=models.PROTECT, related_name="sesiones"
    )
    # Una sesión la ocupa un vehículo REGISTRADO o uno TEMPORAL (proveedor,
    # mantenimiento, visitante externo). Exactamente uno de los dos.
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.PROTECT,
        related_name="sesiones_parqueo", null=True, blank=True,
    )
    vehiculo_temporal = models.ForeignKey(
        "acceso.VehiculoTemporal", on_delete=models.PROTECT,
        related_name="sesiones_parqueo", null=True, blank=True,
    )
    hora_entrada = models.DateTimeField(default=timezone.now)
    hora_salida = models.DateTimeField(null=True, blank=True)
    estado = models.CharField(max_length=10, choices=ESTADOS, default="activa")

    @property
    def placa_ocupante(self) -> str:
        """Placa del ocupante, sea vehículo registrado o temporal."""
        if self.vehiculo_id:
            return self.vehiculo.placa
        if self.vehiculo_temporal_id:
            return self.vehiculo_temporal.placa
        return "—"

    class Meta:
        db_table = "sesiones_parqueo"
        verbose_name = "Sesión de parqueo"
        verbose_name_plural = "Sesiones de parqueo"
        ordering = ["-hora_entrada"]
        constraints = [
            # Garantía a nivel de datos: aunque dos requests concurrentes pasen
            # las validaciones del resolver, la BD impide duplicar sesión activa.
            # (Postgres trata NULL como distinto, así que múltiples sesiones de
            # temporales —vehiculo NULL— no colisionan entre sí.)
            models.UniqueConstraint(
                fields=["vehiculo"],
                condition=models.Q(estado="activa"),
                name="unica_sesion_activa_por_vehiculo",
            ),
            models.UniqueConstraint(
                fields=["espacio"],
                condition=models.Q(estado="activa"),
                name="unica_sesion_activa_por_espacio",
            ),
        ]

    def __str__(self):
        return f"{self.placa_ocupante} en {self.espacio} ({self.get_estado_display()})"


