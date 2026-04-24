from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils import timezone


class UsuarioManager(BaseUserManager):
    def create_user(self, ci, email, nombre, apellido, password=None, **extra_fields):
        if not ci:
            raise ValueError("El CI es obligatorio")
        email = self.normalize_email(email)
        user = self.model(ci=ci, email=email, nombre=nombre, apellido=apellido, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, ci, email, nombre, apellido, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(ci, email, nombre, apellido, password, **extra_fields)


class Usuario(AbstractBaseUser, PermissionsMixin):
    ci = models.CharField(max_length=20, unique=True, verbose_name="Cédula de identidad")
    email = models.EmailField(unique=True)
    nombre = models.CharField(max_length=100)
    apellido = models.CharField(max_length=100)
    telefono = models.CharField(max_length=20, blank=True)
    foto = models.ImageField(upload_to="usuarios/fotos/", blank=True, null=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    USERNAME_FIELD = "ci"
    REQUIRED_FIELDS = ["email", "nombre", "apellido"]

    objects = UsuarioManager()

    class Meta:
        db_table = "usuarios"
        verbose_name = "Usuario"
        verbose_name_plural = "Usuarios"

    def __str__(self):
        return f"{self.nombre} {self.apellido} ({self.ci})"

    @property
    def nombre_completo(self):
        return f"{self.nombre} {self.apellido}"


class Rol(models.Model):
    nombre = models.CharField(max_length=80, unique=True)
    descripcion = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "roles"
        verbose_name = "Rol"
        verbose_name_plural = "Roles"

    def __str__(self):
        return self.nombre


class Permiso(models.Model):
    MODULOS = [
        ("usuarios", "Usuarios"),
        ("vehiculos", "Vehículos"),
        ("parqueos", "Parqueos"),
        ("acceso", "Acceso"),
        ("visitantes", "Visitantes"),
        ("multas", "Multas"),
        ("notificaciones", "Notificaciones"),
        ("reportes", "Reportes"),
    ]

    codigo = models.CharField(max_length=60, unique=True)
    nombre = models.CharField(max_length=120)
    descripcion = models.TextField(blank=True)
    modulo = models.CharField(max_length=30, choices=MODULOS)

    class Meta:
        db_table = "permisos"
        verbose_name = "Permiso"
        verbose_name_plural = "Permisos"

    def __str__(self):
        return f"{self.modulo}:{self.codigo}"


class UsuarioRol(models.Model):
    usuario = models.ForeignKey(
        Usuario, on_delete=models.CASCADE, related_name="usuario_roles"
    )
    rol = models.ForeignKey(Rol, on_delete=models.CASCADE, related_name="usuario_roles")
    asignado_por = models.ForeignKey(
        Usuario, on_delete=models.SET_NULL, null=True, related_name="roles_asignados"
    )
    fecha_asignacion = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "usuario_roles"
        unique_together = ("usuario", "rol")
        verbose_name = "Usuario-Rol"
        verbose_name_plural = "Usuario-Roles"

    def __str__(self):
        return f"{self.usuario} → {self.rol}"


class RolPermiso(models.Model):
    rol = models.ForeignKey(Rol, on_delete=models.CASCADE, related_name="rol_permisos")
    permiso = models.ForeignKey(
        Permiso, on_delete=models.CASCADE, related_name="rol_permisos"
    )

    class Meta:
        db_table = "rol_permisos"
        unique_together = ("rol", "permiso")
        verbose_name = "Rol-Permiso"
        verbose_name_plural = "Rol-Permisos"

    def __str__(self):
        return f"{self.rol} → {self.permiso}"
