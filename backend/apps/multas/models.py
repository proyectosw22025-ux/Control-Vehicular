from django.db import models
from django.conf import settings


class TipoInfraccion(models.Model):
    GRAVEDADES = [
        ("leve", "Leve"),
        ("moderada", "Moderada"),
        ("grave", "Grave"),
    ]
    TIPOS_SANCION = [
        ("amonestacion", "Amonestación"),
        ("multa_economica", "Multa económica"),
        ("suspension_acceso", "Suspensión de acceso"),
        ("reporte_bienestar", "Reporte a Bienestar Estudiantil"),
    ]

    nombre = models.CharField(max_length=100, unique=True)
    descripcion = models.TextField(blank=True)
    gravedad = models.CharField(max_length=10, choices=GRAVEDADES, default="moderada")
    tipo_sancion_sugerido = models.CharField(
        max_length=20, choices=TIPOS_SANCION, default="multa_economica",
        help_text="Sanción que se genera por defecto al registrar una infracción de este tipo",
    )
    monto_base = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        help_text="Monto sugerido cuando la sanción asociada es una multa económica",
    )

    class Meta:
        db_table = "tipos_infraccion"
        verbose_name = "Tipo de infracción"
        verbose_name_plural = "Tipos de infracción"

    def __str__(self):
        return f"{self.nombre} [{self.get_gravedad_display()}]"


class Infraccion(models.Model):
    ESTADOS = [
        ("registrada", "Registrada"),
        ("apelada", "En apelación"),
        ("confirmada", "Confirmada"),
        ("anulada", "Anulada"),
    ]

    vehiculo = models.ForeignKey(
        "vehiculos.Vehiculo", on_delete=models.PROTECT, related_name="infracciones"
    )
    tipo = models.ForeignKey(TipoInfraccion, on_delete=models.PROTECT, related_name="infracciones")
    descripcion = models.TextField()
    fecha = models.DateTimeField(auto_now_add=True)
    estado = models.CharField(max_length=12, choices=ESTADOS, default="registrada")
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="infracciones_registradas",
    )
    evidencia = models.ImageField(upload_to="infracciones/evidencias/", blank=True, null=True)

    class Meta:
        db_table = "infracciones"
        verbose_name = "Infracción"
        verbose_name_plural = "Infracciones"
        ordering = ["-fecha"]

    def __str__(self):
        return f"Infracción #{self.pk} - {self.vehiculo.placa} [{self.get_estado_display()}]"


class Sancion(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente"),
        ("en_revision", "Comprobante en revisión"),  # pago digital enviado, esperando confirmación admin
        ("cumplida", "Cumplida"),
        ("cancelada", "Cancelada"),
    ]
    TIPOS = TipoInfraccion.TIPOS_SANCION

    infraccion = models.OneToOneField(Infraccion, on_delete=models.CASCADE, related_name="sancion")
    tipo_sancion = models.CharField(max_length=20, choices=TIPOS)
    monto = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        help_text="Solo aplica cuando tipo_sancion es 'multa_economica'",
    )
    estado = models.CharField(max_length=12, choices=ESTADOS, default="pendiente")
    fecha = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sanciones"
        verbose_name = "Sanción"
        verbose_name_plural = "Sanciones"
        ordering = ["-fecha"]

    def __str__(self):
        return f"Sanción #{self.pk} ({self.get_tipo_sancion_display()}) - {self.get_estado_display()}"


class PagoSancion(models.Model):
    METODOS = [
        ("efectivo",      "Efectivo (ventanilla)"),
        ("transferencia", "Transferencia bancaria"),
        ("qr_pago",       "QR de Pago"),
        ("banca_movil",   "Banca Móvil / Tigo Money"),
    ]

    sancion = models.OneToOneField(Sancion, on_delete=models.CASCADE, related_name="pago")
    fecha_pago = models.DateTimeField(auto_now_add=True)
    monto_pagado = models.DecimalField(max_digits=8, decimal_places=2)
    metodo_pago = models.CharField(max_length=15, choices=METODOS)
    # comprobante_url → URL Cloudinary del screenshot/foto del comprobante de pago
    # Requerido para pagos digitales, opcional para efectivo (admin lo verifica en ventanilla)
    comprobante = models.CharField(max_length=100, blank=True)
    comprobante_url = models.URLField(blank=True, default="",
        help_text="URL Cloudinary del comprobante/screenshot de pago digital")
    # referencia_pago → código de transacción del banco o número de operación
    referencia_pago = models.CharField(max_length=60, blank=True, default="",
        help_text="Número de referencia o código de transacción bancaria")
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="pagos_sancion_registrados",
    )

    class Meta:
        db_table = "pagos_sancion"
        verbose_name = "Pago de sanción"
        verbose_name_plural = "Pagos de sanción"

    def __str__(self):
        return f"Pago sanción #{self.sancion_id} - Bs {self.monto_pagado}"


class ApelacionInfraccion(models.Model):
    ESTADOS = [
        ("pendiente", "Pendiente"),
        ("aprobada", "Aprobada"),
        ("rechazada", "Rechazada"),
    ]

    infraccion = models.OneToOneField(
        Infraccion, on_delete=models.CASCADE, related_name="apelacion"
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
        db_table = "apelaciones_infraccion"
        verbose_name = "Apelación de infracción"
        verbose_name_plural = "Apelaciones de infracción"
        ordering = ["-fecha"]

    def __str__(self):
        return f"Apelación infracción #{self.infraccion_id} [{self.get_estado_display()}]"
