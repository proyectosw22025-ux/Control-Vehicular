from django.contrib import admin
from .models import PuntoAcceso, QrSesion, PaseTemporal, RegistroAcceso


@admin.register(PuntoAcceso)
class PuntoAccesoAdmin(admin.ModelAdmin):
    list_display = ("nombre", "tipo", "activo")
    list_filter = ("tipo", "activo")


@admin.register(QrSesion)
class QrSesionAdmin(admin.ModelAdmin):
    list_display = ("vehiculo", "fecha_generacion", "fecha_expiracion", "usado")
    list_filter = ("usado",)


@admin.register(PaseTemporal)
class PaseTemporalAdmin(admin.ModelAdmin):
    list_display = ("codigo", "valido_desde", "valido_hasta", "usos_max", "usos_actual", "activo")
    list_filter = ("activo",)


@admin.register(RegistroAcceso)
class RegistroAccesoAdmin(admin.ModelAdmin):
    list_display = ("punto_acceso", "vehiculo", "tipo", "timestamp")
    list_filter = ("tipo", "punto_acceso")
