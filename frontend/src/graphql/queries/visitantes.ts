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
      procedencia
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
      numAcompanantes
      duracionMinutos
      visitante { id nombreCompleto ci telefono procedencia }
      anfitrionNombre
      dependencia { nombre codigo ubicacion }
      tipoVisita { nombre requiereVehiculo }
      placaVehiculo
    }
  }
`

export const VISITAS_HISTORIAL_QUERY = gql`
  query VisitasHistorial(
    $estado: String
    $fechaDesde: String
    $fechaHasta: String
    $buscar: String
    $limite: Int
  ) {
    visitasHistorial(
      estado: $estado
      fechaDesde: $fechaDesde
      fechaHasta: $fechaHasta
      buscar: $buscar
      limite: $limite
    ) {
      id
      motivo
      estado
      fechaEntrada
      fechaSalida
      duracionMinutos
      observaciones
      placaVehiculoVisitante
      numAcompanantes
      tipoCierre
      visitante { nombreCompleto ci procedencia }
      anfitrionNombre
      tipoVisita { nombre duracionEsperadaHoras }
    }
  }
`

export const TIPOS_VISITA_QUERY = gql`
  query TiposVisita {
    tiposVisita { id nombre descripcion requiereVehiculo duracionEsperadaHoras }
  }
`

export const DEPENDENCIAS_QUERY = gql`
  query DependenciasUagrm($buscar: String) {
    dependenciasUagrm(buscar: $buscar) {
      id nombre codigo descripcion ubicacion
    }
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
