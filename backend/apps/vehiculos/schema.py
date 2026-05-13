"""
Módulo Vehículos — Strawberry GraphQL Schema

Optimizaciones aplicadas:
  - Máquina de estados explícita: solo se permiten transiciones válidas de negocio.
  - Notificaciones extraídas a funciones privadas (SRP) para evitar duplicación.
  - `actualizar_vehiculo` valida transiciones y registra en audit log.
  - `regenerar_qr` regenera el qr_secret TOTP (invalida todos los códigos futuros).
  - Notificaciones a admins se envían en hilo separado para no bloquear la request.
"""
import hashlib
import secrets
import uuid
import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime, date
from django.db import transaction

from .models import TipoVehiculo, Vehiculo, DocumentoVehiculo, HistorialPropietario
from apps.usuarios.utils import tiene_rol

ESTADOS_VALIDOS = ["pendiente", "activo", "inactivo", "sancionado"]

# ── Máquina de estados de vehículos ───────────────────────────────────────
# Solo estas transiciones tienen sentido de negocio en la UAGRM.
# Cualquier otra combinación es un error de operador.
TRANSICIONES_VALIDAS: dict[str, list[str]] = {
    "pendiente":  ["activo", "inactivo"],   # aprobar o rechazar
    "activo":     ["inactivo", "sancionado"],# desactivar o multar
    "inactivo":   ["activo"],               # reactivar (admin)
    "sancionado": ["activo"],               # pago de multas (solo via pagar_multa)
}


def _validar_transicion(estado_actual: str, estado_nuevo: str) -> None:
    """
    Valida que la transición de estado sea coherente con el flujo de negocio.
    Raises Exception con mensaje descriptivo para el admin.
    """
    permitidos = TRANSICIONES_VALIDAS.get(estado_actual, [])
    if estado_nuevo not in permitidos:
        raise Exception(
            f"Transición inválida: {estado_actual} → {estado_nuevo}. "
            f"Desde '{estado_actual}' solo se permite ir a: {', '.join(permitidos) or 'ningún estado'}."
        )


# ── Types ──────────────────────────────────────────────────────────────────

@strawberry.type
class TipoVehiculoType:
    id: int
    nombre: str
    descripcion: str


@strawberry.type
class DocumentoVehiculoType:
    id: int
    tipo_doc: str
    numero: str
    fecha_vencimiento: date
    created_at: datetime


@strawberry.type
class VehiculoType:
    id: int
    placa: str
    marca: str
    modelo: str
    anio: int
    color: str
    estado: str
    codigo_qr: str
    created_at: datetime

    @strawberry.field
    def tipo(self) -> TipoVehiculoType:
        return self.tipo

    @strawberry.field
    def propietario_nombre(self) -> str:
        return f"{self.propietario.nombre} {self.propietario.apellido}"

    @strawberry.field
    def documentos(self) -> List[DocumentoVehiculoType]:
        return list(self.documentos.all())


@strawberry.type
class HistorialPropietarioType:
    id: int
    fecha_inicio: date
    fecha_fin: Optional[date]

    @strawberry.field
    def propietario_nombre(self) -> str:
        return f"{self.usuario.nombre} {self.usuario.apellido}"


@strawberry.type
class VehiculosPage:
    items: List[VehiculoType]
    total: int
    pagina: int
    total_paginas: int


@strawberry.type
class QrDinamicoType:
    codigo: str
    segundos_restantes: int
    intervalo: int


# ── Inputs ─────────────────────────────────────────────────────────────────

@strawberry.input
class CrearVehiculoInput:
    placa: str
    tipo_id: int
    propietario_id: int
    marca: str
    modelo: str
    anio: int
    color: str


@strawberry.input
class ActualizarVehiculoInput:
    marca: Optional[str] = None
    modelo: Optional[str] = None
    anio: Optional[int] = None
    color: Optional[str] = None
    estado: Optional[str] = None


