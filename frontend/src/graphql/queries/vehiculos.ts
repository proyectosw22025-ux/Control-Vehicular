import { gql } from '@apollo/client'

export const VEHICULOS_QUERY = gql`
  query Vehiculos(
    $propietarioId: Int
    $buscar: String
    $estado: String
    $pagina: Int
    $porPagina: Int
  ) {
    vehiculos(
      propietarioId: $propietarioId
      buscar: $buscar
      estado: $estado
      pagina: $pagina
      porPagina: $porPagina
    ) {
      items {
        id
        placa
        marca
        modelo
        anio
        color
        estado
        codigoQr
        createdAt
        tipo { id nombre }
        propietarioNombre
        documentos { id tipoDoc numero fechaVencimiento }
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
      id
      placa
      marca
      modelo
      anio
      color
      estado
      createdAt
      tipo { id nombre }
      propietarioNombre
    }
  }
`
