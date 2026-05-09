import { gql } from '@apollo/client'

export const MULTAS_VEHICULO_QUERY = gql`
  query MultasVehiculo($vehiculoId: Int!, $estado: String) {
    multasVehiculo(vehiculoId: $vehiculoId, estado: $estado) {
      id
      monto
      descripcion
      fecha
      estado
      tipo { nombre descripcion montoBase }
      placaVehiculo
      registradoPorNombre
      tieneApelacion
    }
  }
`

export const MULTAS_PENDIENTES_QUERY = gql`
  query MultasPendientes {
    multasPendientes {
      id
      monto
      descripcion
      fecha
      estado
      tipo { nombre }
      placaVehiculo
      registradoPorNombre
      tieneApelacion
    }
  }
`

export const TIPOS_MULTA_QUERY = gql`
  query TiposMulta {
    tiposMulta { id nombre descripcion montoBase }
  }
`

export const APELACIONES_PENDIENTES_QUERY = gql`
  query ApelacionesPendientes {
    apelacionesPendientes {
      id
      motivo
      estado
      respuesta
      fecha
      usuarioNombre
    }
  }
`
