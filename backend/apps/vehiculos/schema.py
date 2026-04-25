import strawberry
from strawberry.types import Info
from typing import List, Optional
from datetime import datetime, date

from .models import TipoVehiculo, Vehiculo, DocumentoVehiculo, HistorialPropietario


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
    def vehiculos(self, info: Info, propietario_id: Optional[int] = None) -> List[VehiculoType]:
        qs = Vehiculo.objects.select_related("tipo", "propietario")
        if propietario_id:
            qs = qs.filter(propietario_id=propietario_id)
        return list(qs)

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


# ──────────────────────────────────────────────
# MUTATIONS
# ──────────────────────────────────────────────

@strawberry.type
class VehiculosMutation:
    @strawberry.mutation
    def registrar_vehiculo(self, info: Info, input: CrearVehiculoInput) -> VehiculoType:
        from apps.usuarios.models import Usuario
        if Vehiculo.objects.filter(placa=input.placa.upper()).exists():
            raise Exception(f"La placa {input.placa} ya está registrada")
        tipo = TipoVehiculo.objects.filter(pk=input.tipo_id).first()
        propietario = Usuario.objects.filter(pk=input.propietario_id).first()
        if not tipo:
            raise Exception("Tipo de vehículo no encontrado")
        if not propietario:
            raise Exception("Propietario no encontrado")
        vehiculo = Vehiculo.objects.create(
            placa=input.placa.upper(),
            tipo=tipo,
            propietario=propietario,
            marca=input.marca,
            modelo=input.modelo,
            anio=input.anio,
            color=input.color,
        )
        HistorialPropietario.objects.create(
            vehiculo=vehiculo,
            usuario=propietario,
            fecha_inicio=vehiculo.created_at.date(),
        )
        return vehiculo

    @strawberry.mutation
    def actualizar_vehiculo(self, info: Info, id: int, input: ActualizarVehiculoInput) -> VehiculoType:
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
            if input.estado not in ["activo", "inactivo", "sancionado"]:
                raise Exception("Estado inválido")
            v.estado = input.estado
        v.save()
        return v

    @strawberry.mutation
    def agregar_documento(self, info: Info, input: AgregarDocumentoInput) -> DocumentoVehiculoType:
        vehiculo = Vehiculo.objects.filter(pk=input.vehiculo_id).first()
        if not vehiculo:
            raise Exception("Vehículo no encontrado")
        if input.tipo_doc not in ["soat", "tecnica", "circulacion", "otro"]:
            raise Exception("Tipo de documento inválido")
        fecha = date.fromisoformat(input.fecha_vencimiento)
        return DocumentoVehiculo.objects.create(
            vehiculo=vehiculo,
            tipo_doc=input.tipo_doc,
            numero=input.numero,
            fecha_vencimiento=fecha,
        )

    @strawberry.mutation
    def crear_tipo_vehiculo(self, info: Info, nombre: str, descripcion: Optional[str] = "") -> TipoVehiculoType:
        if TipoVehiculo.objects.filter(nombre=nombre).exists():
            raise Exception(f"Ya existe el tipo '{nombre}'")
        return TipoVehiculo.objects.create(nombre=nombre, descripcion=descripcion or "")
