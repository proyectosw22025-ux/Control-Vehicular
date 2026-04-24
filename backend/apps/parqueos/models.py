from django.db import models
from django.conf import settings


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


class Tarifa(models.Model):
    categoria = models.ForeignKey(
        CategoriaEspacio, on_delete=models.PROTECT, related_name="tarifas"
    )
    tipo_vehiculo = models.ForeignKey(
        "vehiculos.TipoVehiculo",
        on_delete=models.PROTECT,
        related_name="tarifas",
        null=True,
        blank=True,
        help_text="Nulo = aplica a todos los tipos",
    )
    precio_hora = models.DecimalField(max_digits=8, decimal_places=2)
    precio_dia = models.DecimalField(max_digits=8, decimal_places=2)
    activo = models.BooleanField(default=True)

    class Meta:
        db_table = "tarifas"
        verbose_name = "Tarifa"
        verbose_name_plural = "Tarifas"

    def __str__(self):
        return f"{self.categoria} - Bs {self.precio_hora}/h"


class SesionParqueo(models.Model):
    ESTADOS = [
        ("activa", "Activa"),
        ("cerrada", "Cerrada"),
        ("cancelada", "Cancelada"),
    ]

    espacio = models.ForeignKey(
        EspacioParqueo, on_delete=models.PROTECT, related_name="sesiones"
    )
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.PROTECT, related_name="sesiones_parqueo"
    )
    hora_entrada = models.DateTimeField(auto_now_add=True)
    hora_salida = models.DateTimeField(null=True, blank=True)
    tarifa = models.ForeignKey(
        Tarifa, on_delete=models.SET_NULL, null=True, blank=True
    )
    total_cobrado = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True
    )
    estado = models.CharField(max_length=10, choices=ESTADOS, default="activa")

    class Meta:
        db_table = "sesiones_parqueo"
        verbose_name = "Sesión de parqueo"
        verbose_name_plural = "Sesiones de parqueo"
        ordering = ["-hora_entrada"]

    def __str__(self):
        return f"{self.vehiculo} en {self.espacio} ({self.get_estado_display()})"


class PagoSesion(models.Model):
    METODOS = [
        ("efectivo", "Efectivo"),
        ("transferencia", "Transferencia"),
        ("qr_pago", "QR de pago"),
    ]

    sesion = models.OneToOneField(
        SesionParqueo, on_delete=models.CASCADE, related_name="pago"
    )
    fecha_pago = models.DateTimeField(auto_now_add=True)
    monto = models.DecimalField(max_digits=8, decimal_places=2)
    metodo_pago = models.CharField(max_length=15, choices=METODOS)
    comprobante = models.CharField(max_length=100, blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="pagos_sesion_registrados",
    )

    class Meta:
        db_table = "pagos_sesion"
        verbose_name = "Pago de sesión"
        verbose_name_plural = "Pagos de sesión"

    def __str__(self):
        return f"Pago sesión #{self.sesion_id} - Bs {self.monto}"


class Reserva(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente"),
        ("confirmada", "Confirmada"),
        ("cancelada", "Cancelada"),
        ("expirada", "Expirada"),
    ]

    espacio = models.ForeignKey(
        EspacioParqueo, on_delete=models.PROTECT, related_name="reservas"
    )
    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.PROTECT, related_name="reservas"
    )
    fecha_inicio = models.DateTimeField()
    fecha_fin = models.DateTimeField()
    estado = models.CharField(max_length=12, choices=ESTADOS, default="pendiente")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "reservas"
        verbose_name = "Reserva"
        verbose_name_plural = "Reservas"
        ordering = ["-created_at"]

    def __str__(self):
        return f"Reserva {self.vehiculo} - {self.espacio} [{self.get_estado_display()}]"
