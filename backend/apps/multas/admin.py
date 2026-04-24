from django.contrib import admin
from .models import TipoMulta, Multa, PagoMulta, ApelacionMulta


@admin.register(TipoMulta)
class TipoMultaAdmin(admin.ModelAdmin):
    list_display = ("nombre", "monto_base")
    search_fields = ("nombre",)


@admin.register(Multa)
class MultaAdmin(admin.ModelAdmin):
    list_display = ("vehiculo", "tipo", "monto", "estado", "fecha")
    list_filter = ("estado", "tipo")
    search_fields = ("vehiculo__placa",)


@admin.register(PagoMulta)
class PagoMultaAdmin(admin.ModelAdmin):
    list_display = ("multa", "fecha_pago", "monto_pagado", "metodo_pago")
    list_filter = ("metodo_pago",)


@admin.register(ApelacionMulta)
class ApelacionMultaAdmin(admin.ModelAdmin):
    list_display = ("multa", "usuario", "estado", "fecha")
    list_filter = ("estado",)
