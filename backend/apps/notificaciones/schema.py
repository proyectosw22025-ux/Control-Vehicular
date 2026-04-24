import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime

from .models import TipoNotificacion, Notificacion, PreferenciaNotificacion


@strawberry.type
class TipoNotificacionType:
    id: int
    codigo: str
    nombre: str
    descripcion: str


@strawberry.type
class NotificacionType:
    id: int
    titulo: str
    mensaje: str
    leido: bool
    fecha: datetime

    @strawberry.field
    def tipo_codigo(self) -> Optional[str]:
        return self.tipo.codigo if self.tipo else None


@strawberry.type
class PreferenciaNotificacionType:
    id: int
    activo: bool
    canal: str

    @strawberry.field
    def tipo(self) -> TipoNotificacionType:
        return self.tipo


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

@strawberry.type
class NotificacionesQuery:
    @strawberry.field
    def mis_notificaciones(
        self, info: Info, solo_no_leidas: bool = False, limite: int = 30
    ) -> List[NotificacionType]:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        qs = Notificacion.objects.filter(usuario=user).order_by("-fecha")
        if solo_no_leidas:
            qs = qs.filter(leido=False)
        return list(qs[:limite])

    @strawberry.field
    def conteo_no_leidas(self, info: Info) -> int:
        user = info.context.request.user
        if not user.is_authenticated:
            return 0
        return Notificacion.objects.filter(usuario=user, leido=False).count()

    @strawberry.field
    def mis_preferencias(self, info: Info) -> List[PreferenciaNotificacionType]:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        return list(PreferenciaNotificacion.objects.filter(usuario=user).select_related("tipo"))

    @strawberry.field
    def tipos_notificacion(self, info: Info) -> List[TipoNotificacionType]:
        return list(TipoNotificacion.objects.all())


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class NotificacionesMutation:
    @strawberry.mutation
    def marcar_leida(self, info: Info, notificacion_id: int) -> NotificacionType:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        notif = Notificacion.objects.filter(pk=notificacion_id, usuario=user).first()
        if not notif:
            raise Exception("Notificación no encontrada")
        notif.leido = True
        notif.save()
        return notif

    @strawberry.mutation
    def marcar_todas_leidas(self, info: Info) -> int:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        return Notificacion.objects.filter(usuario=user, leido=False).update(leido=True)

    @strawberry.mutation
    def actualizar_preferencia(
        self, info: Info, tipo_id: int, canal: str, activo: bool
    ) -> PreferenciaNotificacionType:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if canal not in ["email", "push", "websocket"]:
            raise Exception("Canal inválido. Opciones: email, push, websocket")
        tipo = TipoNotificacion.objects.filter(pk=tipo_id).first()
        if not tipo:
            raise Exception("Tipo de notificación no encontrado")
        pref, _ = PreferenciaNotificacion.objects.update_or_create(
            usuario=user, tipo=tipo, canal=canal, defaults={"activo": activo}
        )
        return pref
