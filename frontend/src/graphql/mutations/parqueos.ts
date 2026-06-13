import { gql } from '@apollo/client'

export const CREAR_ZONA_MUTATION = gql`
  mutation CrearZona($input: CrearZonaInput!) {
    crearZona(input: $input) {
      id nombre descripcion ubicacion capacidadTotal activo espaciosDisponibles
    }
  }
`

export const CREAR_ESPACIO_MUTATION = gql`
  mutation CrearEspacio($input: CrearEspacioInput!) {
    crearEspacio(input: $input) {
      id numero estado ubicacionReferencia
      zona { nombre }
      categoria { nombre color }
    }
  }
`

export const INICIAR_SESION_MUTATION = gql`
  mutation IniciarSesionParqueo($input: IniciarSesionInput!) {
    iniciarSesionParqueo(input: $input) {
      id
      horaEntrada
      estado
      duracionMinutos
      espacio { numero zona { nombre } }
      placaVehiculo
    }
  }
`

export const CERRAR_SESION_MUTATION = gql`
  mutation CerrarSesionParqueo($sesionId: Int!) {
    cerrarSesionParqueo(sesionId: $sesionId) {
      id
      horaEntrada
      horaSalida
      estado
      duracionMinutos
      espacio { numero zona { nombre } }
    }
  }
`

export const CAMBIAR_ESTADO_ESPACIO_MUTATION = gql`
  mutation CambiarEstadoEspacio($espacioId: Int!, $enMantenimiento: Boolean!) {
    cambiarEstadoEspacio(espacioId: $espacioId, enMantenimiento: $enMantenimiento) {
      id numero estado
    }
  }
`

export const OCUPAR_ESPACIO_TEMPORAL_MUTATION = gql`
  mutation OcuparEspacioTemporal($espacioId: Int!, $vtId: Int!) {
    ocuparEspacioTemporal(espacioId: $espacioId, vehiculoTemporalId: $vtId) {
      id placaVehiculo espacio { numero zona { nombre } }
    }
  }
`
