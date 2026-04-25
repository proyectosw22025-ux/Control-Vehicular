from django.contrib import admin
from .models import PuntoAcceso, QrSesion, PaseTemporal, RegistroAcceso


@admin.register(PuntoAcceso)
class PuntoAccesoAdmin(admin.ModelAdmin):
    list_display = ("nombre", "tipo", "activo")
    list_filter = ("tipo", "activo")


@admin.register(QrSesion)
class QrDelegacionAdmin(admin.ModelAdmin):
    list_display = ("vehiculo", "motivo", "fecha_generacion", "fecha_expiracion", "usado")
    list_filter = ("usado",)


@admin.register(PaseTemporal)
class PaseTemporalAdmin(admin.ModelAdmin):
    list_display = ("codigo", "valido_desde", "valido_hasta", "usos_max", "usos_actual", "activo")
    list_filter = ("activo",)


@admin.register(RegistroAcceso)
class RegistroAccesoAdmin(admin.ModelAdmin):
    list_display = ("punto_acceso", "vehiculo", "tipo", "metodo_acceso", "timestamp")
    list_filter = ("tipo", "metodo_acceso", "punto_acceso")
