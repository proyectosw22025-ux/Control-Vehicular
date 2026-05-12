import hashlib
import uuid
import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime, date
from django.db.models import Q

from .models import TipoVehiculo, Vehiculo, DocumentoVehiculo, HistorialPropietario
from apps.usuarios.utils import tiene_rol

ESTADOS_VALIDOS = ["pendiente", "activo", "inactivo", "sancionado"]


@strawberry.type
class QrDinamicoType:
    codigo: str
    segundos_restantes: int
    intervalo: int


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


# ──────────────────────────────────────────────
# INPUTS
# ──────────────────────────────────────────────

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


# ──────────────────────────────────────────────
# QUERIES
# ──────────────────────────────────────────────

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
        # Admins ven todo; otros ven sus propios pendientes + todos los activos/demás
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
            .filter(estado="pendiente")
            .order_by("created_at")
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
        Retorna el código QR dinámico actual del vehículo (TOTP, caduca cada 30s).
        Solo el propietario o un administrador puede solicitarlo.
        El secret NUNCA viaja al cliente — solo el código generado.
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
            raise Exception("Este vehículo aún no tiene QR dinámico. Regenere el QR.")
        codigo, segundos = generar_qr_dinamico(v.qr_secret)
        return QrDinamicoType(codigo=codigo, segundos_restantes=segundos, intervalo=QR_INTERVAL)


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class VehiculosMutation:
    @strawberry.mutation
    def registrar_vehiculo(self, info: Info, input: CrearVehiculoInput) -> VehiculoType:
        from apps.usuarios.models import Usuario
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        # Admins can register for anyone; others can only register their own vehicle
        if not tiene_rol(user, "Administrador") and input.propietario_id != user.pk:
            raise Exception("Solo puedes registrar vehículos a tu propia cuenta")
        if Vehiculo.objects.filter(placa=input.placa.upper()).exists():
            raise Exception(f"La placa {input.placa} ya está registrada")
        tipo = TipoVehiculo.objects.filter(pk=input.tipo_id).first()
        propietario = Usuario.objects.filter(pk=input.propietario_id).first()
        if not tipo:
            raise Exception("Tipo de vehículo no encontrado")
        if not propietario:
            raise Exception("Propietario no encontrado")
        # Admin registra directamente como activo (no necesita aprobación de sí mismo)
        # Propietario registra su propio vehículo → pendiente de aprobación
        estado_inicial = "activo" if tiene_rol(user, "Administrador") else "pendiente"
        vehiculo = Vehiculo.objects.create(
            placa=input.placa.upper(),
            tipo=tipo,
            propietario=propietario,
            marca=input.marca,
            modelo=input.modelo,
            anio=input.anio,
            color=input.color,
            estado=estado_inicial,
        )
        HistorialPropietario.objects.create(
            vehiculo=vehiculo,
            usuario=propietario,
            fecha_inicio=vehiculo.created_at.date(),
        )
        try:
            from apps.usuarios.models import UsuarioRol
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            admins = [ur.usuario for ur in UsuarioRol.objects.filter(
                rol__nombre="Administrador"
            ).select_related("usuario").distinct()]
            for admin in admins:
                enviar_notificacion(
                    usuario=admin,
                    titulo=f"Vehículo pendiente — {vehiculo.placa}",
                    mensaje=f"{vehiculo.marca} {vehiculo.modelo} registrado por {propietario.nombre} {propietario.apellido} requiere aprobación.",
                    tipo_codigo="vehiculo_pendiente",
                )
            enviar_email(
                usuario=propietario,
                asunto=f"Vehículo {vehiculo.placa} registrado — pendiente de aprobación",
                cuerpo=(
                    f"Hola {propietario.nombre},\n\n"
                    f"Tu vehículo {vehiculo.marca} {vehiculo.modelo} ({vehiculo.placa}) ha sido registrado "
                    f"y está pendiente de aprobación por un administrador.\n\n"
                    f"Recibirás otra notificación cuando sea procesado.\n"
                ),
            )
        except Exception:
            pass
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
        if v.estado != "pendiente":
            raise Exception("El vehículo no está pendiente de aprobación")
        v.estado = "activo"
        v.save()
        log_audit(admin, "vehiculo_aprobado", f"Vehículo {v.placa} aprobado", request=info.context.request)
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            enviar_notificacion(
                usuario=v.propietario,
                titulo=f"Vehículo aprobado — {v.placa}",
                mensaje=f"Tu vehículo {v.marca} {v.modelo} ({v.placa}) fue aprobado y está activo.",
                tipo_codigo="vehiculo_aprobado",
            )
            enviar_email(
                usuario=v.propietario,
                asunto=f"Vehículo {v.placa} aprobado",
                cuerpo=(
                    f"Hola {v.propietario.nombre},\n\n"
                    f"Tu vehículo {v.marca} {v.modelo} ({v.placa}) ha sido aprobado y está activo en el sistema.\n\n"
                    f"Ya puedes usar el QR para acceder al parqueo.\n"
                ),
            )
        except Exception:
            pass
        return v

    @strawberry.mutation
    def rechazar_vehiculo(self, info: Info, vehiculo_id: int, motivo: str) -> VehiculoType:
        from apps.acceso.utils import log_audit
        admin = info.context.request.user
        if not tiene_rol(admin, "Administrador"):
            raise Exception("Solo administradores pueden rechazar vehículos")
        v = Vehiculo.objects.select_related("tipo", "propietario").filter(pk=vehiculo_id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        if v.estado != "pendiente":
            raise Exception("El vehículo no está pendiente de aprobación")
        v.estado = "inactivo"
        v.save()
        log_audit(admin, "vehiculo_rechazado", f"Vehículo {v.placa} rechazado. Motivo: {motivo}", request=info.context.request)
        try:
            from apps.notificaciones.utils import enviar_notificacion, enviar_email
            enviar_notificacion(
                usuario=v.propietario,
                titulo=f"Vehículo rechazado — {v.placa}",
                mensaje=f"Tu vehículo {v.marca} {v.modelo} ({v.placa}) no fue aprobado. Motivo: {motivo}",
                tipo_codigo="vehiculo_rechazado",
            )
            enviar_email(
                usuario=v.propietario,
                asunto=f"Vehículo {v.placa} no aprobado",
                cuerpo=(
                    f"Hola {v.propietario.nombre},\n\n"
                    f"Tu vehículo {v.marca} {v.modelo} ({v.placa}) no fue aprobado.\n"
                    f"Motivo: {motivo}\n\n"
                    f"Puedes contactar con administración para más información.\n"
                ),
            )
        except Exception:
            pass
        return v

    @strawberry.mutation
    def actualizar_vehiculo(self, info: Info, id: int, input: ActualizarVehiculoInput) -> VehiculoType:
        if not tiene_rol(info.context.request.user, "Administrador"):
            raise Exception("Solo administradores pueden actualizar vehículos")
        v = Vehiculo.objects.filter(pk=id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        if input.marca is not None:
            v.marca = input.marca
        if input.modelo is not None:
            v.modelo = input.modelo
        if input.anio is not None:
            v.anio = input.anio
        if input.color is not None:
            v.color = input.color
        if input.estado is not None:
            if input.estado not in ESTADOS_VALIDOS:
                raise Exception(f"Estado inválido. Opciones: {', '.join(ESTADOS_VALIDOS)}")
            v.estado = input.estado
        v.save()
        return v

    @strawberry.mutation
    def regenerar_qr(self, info: Info, vehiculo_id: int) -> VehiculoType:
        solicitante = info.context.request.user
        if not solicitante.is_authenticated:
            raise Exception("Autenticación requerida")
        v = Vehiculo.objects.select_related("tipo", "propietario").filter(pk=vehiculo_id).first()
        if not v:
            raise Exception("Vehículo no encontrado")
        if not tiene_rol(solicitante, "Administrador") and v.propietario_id != solicitante.pk:
            raise Exception("Solo puedes regenerar el QR de tu propio vehículo")
        v.codigo_qr = hashlib.sha256(f"{v.placa}-{uuid.uuid4()}".encode()).hexdigest()
        v.save()
        return v

    @strawberry.mutation
    def agregar_documento(self, info: Info, input: AgregarDocumentoInput) -> DocumentoVehiculoType:
        user = info.context.request.user
        if not user.is_authenticated:
            raise Exception("Autenticación requerida")
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        # Admin puede agregar a cualquier vehículo; propietario solo al suyo
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
        # Cerrar historial del propietario actual
        HistorialPropietario.objects.filter(
            vehiculo=vehiculo, fecha_fin__isnull=True
        ).update(fecha_fin=tz.now().date())
        # Abrir historial para el nuevo propietario
        HistorialPropietario.objects.create(
            vehiculo=vehiculo,
            usuario=nuevo_propietario,
            fecha_inicio=tz.now().date(),
        )
        propietario_anterior = vehiculo.propietario
        vehiculo.propietario = nuevo_propietario
        vehiculo.save()
        log_audit(
            user, "vehiculo_transferido",
            f"Vehículo {vehiculo.placa} transferido de {propietario_anterior.ci} a {nuevo_propietario.ci}",
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
