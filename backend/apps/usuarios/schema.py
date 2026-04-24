import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.contrib.auth import authenticate
from rest_framework_simplejwt.tokens import RefreshToken

from .models import Usuario, Rol, Permiso, UsuarioRol


# ──────────────────────────────────────────────
# TYPES
# ──────────────────────────────────────────────

@strawberry.type
class RolType:
    id: int
    nombre: str
    descripcion: str
    is_active: bool
    created_at: datetime


@strawberry.type
class PermisoType:
    id: int
    codigo: str
    nombre: str
    descripcion: str
    modulo: str


@strawberry.type
class UsuarioType:
    id: int
    ci: str
    email: str
    nombre: str
    apellido: str
    telefono: str
    is_active: bool
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


@strawberry.input
class CrearUsuarioInput:
    ci: str
    email: str
    nombre: str
    apellido: str
    telefono: Optional[str] = ""
    password: str


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
        return list(Usuario.objects.filter(is_active=True).order_by("apellido", "nombre"))

    @strawberry.field
    def usuario(self, info: Info, id: int) -> Optional[UsuarioType]:
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
        if Usuario.objects.filter(ci=input.ci).exists():
            raise Exception(f"Ya existe un usuario con CI {input.ci}")
        if Usuario.objects.filter(email=input.email).exists():
            raise Exception(f"El email {input.email} ya está registrado")
        return Usuario.objects.create_user(
            ci=input.ci,
            email=input.email,
            nombre=input.nombre,
            apellido=input.apellido,
            telefono=input.telefono or "",
            password=input.password,
        )

    @strawberry.mutation
    def actualizar_usuario(self, info: Info, id: int, input: ActualizarUsuarioInput) -> UsuarioType:
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
        user = Usuario.objects.filter(pk=id).first()
        if not user:
            raise Exception("Usuario no encontrado")
        user.is_active = False
        user.save()
        return MensajeType(ok=True, mensaje=f"Usuario {user.ci} desactivado")

    @strawberry.mutation
    def asignar_rol(self, info: Info, input: AsignarRolInput) -> MensajeType:
        user = Usuario.objects.filter(pk=input.usuario_id).first()
        rol = Rol.objects.filter(pk=input.rol_id).first()
        if not user:
            raise Exception("Usuario no encontrado")
        if not rol:
            raise Exception("Rol no encontrado")
        asignado_por = info.context.request.user if info.context.request.user.is_authenticated else None
        _, created = UsuarioRol.objects.get_or_create(
            usuario=user, rol=rol, defaults={"asignado_por": asignado_por}
        )
        return MensajeType(ok=True, mensaje="Rol asignado" if created else "Ya tenía ese rol")

    @strawberry.mutation
    def remover_rol(self, info: Info, input: AsignarRolInput) -> MensajeType:
        deleted, _ = UsuarioRol.objects.filter(
            usuario_id=input.usuario_id, rol_id=input.rol_id
        ).delete()
        if not deleted:
            raise Exception("Asignación no encontrada")
        return MensajeType(ok=True, mensaje="Rol removido")

    @strawberry.mutation
    def crear_rol(self, info: Info, nombre: str, descripcion: Optional[str] = "") -> RolType:
        if Rol.objects.filter(nombre=nombre).exists():
            raise Exception(f"Ya existe el rol '{nombre}'")
        return Rol.objects.create(nombre=nombre, descripcion=descripcion or "")