@strawberry.input
class AgregarDocumentoInput:
    vehiculo_id: int
    tipo_doc: str
    numero: str
    fecha_vencimiento: str


# ── Notificaciones privadas (SRP) ──────────────────────────────────────────

def _notificar_vehiculo_pendiente(vehiculo, propietario) -> None:
    """Notifica a todos los admins que hay un vehículo pendiente. Async (thread)."""
    import threading

    def _enviar():
        try:
            from apps.usuarios.models import UsuarioRol
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            from apps.notificaciones.email_templates import email_vehiculo_pendiente
            admins = list(
                UsuarioRol.objects.filter(rol__nombre="Administrador")
                .select_related("usuario").distinct()
            )
            for ur in admins:
                enviar_notificacion(
                    usuario=ur.usuario,
                    titulo=f"Vehículo pendiente — {vehiculo.placa}",
                    mensaje=(
                        f"{vehiculo.marca} {vehiculo.modelo} de "
                        f"{propietario.nombre} {propietario.apellido} requiere aprobación."
                    ),
                    tipo_codigo="vehiculo_pendiente",
                )
            asunto, html = email_vehiculo_pendiente(
                propietario.nombre, vehiculo.placa, vehiculo.marca, vehiculo.modelo
            )
            enviar_email(
                usuario=propietario,
                asunto=asunto,
                cuerpo=f"Tu vehículo {vehiculo.placa} está pendiente de aprobación.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


def _notificar_vehiculo_aprobado(vehiculo) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            from apps.notificaciones.email_templates import email_vehiculo_aprobado
            enviar_notificacion(
                usuario=vehiculo.propietario,
                titulo=f"Vehículo aprobado — {vehiculo.placa}",
                mensaje=f"Tu vehículo {vehiculo.marca} {vehiculo.modelo} fue aprobado.",
                tipo_codigo="vehiculo_aprobado",
            )
            asunto, html = email_vehiculo_aprobado(
                vehiculo.propietario.nombre, vehiculo.placa, vehiculo.marca, vehiculo.modelo
            )
            enviar_email(
                usuario=vehiculo.propietario,
                asunto=asunto,
                cuerpo=f"Tu vehículo {vehiculo.placa} fue aprobado.",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


def _notificar_vehiculo_rechazado(vehiculo, motivo: str) -> None:
    import threading

    def _enviar():
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            from apps.notificaciones.email_templates import email_vehiculo_rechazado
            enviar_notificacion(
                usuario=vehiculo.propietario,
                titulo=f"Vehículo rechazado — {vehiculo.placa}",
                mensaje=f"Tu vehículo no fue aprobado. Motivo: {motivo}",
                tipo_codigo="vehiculo_rechazado",
            )
            asunto, html = email_vehiculo_rechazado(
                vehiculo.propietario.nombre, vehiculo.placa,
                vehiculo.marca, vehiculo.modelo, motivo,
            )
            enviar_email(
                usuario=vehiculo.propietario,
                asunto=asunto,
                cuerpo=f"Tu vehículo {vehiculo.placa} no fue aprobado. Motivo: {motivo}",
                html=html,
            )
        except Exception:
            pass

    threading.Thread(target=_enviar, daemon=True).start()


# ── Queries ────────────────────────────────────────────────────────────────

@strawberry.type
class VehiculosQuery:
    @strawberry.field
    def vehiculos(
        self,
        info: Info,
        propietario_id: Optional[int] = None,
        buscar: Optional[str] = None,
        estado: Optional[str] = None,
        pagina: int = 1,
        por_pagina: int = 20,
    ) -> VehiculosPage:
        from django.db.models import Q
        qs = Vehiculo.objects.select_related("tipo", "propietario")
        if propietario_id:
            qs = qs.filter(propietario_id=propietario_id)
        if estado:
            qs = qs.filter(estado=estado)
        if buscar:
            b = buscar.strip()
            qs = qs.filter(
                Q(placa__icontains=b)
                | Q(marca__icontains=b)
                | Q(modelo__icontains=b)
                | Q(propietario__nombre__icontains=b)
                | Q(propietario__apellido__icontains=b)
            )
        usuario = info.context.request.user
        if not tiene_rol(usuario, "Administrador"):
            if usuario.is_authenticated:
                qs = qs.filter(~Q(estado="pendiente") | Q(propietario=usuario))
            else:
                qs = qs.exclude(estado="pendiente")

        qs = qs.order_by("-created_at")
        total = qs.count()
        pagina = max(1, pagina)
        offset = (pagina - 1) * por_pagina
        items = list(qs[offset: offset + por_pagina])
        total_paginas = max(1, (total + por_pagina - 1) // por_pagina)
        return VehiculosPage(items=items, total=total, pagina=pagina, total_paginas=total_paginas)

    @strawberry.field
    def vehiculos_pendientes(self, info: Info) -> List[VehiculoType]:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden ver vehículos pendientes")
        return list(
            Vehiculo.objects.select_related("tipo", "propietario")
            .filter(estado="pendiente").order_by("created_at")
        )

    @strawberry.field
    def vehiculo(self, info: Info, id: int) -> Optional[VehiculoType]:
        return Vehiculo.objects.select_related("tipo", "propietario").filter(pk=id).first()

    @strawberry.field
    def vehiculo_por_placa(self, info: Info, placa: str) -> Optional[VehiculoType]:
        return Vehiculo.objects.select_related("tipo", "propietario").filter(placa=placa.upper()).first()

    @strawberry.field
    def tipos_vehiculo(self, info: Info) -> List[TipoVehiculoType]:
        return list(TipoVehiculo.objects.all())

    @strawberry.field
    def historial_propietarios(self, info: Info, vehiculo_id: int) -> List[HistorialPropietarioType]:
        return list(
            HistorialPropietario.objects.filter(vehiculo_id=vehiculo_id)
            .select_related("usuario").order_by("-fecha_inicio")
        )

    @strawberry.field
    def qr_dinamico_vehiculo(self, info: Info, vehiculo_id: int) -> QrDinamicoType:
        """
        Retorna el código TOTP actual. El qr_secret NUNCA sale del servidor.
        Solo accesible por el propietario o un administrador.
        """
        from apps.vehiculos.models import generar_qr_dinamico, QR_INTERVAL
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        v = Vehiculo.objects.filter(pk=vehiculo_id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        if not tiene_rol(user, "Administrador") and v.propietario_id != user.pk:
            raise Exception("Solo puedes ver el QR de tu propio vehículo")
        if v.estado != "activo":
            raise Exception(f"El vehículo no está activo (estado: {v.estado})")
        if not v.qr_secret:
            raise Exception("Este vehículo no tiene QR dinámico. Use 'Invalidar QR' para generar uno.")
        codigo, segundos = generar_qr_dinamico(v.qr_secret)
        return QrDinamicoType(codigo=codigo, segundos_restantes=segundos, intervalo=QR_INTERVAL)


# ── Mutations ──────────────────────────────────────────────────────────────

@strawberry.type
class VehiculosMutation:

    @strawberry.mutation
    def registrar_vehiculo(self, info: Info, input: CrearVehiculoInput) -> VehiculoType:
        from apps.usuarios.models import Usuario
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        if not tiene_rol(user, "Administrador") and input.propietario_id != user.pk:
            raise Exception("Solo puedes registrar vehículos a tu propia cuenta")
        if Vehiculo.objects.filter(placa=input.placa.upper()).exists():
            raise Exception(f"La placa {input.placa.upper()} ya está registrada en el sistema")
        tipo       = TipoVehiculo.objects.filter(pk=input.tipo_id).first()
        propietario = Usuario.objects.filter(pk=input.propietario_id).first()
        if not tipo:
            raise Exception("Tipo de vehículo no encontrado")
        if not propietario:
            raise Exception("Propietario no encontrado")

        estado_inicial = "activo" if tiene_rol(user, "Administrador") else "pendiente"
        with transaction.atomic():
            vehiculo = Vehiculo.objects.create(
                placa=input.placa.upper(),
                tipo=tipo, propietario=propietario,
                marca=input.marca, modelo=input.modelo,
                anio=input.anio, color=input.color,
                estado=estado_inicial,
            )
            HistorialPropietario.objects.create(
                vehiculo=vehiculo,
                usuario=propietario,
                fecha_inicio=vehiculo.created_at.date(),
            )

        # Notificar solo si está pendiente (propietario registró para sí mismo)
        if estado_inicial == "pendiente":
            _notificar_vehiculo_pendiente(vehiculo, propietario)
        return vehiculo

    @strawberry.mutation
    def aprobar_vehiculo(self, info: Info, vehiculo_id: int) -> VehiculoType:
        from apps.acceso.utils import log_audit
        admin = info.context.request.user
        if not tiene_rol(admin, "Administrador"):
            raise Exception("Solo administradores pueden aprobar vehículos")
        v = Vehiculo.objects.select_related("tipo", "propietario").filter(pk=vehiculo_id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        _validar_transicion(v.estado, "activo")
        with transaction.atomic():
            v.estado = "activo"
            v.save(update_fields=["estado"])
            log_audit(admin, "vehiculo_aprobado", f"Vehículo {v.placa} aprobado", request=info.context.request)
        _notificar_vehiculo_aprobado(v)
        return v

    @strawberry.mutation
    def rechazar_vehiculo(self, info: Info, vehiculo_id: int, motivo: str) -> VehiculoType:
        from apps.acceso.utils import log_audit
        admin = info.context.request.user
        if not tiene_rol(admin, "Administrador"):
            raise Exception("Solo administradores pueden rechazar vehículos")
        if not motivo.strip():
            raise Exception("El motivo del rechazo es obligatorio")
        v = Vehiculo.objects.select_related("tipo", "propietario").filter(pk=vehiculo_id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        _validar_transicion(v.estado, "inactivo")
        with transaction.atomic():
            v.estado = "inactivo"
            v.save(update_fields=["estado"])
            log_audit(
                admin, "vehiculo_rechazado",
                f"Vehículo {v.placa} rechazado. Motivo: {motivo}",
                request=info.context.request,
            )
        _notificar_vehiculo_rechazado(v, motivo)
        return v

    @strawberry.mutation
    def actualizar_vehiculo(self, info: Info, id: int, input: ActualizarVehiculoInput) -> VehiculoType:
        """
        Actualiza datos del vehículo respetando la máquina de estados.
        Cambios de estado quedan registrados en el audit log.
        """
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden actualizar vehículos")
        v = Vehiculo.objects.filter(pk=id).first()
        if not v:
            raise Exception("Vehículo no encontrado")

        campos_actualizados = []
        if input.marca  is not None: v.marca  = input.marca;  campos_actualizados.append("marca")
        if input.modelo is not None: v.modelo = input.modelo; campos_actualizados.append("modelo")
        if input.anio   is not None: v.anio   = input.anio;   campos_actualizados.append("anio")
        if input.color  is not None: v.color  = input.color;  campos_actualizados.append("color")

        if input.estado is not None:
            if input.estado not in ESTADOS_VALIDOS:
                raise Exception(f"Estado inválido. Opciones: {', '.join(ESTADOS_VALIDOS)}")
            _validar_transicion(v.estado, input.estado)
            campos_actualizados.append(f"estado ({v.estado}→{input.estado})")
            v.estado = input.estado

        if not campos_actualizados:
            return v

        v.save()
        log_audit(
            user, "vehiculo_actualizado",
            f"Vehículo {v.placa} actualizado: {', '.join(campos_actualizados)}",
            request=info.context.request,
        )
        return v

    @strawberry.mutation
    def regenerar_qr(self, info: Info, vehiculo_id: int) -> VehiculoType:
        """
        Invalida el QR dinámico generando un nuevo qr_secret TOTP.
        Todos los códigos TOTP anteriores quedan inválidos inmediatamente.
        """
        solicitante = info.context.request.user
        if not solicitante.is_authenticated:
            raise Exception("Autenticación requerida")
        v = Vehiculo.objects.select_related("tipo", "propietario").filter(pk=vehiculo_id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        if not tiene_rol(solicitante, "Administrador") and v.propietario_id != solicitante.pk:
            raise Exception("Solo puedes regenerar el QR de tu propio vehículo")

        # Nuevo secret TOTP — invalida todos los códigos futuros de este vehículo
        v.qr_secret = secrets.token_hex(32)
        # Regenerar también el QR estático legacy para compatibilidad
        v.codigo_qr = hashlib.sha256(f"{v.placa}-{uuid.uuid4()}".encode()).hexdigest()
        v.save(update_fields=["qr_secret", "codigo_qr"])

        # Invalida la caché TOTP del vehículo (por si había un código cacheado)
        # Nota: no podemos borrar por vehiculo_id sin conocer el código anterior,
        # pero el TTL de 55s hará que expire solo.
        return v

    @strawberry.mutation
    def agregar_documento(self, info: Info, input: AgregarDocumentoInput) -> DocumentoVehiculoType:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if not tiene_rol(user, "Administrador") and vehiculo.propietario_id != user.pk:
            raise Exception("Solo puedes agregar documentos a tus propios vehículos")
        if input.tipo_doc not in ["soat", "tecnica", "circulacion", "otro"]:
            raise Exception("Tipo de documento inválido. Opciones: soat, tecnica, circulacion, otro")
        fecha = date.fromisoformat(input.fecha_vencimiento)
        return DocumentoVehiculo.objects.create(
            vehiculo=vehiculo,
            tipo_doc=input.tipo_doc,
            numero=input.numero,
            fecha_vencimiento=fecha,
        )

    @strawberry.mutation
    def transferir_vehiculo(self, info: Info, vehiculo_id: int, nuevo_propietario_id: int) -> VehiculoType:
        from apps.acceso.utils import log_audit
        user = info.context.request.user
        if not tiene_rol(user, "Administrador"):
            raise Exception("Solo administradores pueden transferir vehículos")
        vehiculo = Vehiculo.objects.select_related("propietario").filter(pk=vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        from apps.usuarios.models import Usuario
        nuevo_propietario = Usuario.objects.filter(pk=nuevo_propietario_id).first()
        if not nuevo_propietario:
            raise Exception("Nuevo propietario no encontrado")
        if vehiculo.propietario_id == nuevo_propietario_id:
            raise Exception("El vehículo ya pertenece a este usuario")
        from django.utils import timezone as tz
        propietario_anterior = vehiculo.propietario
        with transaction.atomic():
            HistorialPropietario.objects.filter(
                vehiculo=vehiculo, fecha_fin__isnull=True
            ).update(fecha_fin=tz.now().date())
            HistorialPropietario.objects.create(
                vehiculo=vehiculo,
                usuario=nuevo_propietario,
                fecha_inicio=tz.now().date(),
            )
            vehiculo.propietario = nuevo_propietario
            vehiculo.save(update_fields=["propietario_id"])
            log_audit(
                user, "vehiculo_transferido",
                f"Vehículo {vehiculo.placa}: {propietario_anterior.ci} → {nuevo_propietario.ci}",
                request=info.context.request,
            )
        return vehiculo

    @strawberry.mutation
    def crear_tipo_vehiculo(self, info: Info, nombre: str, descripcion: Optional[str] = "") -> TipoVehiculoType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden crear tipos de vehículo")
        if TipoVehiculo.objects.filter(nombre=nombre).exists():
            raise Exception(f"Ya existe el tipo '{nombre}'")
        return TipoVehiculo.objects.create(nombre=nombre, descripcion=descripcion or "")
