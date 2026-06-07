import strawberry
from apps.usuarios.schema import UsuariosQuery, UsuariosMutation
from apps.vehiculos.schema import VehiculosQuery, VehiculosMutation
from apps.parqueos.schema import ParqueosQuery, ParqueosMutation
from apps.acceso.schema import AccesoQuery, AccesoMutation
from apps.visitantes.schema import VisitantesQuery, VisitantesMutation
from apps.multas.schema import InfraccionesQuery, InfraccionesMutation
from apps.notificaciones.schema import NotificacionesQuery, NotificacionesMutation
from estadisticas_schema import EstadisticasQuery
from busqueda_schema import BusquedaQuery


@strawberry.type
class Query(
    UsuariosQuery,
    VehiculosQuery,
    ParqueosQuery,
    AccesoQuery,
    VisitantesQuery,
    InfraccionesQuery,
    NotificacionesQuery,
    EstadisticasQuery,
    BusquedaQuery,
):
    pass


@strawberry.type
class Mutation(
    UsuariosMutation,
    VehiculosMutation,
    ParqueosMutation,
    AccesoMutation,
    VisitantesMutation,
    InfraccionesMutation,
    NotificacionesMutation,
):
    pass


schema = strawberry.Schema(query=Query, mutation=Mutation)
