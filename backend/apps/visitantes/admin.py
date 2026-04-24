from django.contrib import admin
from .models import Visitante, Visita


@admin.register(Visitante)
class VisitanteAdmin(admin.ModelAdmin):
    list_display = ("nombre", "apellido", "ci", "telefono", "email")
    search_fields = ("nombre", "apellido", "ci")


@admin.register(Visita)
class VisitaAdmin(admin.ModelAdmin):
    list_display = ("visitante", "anfitrion", "motivo", "estado", "fecha_entrada", "fecha_salida")
    list_filter = ("estado",)
    search_fields = ("visitante__nombre", "anfitrion__nombre")
