from django.db import models
from django.conf import settings


class TipoNotificacion(models.Model):
    codigo = models.CharField(max_length=50, unique=True)
    nombre = models.CharField(max_length=120)
    descripcion = models.TextField(blank=True)
    plantilla_titulo = models.CharField(max_length=200)
    plantilla_cuerpo = models.TextField()

    class Meta:
        db_table = "tipos_notificacion"
        verbose_name = "Tipo de notificación"
        verbose_name_plural = "Tipos de notificación"

    def __str__(self):
        return f"{self.codigo} - {self.nombre}"


class Notificacion(models.Model):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notificaciones",
    )
    tipo = models.ForeignKey(
        TipoNotificacion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="notificaciones",
    )
    titulo = models.CharField(max_length=200)
    mensaje = models.TextField()
    leido = models.BooleanField(default=False)
    fecha = models.DateTimeField(auto_now_add=True)
    datos_extra = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "notificaciones"
        verbose_name = "Notificación"
        verbose_name_plural = "Notificaciones"
        ordering = ["-fecha"]

    def __str__(self):
        return f"{self.usuario} - {self.titulo} ({'leída' if self.leido else 'no leída'})"


class PreferenciaNotificacion(models.Model):
    CANALES = [
        ("email", "Email"),
        ("push", "Push"),
        ("websocket", "WebSocket en tiempo real"),
    ]

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="preferencias_notificacion",
    )
    tipo = models.ForeignKey(
        TipoNotificacion,
        on_delete=models.CASCADE,
        related_name="preferencias",
    )
    activo = models.BooleanField(default=True)
    canal = models.CharField(max_length=12, choices=CANALES, default="websocket")

    class Meta:
        db_table = "preferencias_notificacion"
        unique_together = ("usuario", "tipo", "canal")
        verbose_name = "Preferencia de notificación"
        verbose_name_plural = "Preferencias de notificación"

    def __str__(self):
        return f"{self.usuario} - {self.tipo} via {self.canal}"
