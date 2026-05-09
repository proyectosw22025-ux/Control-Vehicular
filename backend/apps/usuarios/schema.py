import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.contrib.auth import authenticate
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Usuario, Rol, Permiso, UsuarioRol, RolPermiso
from .utils import tiene_rol


# ──────────────────────────────────────────────
# TYPES
# ──────────────────────────────────────────────

@strawberry.type
class PermisoType:
    id: int
    codigo: str
    nombre: str
    descripcion: str
    modulo: str


@strawberry.type
class RolType:
    id: int
    nombre: str
    descripcion: str
    is_active: bool
    created_at: datetime

    @strawberry.field
    def permisos(self) -> List[PermisoType]:
        return list(Permiso.objects.filter(rol_permisos__rol_id=self.id))


@strawberry.type
class UsuarioType:
    id: int
    ci: str
    email: str
    nombre: str
    apellido: str
    telefono: str
    is_active: bool
    is_superuser: bool
    date_joined: datetime

    @strawberry.field
    def nombre_completo(self) -> str:
        return f"{self.nombre} {self.apellido}"

    @strawberry.field
    def roles(self) -> List[RolType]:
        return list(Rol.objects.filter(usuario_roles__usuario_id=self.id))


@strawberry.type
class AuthPayload:
    access: str
    refresh: str
    usuario: UsuarioType


@strawberry.type
class MensajeType:
    ok: bool
    mensaje: str


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

@strawberry.input
class LoginInput:
    ci: str
    password: str


TIPOS_USUARIO = {
    "estudiante":  "Estudiante",
    "docente":     "Docente",
    "personal":    "Personal Administrativo",
}


@strawberry.input
class CrearUsuarioInput:
    ci: str
    email: str
    nombre: str
    apellido: str
    password: str
    tipo_usuario: Optional[str] = "estudiante"
    telefono: Optional[str] = ""


@strawberry.input
class ActualizarUsuarioInput:
    nombre: Optional[str] = None
    apellido: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None


