import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime
from django.contrib.auth import authenticate
from django.core.cache import cache
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
    totp_activo: bool

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
    codigo_totp: Optional[str] = None   # segundo factor si el usuario tiene 2FA activo


@strawberry.type
class ConfiguracionTotpType:
    """Retornado al iniciar la configuración de 2FA — la URL se muestra como QR."""
    otpauth_url: str   # URL para escanear con Google Authenticator
    secret_base32: str # Backup manual (para el usuario que no puede escanear)


@strawberry.type
class EstadoTotpType:
    activo: bool


TIPOS_USUARIO = {
    "estudiante":  "Estudiante",
    "docente":     "Docente",
    "personal":    "Personal Administrativo",
    "guardia":     "Guardia",
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
    def usuarios(self, info: Info, buscar: Optional[str] = None) -> List[UsuarioType]:
        """
        Devuelve usuarios activos. Acepta `buscar` para filtrar por CI/nombre/email.
        Limitado a 200 resultados para no transferir toda la BD en cada request.
        """
        if not info.context.request.user.is_authenticated:
            raise Exception("Autenticación requerida")
        qs = Usuario.objects.filter(is_active=True)
        if buscar:
            from django.db.models import Q as DQ
            q = buscar.strip()
            qs = qs.filter(
                DQ(ci__icontains=q) | DQ(nombre__icontains=q) |
                DQ(apellido__icontains=q) | DQ(email__icontains=q)
            )
        return list(qs.order_by("apellido", "nombre")[:200])

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
        from apps.acceso.utils import log_audit
        req = info.context.request
        x_fwd = req.META.get("HTTP_X_FORWARDED_FOR")
        ip = x_fwd.split(",")[0].strip() if x_fwd else (req.META.get("REMOTE_ADDR") or "unknown")
        rate_key = f"login_attempts_{ip}"
        attempts: int = cache.get(rate_key, 0)
        if attempts >= 5:
            log_audit(None, "login_bloqueado", f"IP {ip} bloqueada por exceso de intentos (CI: {input.ci})", request=req)
            raise Exception("Demasiados intentos de inicio de sesión. Espere 1 minuto.")
        user = authenticate(username=input.ci, password=input.password)
        if not user:
            cache.set(rate_key, attempts + 1, timeout=60)
            log_audit(None, "login_fallido", f"Intento fallido para CI {input.ci}", request=req)
            raise Exception("Credenciales inválidas")
        if not user.is_active:
            log_audit(user, "login_inactivo", f"Intento de acceso de usuario inactivo: {user.ci}", request=req)
            raise Exception("Usuario inactivo. Contacte a la administración.")
        # ── Verificación 2FA (si el usuario lo tiene activado) ──────────────
        if user.totp_activo:
            if not input.codigo_totp:
                # Señal al frontend para mostrar el segundo paso
                raise Exception("2FA_REQUIRED")
            import pyotp
            totp = pyotp.TOTP(user.totp_secret)
            # valid_window=1 → acepta el código del período anterior/siguiente (±30s)
            if not totp.verify(input.codigo_totp.strip(), valid_window=1):
                cache.set(rate_key, attempts + 1, timeout=60)
                log_audit(None, "login_2fa_fallido",
                          f"Código 2FA incorrecto para {user.ci}", request=req)
                raise Exception("Código de doble factor incorrecto. Verifica tu app de autenticación.")

        cache.delete(rate_key)
        tokens = RefreshToken.for_user(user)
        metodo = "login_exitoso_2fa" if user.totp_activo else "login_exitoso"
        log_audit(user, metodo, f"Sesión iniciada por {user.ci}", request=req)
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

        # Los guardias solo pueden ser creados por administradores — no por auto-registro
        if tipo == "guardia":
            solicitante = info.context.request.user
            if not getattr(solicitante, "is_authenticated", False) or not tiene_rol(solicitante, "Administrador"):
                raise Exception("Solo administradores pueden crear cuentas de guardia")

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
        from apps.acceso.utils import log_audit
        from apps.notificaciones.email_templates import email_bienvenida
        from apps.notificaciones.utils import enviar_email
        log_audit(None, "usuario_creado", f"Nuevo usuario registrado: CI={input.ci} tipo={tipo}", request=info.context.request)
        try:
            asunto_bv, html_bv = email_bienvenida(user.nombre)
            enviar_email(
                usuario=user,
                asunto=asunto_bv,
                cuerpo=f"Hola {user.nombre}, tu cuenta fue creada exitosamente.",
                html=html_bv,
            )
        except Exception:
            pass
        nombre_rol = TIPOS_USUARIO[tipo]
        descripcion_rol = {
            "Estudiante":              "Estudiante universitario — gestiona sus vehículos",
            "Docente":                 "Docente universitario — gestiona sus vehículos",
            "Personal Administrativo": "Personal administrativo — gestiona sus vehículos",
            "Guardia":                 "Guardia de seguridad — registra accesos, multas y visitantes",
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
        from apps.acceso.utils import log_audit
        log_audit(info.context.request.user, "usuario_desactivado", f"Usuario {user.ci} ({user.nombre} {user.apellido}) desactivado", request=info.context.request)
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
        if created:
            from apps.acceso.utils import log_audit
            log_audit(info.context.request.user, "rol_asignado", f"Rol '{rol.nombre}' asignado a {user.ci}", request=info.context.request)
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
        from apps.acceso.utils import log_audit
        log_audit(info.context.request.user, "rol_removido", f"Rol ID={input.rol_id} removido del usuario ID={input.usuario_id}", request=info.context.request)
        return MensajeType(ok=True, mensaje="Rol removido")

    @strawberry.mutation
    def crear_rol(self, info: Info, nombre: str, descripcion: Optional[str] = "") -> RolType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden crear roles")
        if Rol.objects.filter(nombre=nombre).exists():
            raise Exception(f"Ya existe el rol '{nombre}'")
        return Rol.objects.create(nombre=nombre, descripcion=descripcion or "")

    # ── Autenticación de doble factor ─────────────────────────────────────────

    @strawberry.mutation
    def iniciar_configuracion_2fa(self, info: Info) -> ConfiguracionTotpType:
        """
        Genera un nuevo secreto TOTP y retorna la URL otpauth:// para escanear
        con Google Authenticator. El 2FA queda pendiente hasta que el usuario
        confirme con verificar_configuracion_2fa().
        """
        import pyotp
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")

        # Generar secreto aleatorio compatible con Google Authenticator
        secret = pyotp.random_base32()
        # Guardarlo temporalmente (no activado aún)
        user.totp_secret = secret
        user.totp_activo = False
        user.save(update_fields=["totp_secret", "totp_activo"])

        totp = pyotp.TOTP(secret)
        url = totp.provisioning_uri(
            name=user.ci,
            issuer_name="UAGRM Control Vehicular",
        )
        return ConfiguracionTotpType(otpauth_url=url, secret_base32=secret)

    @strawberry.mutation
    def verificar_configuracion_2fa(self, info: Info, codigo: str) -> MensajeType:
        """
        Verifica el primer código TOTP del usuario para confirmar que Google
        Authenticator está correctamente configurado. Solo entonces activa el 2FA.
        """
        import pyotp
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not user.totp_secret:
            raise Exception("Primero inicia la configuración del doble factor")

        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(codigo.strip(), valid_window=1):
            raise Exception(
                "Código incorrecto. Asegúrate de haber escaneado el QR correctamente."
            )

        user.totp_activo = True
        user.save(update_fields=["totp_activo"])
        from apps.acceso.utils import log_audit
        log_audit(user, "2fa_activado", f"2FA activado para {user.ci}", request=info.context.request)
        return MensajeType(ok=True, mensaje="Autenticación de doble factor activada correctamente.")

    @strawberry.mutation
    def desactivar_2fa(self, info: Info, codigo: str) -> MensajeType:
        """
        Desactiva el 2FA del usuario. Requiere el código actual como confirmación
        para evitar que alguien con acceso físico al PC desactive el 2FA.
        """
        import pyotp
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not user.totp_activo:
            raise Exception("El doble factor no está activado")

        totp = pyotp.TOTP(user.totp_secret)
        if not totp.verify(codigo.strip(), valid_window=1):
            raise Exception("Código incorrecto. Ingresa el código de tu app de autenticación.")

        user.totp_activo = False
        user.totp_secret = ""
        user.save(update_fields=["totp_activo", "totp_secret"])
        from apps.acceso.utils import log_audit
        log_audit(user, "2fa_desactivado", f"2FA desactivado para {user.ci}", request=info.context.request)
        return MensajeType(ok=True, mensaje="Doble factor desactivado.")

    @strawberry.mutation
    def estado_2fa(self, info: Info) -> EstadoTotpType:
        """Retorna si el usuario actual tiene 2FA activo."""
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        return EstadoTotpType(activo=user.totp_activo)

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
