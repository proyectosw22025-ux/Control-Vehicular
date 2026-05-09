import { gql } from '@apollo/client'

export const VEHICULOS_QUERY = gql`
  query Vehiculos($propietarioId: Int) {
    vehiculos(propietarioId: $propietarioId) {
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
  }
`

export const TIPOS_VEHICULO_QUERY = gql`
  query TiposVehiculo {
    tiposVehiculo { id nombre descripcion }
  }
`
