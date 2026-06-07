import { gql } from '@apollo/client'

export const INFRACCIONES_VEHICULO_QUERY = gql`
  query InfraccionesVehiculo($vehiculoId: Int!, $estado: String) {
    infraccionesVehiculo(vehiculoId: $vehiculoId, estado: $estado) {
      id
      descripcion
      fecha
      estado
      tipo { nombre descripcion gravedad tipoSancionSugerido montoBase }
      placaVehiculo
      registradoPorNombre
      tieneApelacion
      sancion { id tipoSancion monto estado fecha }
    }
  }
`

export const SANCIONES_PENDIENTES_QUERY = gql`
  query SancionesPendientes {
    sancionesPendientes {
      id
      tipoSancion
      monto
      estado
      fecha
      infraccionId
      placaVehiculo
      tipoInfraccionNombre
      descripcionInfraccion
    }
  }
`

export const TIPOS_INFRACCION_QUERY = gql`
  query TiposInfraccion {
    tiposInfraccion { id nombre descripcion gravedad tipoSancionSugerido montoBase }
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
