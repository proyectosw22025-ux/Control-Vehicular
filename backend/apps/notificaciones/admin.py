from django.contrib import admin
from .models import TipoNotificacion, Notificacion, PreferenciaNotificacion


@admin.register(TipoNotificacion)
class TipoNotificacionAdmin(admin.ModelAdmin):
    list_display = ("codigo", "nombre")
    search_fields = ("codigo", "nombre")


@admin.register(Notificacion)
class NotificacionAdmin(admin.ModelAdmin):
    list_display = ("usuario", "tipo", "titulo", "leido", "fecha")
    list_filter = ("leido", "tipo")


@admin.register(PreferenciaNotificacion)
class PreferenciaNotificacionAdmin(admin.ModelAdmin):
    list_display = ("usuario", "tipo", "activo", "canal")
    list_filter = ("activo", "canal")
