import { gql } from '@apollo/client'

export const VEHICULOS_QUERY = gql`
  query Vehiculos(
    $propietarioId: Int
    $buscar: String
    $estado: String
    $pagina: Int
    $porPagina: Int
    $tipoId: Int
    $fechaDesde: String
    $fechaHasta: String
    $tieneInfraccionesActivas: Boolean
    $tieneDocumentosVencidos: Boolean
    $ordenarPor: String
    $color: String
  ) {
    vehiculos(
      propietarioId: $propietarioId
      buscar: $buscar
      estado: $estado
      pagina: $pagina
      porPagina: $porPagina
      tipoId: $tipoId
      fechaDesde: $fechaDesde
      fechaHasta: $fechaHasta
      tieneInfraccionesActivas: $tieneInfraccionesActivas
      tieneDocumentosVencidos: $tieneDocumentosVencidos
      ordenarPor: $ordenarPor
      color: $color
    ) {
      items {
        id
        placa
        marca
        modelo
        anio
        color
        estado
        enAlerta
        motivoAlerta
        codigoQr
        createdAt
        tipo { id nombre }
        propietarioNombre
        propietarioCi
        propietarioRoles
        estadoDocumentacion
        documentos { id tipoDoc numero fechaVencimiento estado diasParaVencer archivoUrl }
      }
      total
      pagina
      totalPaginas
    }
  }
`

export const VEHICULOS_PENDIENTES_QUERY = gql`
  query VehiculosPendientes {
    vehiculosPendientes {
      id
      placa
      marca
      modelo
      anio
      color
      createdAt
      tipo { id nombre }
      propietarioNombre
      documentos { id tipoDoc numero fechaVencimiento }
    }
  }
`

export const TIPOS_VEHICULO_QUERY = gql`
  query TiposVehiculo {
    tiposVehiculo { id nombre descripcion }
  }
`

export const VEHICULO_QUERY = gql`
  query Vehiculo($id: Int!) {
    vehiculo(id: $id) {
      id placa marca modelo anio color estado createdAt
      tipo { id nombre }
      propietarioNombre
      estadoDocumentacion
      documentos {
        id tipoDoc numero fechaVencimiento
        estado diasParaVencer archivoUrl
      }
    }
  }
`

export const HISTORIAL_ESTADOS_QUERY = gql`
  query HistorialEstadosVehiculo($vehiculoId: Int!) {
    historialEstadosVehiculo(vehiculoId: $vehiculoId) {
      id
      estadoAnterior
      estadoNuevo
      motivo
      fecha
      usuarioNombre
    }
  }
`

export const QR_DINAMICO_QUERY = gql`
  query QrDinamicoVehiculo($vehiculoId: Int!) {
    qrDinamicoVehiculo(vehiculoId: $vehiculoId) {
      codigo
      segundosRestantes
      intervalo
    }
  }
`

export const SUGERENCIAS_PLACA_QUERY = gql`
  query SugerenciasPlaca($placa: String!) {
    sugerenciasPlaca(placa: $placa) {
      id placa marca modelo color propietarioNombre
    }
  }
`