@strawberry.input
class AsignarRolInput:
    usuario_id: int
    rol_id: int


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class UsuariosQuery:
    @strawberry.field
    def me(self, info: Info) -> Optional[UsuarioType]:
        user = info.context.request.user
        return user if user.is_authenticated else None

    @strawberry.field
    def usuarios(self, info: Info) -> List[UsuarioType]:
        if not info.context.request.user.is_authenticated:
            raise Exception("Autenticación requerida")
        return list(Usuario.objects.filter(is_active=True).order_by("apellido", "nombre"))

    @strawberry.field
    def usuario(self, info: Info, id: int) -> Optional[UsuarioType]:
        if not info.context.request.user.is_authenticated:
            raise Exception("Autenticación requerida")
        return Usuario.objects.filter(pk=id).first()

    @strawberry.field
    def roles(self, info: Info) -> List[RolType]:
        return list(Rol.objects.filter(is_active=True))

    @strawberry.field
    def permisos(self, info: Info) -> List[PermisoType]:
        return list(Permiso.objects.all().order_by("modulo", "codigo"))


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class UsuariosMutation:
    @strawberry.mutation
    def login(self, info: Info, input: LoginInput) -> AuthPayload:
        user = authenticate(username=input.ci, password=input.password)
        if not user:
            raise Exception("Credenciales inválidas")
        if not user.is_active:
            raise Exception("Usuario inactivo")
        tokens = RefreshToken.for_user(user)
        return AuthPayload(
            access=str(tokens.access_token),
            refresh=str(tokens),
            usuario=user,
        )

    @strawberry.mutation
    def refresh_token(self, info: Info, refresh: str) -> str:
        try:
            token = RefreshToken(refresh)
            return str(token.access_token)
        except Exception:
            raise Exception("Token de refresco inválido o expirado")

    @strawberry.mutation
    def crear_usuario(self, info: Info, input: CrearUsuarioInput) -> UsuarioType:
        tipo = (input.tipo_usuario or "estudiante").lower()
        if tipo not in TIPOS_USUARIO:
            raise Exception(f"Tipo de usuario inválido. Opciones: {', '.join(TIPOS_USUARIO)}")
        if Usuario.objects.filter(ci=input.ci).exists():
            raise Exception(f"Ya existe un usuario con CI {input.ci}")
        if Usuario.objects.filter(email=input.email).exists():
            raise Exception(f"El email {input.email} ya está registrado")
        user = Usuario.objects.create_user(
            ci=input.ci,
            email=input.email,
            nombre=input.nombre,
            apellido=input.apellido,
            telefono=input.telefono or "",
            password=input.password,
        )
        nombre_rol = TIPOS_USUARIO[tipo]
        descripcion_rol = {
            "Estudiante":             "Estudiante universitario — gestiona sus vehículos",
            "Docente":                "Docente universitario — gestiona sus vehículos",
            "Personal Administrativo":"Personal administrativo — gestiona sus vehículos",
        }.get(nombre_rol, "")
        rol, _ = Rol.objects.get_or_create(
            nombre=nombre_rol,
            defaults={"descripcion": descripcion_rol},
        )
        UsuarioRol.objects.create(usuario=user, rol=rol, asignado_por=None)
        return user

    @strawberry.mutation
    def cambiar_password(self, info: Info, password_actual: str, password_nuevo: str) -> MensajeType:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not user.check_password(password_actual):
            raise Exception("Contraseña actual incorrecta")
        if len(password_nuevo) < 8:
            raise Exception("La contraseña nueva debe tener al menos 8 caracteres")
        user.set_password(password_nuevo)
        user.save()
        return MensajeType(ok=True, mensaje="Contraseña actualizada correctamente")

    @strawberry.mutation
    def actualizar_usuario(self, info: Info, id: int, input: ActualizarUsuarioInput) -> UsuarioType:
        solicitante = info.context.request.user
        if not solicitante.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(solicitante, "Administrador") and solicitante.pk != id:
            raise Exception("Solo puedes modificar tu propio perfil")
        user = Usuario.objects.filter(pk=id).first()
        if not user:
            raise Exception("Usuario no encontrado")
        if input.nombre is not None:
            user.nombre = input.nombre
        if input.apellido is not None:
            user.apellido = input.apellido
        if input.telefono is not None:
            user.telefono = input.telefono
        if input.email is not None:
            user.email = input.email
        user.save()
        return user

    @strawberry.mutation
    def desactivar_usuario(self, info: Info, id: int) -> MensajeType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden desactivar usuarios")
        user = Usuario.objects.filter(pk=id).first()
        if not user:
            raise Exception("Usuario no encontrado")
        user.is_active = False
        user.save()
        return MensajeType(ok=True, mensaje=f"Usuario {user.ci} desactivado")

    @strawberry.mutation
    def asignar_rol(self, info: Info, input: AsignarRolInput) -> MensajeType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden asignar roles")
        user = Usuario.objects.filter(pk=input.usuario_id).first()
        rol = Rol.objects.filter(pk=input.rol_id).first()
        if not user:
            raise Exception("Usuario no encontrado")
        if not rol:
            raise Exception("Rol no encontrado")
        _, created = UsuarioRol.objects.get_or_create(
            usuario=user, rol=rol,
            defaults={"asignado_por": info.context.request.user},
        )
        return MensajeType(ok=True, mensaje="Rol asignado" if created else "Ya tenía ese rol")

    @strawberry.mutation
    def remover_rol(self, info: Info, input: AsignarRolInput) -> MensajeType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden remover roles")
        deleted, _ = UsuarioRol.objects.filter(
            usuario_id=input.usuario_id, rol_id=input.rol_id
        ).delete()
        if not deleted:
            raise Exception("Asignación no encontrada")
        return MensajeType(ok=True, mensaje="Rol removido")

    @strawberry.mutation
    def crear_rol(self, info: Info, nombre: str, descripcion: Optional[str] = "") -> RolType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden crear roles")
        if Rol.objects.filter(nombre=nombre).exists():
            raise Exception(f"Ya existe el rol '{nombre}'")
        return Rol.objects.create(nombre=nombre, descripcion=descripcion or "")

    @strawberry.mutation
    def crear_permiso(
        self, info: Info, codigo: str, nombre: str, modulo: str,
        descripcion: Optional[str] = "",
    ) -> PermisoType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden crear permisos")
        modulos_validos = [
            "usuarios", "vehiculos", "parqueos", "acceso",
            "visitantes", "multas", "notificaciones", "reportes",
        ]
        if modulo not in modulos_validos:
            raise Exception(f"Módulo inválido. Opciones: {', '.join(modulos_validos)}")
        if Permiso.objects.filter(codigo=codigo).exists():
            raise Exception(f"Ya existe el permiso '{codigo}'")
        return Permiso.objects.create(
            codigo=codigo, nombre=nombre, modulo=modulo, descripcion=descripcion or ""
        )

    @strawberry.mutation
    def asignar_permiso_rol(self, info: Info, rol_id: int, permiso_id: int) -> MensajeType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden asignar permisos a roles")
        rol = Rol.objects.filter(pk=rol_id).first()
        permiso = Permiso.objects.filter(pk=permiso_id).first()
        if not rol:
            raise Exception("Rol no encontrado")
        if not permiso:
            raise Exception("Permiso no encontrado")
        _, created = RolPermiso.objects.get_or_create(rol=rol, permiso=permiso)
        return MensajeType(
            ok=True,
            mensaje="Permiso asignado al rol" if created else "El rol ya tenía ese permiso",
        )

    @strawberry.mutation
    def quitar_permiso_rol(self, info: Info, rol_id: int, permiso_id: int) -> MensajeType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden quitar permisos de roles")
        deleted, _ = RolPermiso.objects.filter(rol_id=rol_id, permiso_id=permiso_id).delete()
        if not deleted:
            raise Exception("Asignación no encontrada")
        return MensajeType(ok=True, mensaje="Permiso removido del rol")
