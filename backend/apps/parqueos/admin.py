from django.contrib import admin
from .models import CategoriaEspacio, ZonaParqueo, EspacioParqueo, Tarifa, SesionParqueo, Reserva


@admin.register(CategoriaEspacio)
class CategoriaEspacioAdmin(admin.ModelAdmin):
    list_display = ("nombre", "es_discapacidad", "color")


@admin.register(ZonaParqueo)
class ZonaParqueoAdmin(admin.ModelAdmin):
    list_display = ("nombre", "capacidad_total", "activo")
    search_fields = ("nombre",)


@admin.register(EspacioParqueo)
class EspacioParqueoAdmin(admin.ModelAdmin):
    list_display = ("numero", "zona", "categoria", "estado")
    list_filter = ("zona", "categoria", "estado")


@admin.register(Tarifa)
class TarifaAdmin(admin.ModelAdmin):
    list_display = ("categoria", "tipo_vehiculo", "precio_hora", "precio_dia", "activo")
    list_filter = ("activo",)


@admin.register(SesionParqueo)
class SesionParqueoAdmin(admin.ModelAdmin):
    list_display = ("espacio", "vehiculo", "hora_entrada", "hora_salida", "estado", "total_cobrado")
    list_filter = ("estado",)


@admin.register(Reserva)
class ReservaAdmin(admin.ModelAdmin):
    list_display = ("espacio", "vehiculo", "fecha_inicio", "fecha_fin", "estado")
    list_filter = ("estado",)
