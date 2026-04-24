from django.db import models
from django.conf import settings


class TipoMulta(models.Model):
    nombre = models.CharField(max_length=100, unique=True)
    descripcion = models.TextField(blank=True)
    monto_base = models.DecimalField(max_digits=8, decimal_places=2)

    class Meta:
        db_table = "tipos_multa"
        verbose_name = "Tipo de multa"
        verbose_name_plural = "Tipos de multa"

    def __str__(self):
        return f"{self.nombre} (Bs {self.monto_base})"


class Multa(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente"),
        ("pagada", "Pagada"),
        ("apelada", "En apelación"),
        ("cancelada", "Cancelada"),
    ]

    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.PROTECT, related_name="multas"
    )
    tipo = models.ForeignKey(TipoMulta, on_delete=models.PROTECT, related_name="multas")
    monto = models.DecimalField(max_digits=8, decimal_places=2)
    descripcion = models.TextField()
    fecha = models.DateTimeField(auto_now_add=True)
    estado = models.CharField(max_length=10, choices=ESTADOS, default="pendiente")
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="multas_registradas",
    )
    evidencia = models.ImageField(upload_to="multas/evidencias/", blank=True, null=True)

    class Meta:
        db_table = "multas"
        verbose_name = "Multa"
        verbose_name_plural = "Multas"
        ordering = ["-fecha"]

    def __str__(self):
        return f"Multa #{self.pk} - {self.vehiculo.placa} [{self.get_estado_display()}]"


class PagoMulta(models.Model):
    METODOS = [
        ("efectivo", "Efectivo"),
        ("transferencia", "Transferencia"),
        ("qr_pago", "QR de pago"),
    ]

    multa = models.OneToOneField(Multa, on_delete=models.CASCADE, related_name="pago")
    fecha_pago = models.DateTimeField(auto_now_add=True)
    monto_pagado = models.DecimalField(max_digits=8, decimal_places=2)
    metodo_pago = models.CharField(max_length=15, choices=METODOS)
    comprobante = models.CharField(max_length=100, blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="pagos_multa_registrados",
    )

    class Meta:
        db_table = "pagos_multa"
        verbose_name = "Pago de multa"
        verbose_name_plural = "Pagos de multa"

    def __str__(self):
        return f"Pago multa #{self.multa_id} - Bs {self.monto_pagado}"


class ApelacionMulta(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente"),
        ("aprobada", "Aprobada"),
        ("rechazada", "Rechazada"),
    ]

    multa = models.OneToOneField(
        Multa, on_delete=models.CASCADE, related_name="apelacion"
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="apelaciones",
    )
    motivo = models.TextField()
    estado = models.CharField(max_length=10, choices=ESTADOS, default="pendiente")
    respuesta = models.TextField(blank=True)
    fecha = models.DateTimeField(auto_now_add=True)
    fecha_resolucion = models.DateTimeField(null=True, blank=True)
    resuelto_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="apelaciones_resueltas",
    )

    class Meta:
        db_table = "apelaciones_multa"
        verbose_name = "Apelación de multa"
        verbose_name_plural = "Apelaciones de multa"
        ordering = ["-fecha"]

    def __str__(self):
        return f"Apelación multa #{self.multa_id} [{self.get_estado_display()}]"
