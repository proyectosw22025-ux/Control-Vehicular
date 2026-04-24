from django.contrib import admin
from .models import TipoVehiculo, Vehiculo, DocumentoVehiculo, HistorialPropietario


@admin.register(TipoVehiculo)
class TipoVehiculoAdmin(admin.ModelAdmin):
    list_display = ("nombre", "descripcion")
    search_fields = ("nombre",)


@admin.register(Vehiculo)
class VehiculoAdmin(admin.ModelAdmin):
    list_display = ("placa", "tipo", "propietario", "marca", "modelo", "anio", "estado")
    list_filter = ("tipo", "estado")
    search_fields = ("placa", "marca", "modelo")


@admin.register(DocumentoVehiculo)
class DocumentoVehiculoAdmin(admin.ModelAdmin):
    list_display = ("vehiculo", "tipo_doc", "numero", "fecha_vencimiento")
    list_filter = ("tipo_doc",)


@admin.register(HistorialPropietario)
class HistorialPropietarioAdmin(admin.ModelAdmin):
    list_display = ("vehiculo", "usuario", "fecha_inicio", "fecha_fin")
