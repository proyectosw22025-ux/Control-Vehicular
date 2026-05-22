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

export const MIS_ACCESOS_QUERY = gql`
  query MisAccesos($limite: Int, $tipo: String) {
    misAccesos(limite: $limite, tipo: $tipo) {
      id
      tipo
      timestamp
      metodoAcceso
      puntoNombre
      placaVehiculo
      tipoVehiculo
      marcaModelo
      observacion
    }
  }
`

export const MIS_DELEGACIONES_QUERY = gql`
  query MisDelegaciones {
    misDelegaciones {
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
