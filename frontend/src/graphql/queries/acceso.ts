import { gql } from '@apollo/client'

export const PUNTOS_ACCESO_QUERY = gql`
  query PuntosAcceso {
    puntosAcceso { id nombre ubicacion tipo activo }
  }
`

export const REGISTROS_ACCESO_QUERY = gql`
  query RegistrosAcceso($vehiculoId: Int, $puntoId: Int, $limite: Int) {
    registrosAcceso(vehiculoId: $vehiculoId, puntoId: $puntoId, limite: $limite) {
      id
      tipo
      metodoAcceso
      timestamp
      observacion
      puntoNombre
      placaVehiculo
    }
  }
`

export const QR_DELEGACIONES_QUERY = gql`
  query QrDelegacionesVehiculo($vehiculoId: Int!) {
    qrDelegacionesVehiculo(vehiculoId: $vehiculoId) {
      id
      codigoHash
      motivo
      fechaGeneracion
      fechaExpiracion
      usado
      vigente
      placaVehiculo
    }
  }
`
