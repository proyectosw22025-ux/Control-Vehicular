from django.contrib import admin
from .models import TipoInfraccion, Infraccion, Sancion, PagoSancion, ApelacionInfraccion


@admin.register(TipoInfraccion)
class TipoInfraccionAdmin(admin.ModelAdmin):
    list_display = ("nombre", "gravedad", "tipo_sancion_sugerido", "monto_base")
    list_filter = ("gravedad", "tipo_sancion_sugerido")
    search_fields = ("nombre",)


@admin.register(Infraccion)
class InfraccionAdmin(admin.ModelAdmin):
    list_display = ("vehiculo", "tipo", "estado", "fecha")
    list_filter = ("estado", "tipo")
    search_fields = ("vehiculo__placa",)


@admin.register(Sancion)
class SancionAdmin(admin.ModelAdmin):
    list_display = ("infraccion", "tipo_sancion", "monto", "estado", "fecha")
    list_filter = ("tipo_sancion", "estado")


@admin.register(PagoSancion)
class PagoSancionAdmin(admin.ModelAdmin):
    list_display = ("sancion", "fecha_pago", "monto_pagado", "metodo_pago")
    list_filter = ("metodo_pago",)


@admin.register(ApelacionInfraccion)
class ApelacionInfraccionAdmin(admin.ModelAdmin):
    list_display = ("infraccion", "usuario", "estado", "fecha")
    list_filter = ("estado",)
