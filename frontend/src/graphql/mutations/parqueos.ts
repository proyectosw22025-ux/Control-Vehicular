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
