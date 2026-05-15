import { gql } from '@apollo/client'

export const VISITANTES_QUERY = gql`
  query Visitantes($buscar: String) {
    visitantes(buscar: $buscar) {
      id
      nombre
      apellido
      ci
      telefono
      email
      nombreCompleto
    }
  }
`

export const VISITAS_ACTIVAS_QUERY = gql`
  query VisitasActivas {
    visitasActivas {
      id
      motivo
      estado
      fechaEntrada
      observaciones
      placaVehiculoVisitante
      visitante { id nombreCompleto ci telefono }
      anfitrionNombre
      tipoVisita { nombre }
      placaVehiculo
    }
  }
`

export const TIPOS_VISITA_QUERY = gql`
  query TiposVisita {
    tiposVisita { id nombre descripcion requiereVehiculo }
  }
`

export const VISITAS_POR_ANFITRION_QUERY = gql`
  query VisitasPorAnfitrion($anfitrionId: Int!, $estado: String) {
    visitasPorAnfitrion(anfitrionId: $anfitrionId, estado: $estado) {
      id
      motivo
      estado
      fechaEntrada
      fechaSalida
      visitante { nombreCompleto ci }
      tipoVisita { nombre }
    }
  }
`
