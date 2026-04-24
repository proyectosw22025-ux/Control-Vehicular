from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import Usuario, Rol, Permiso, UsuarioRol, RolPermiso


@admin.register(Usuario)
class UsuarioAdmin(UserAdmin):
    list_display = ("ci", "email", "nombre", "apellido", "is_active", "is_staff")
    search_fields = ("ci", "email", "nombre", "apellido")
    ordering = ("ci",)
    fieldsets = (
        (None, {"fields": ("ci", "password")}),
        ("Información personal", {"fields": ("nombre", "apellido", "email", "telefono", "foto")}),
        ("Permisos", {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("Fechas", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("ci", "email", "nombre", "apellido", "password1", "password2")}),
    )


@admin.register(Rol)
class RolAdmin(admin.ModelAdmin):
    list_display = ("nombre", "is_active", "created_at")
    search_fields = ("nombre",)


@admin.register(Permiso)
class PermisoAdmin(admin.ModelAdmin):
    list_display = ("codigo", "nombre", "modulo")
    list_filter = ("modulo",)
    search_fields = ("codigo", "nombre")


@admin.register(UsuarioRol)
class UsuarioRolAdmin(admin.ModelAdmin):
    list_display = ("usuario", "rol", "asignado_por", "fecha_asignacion")
    list_filter = ("rol",)


@admin.register(RolPermiso)
class RolPermisoAdmin(admin.ModelAdmin):
    list_display = ("rol", "permiso")
    list_filter = ("rol",)
