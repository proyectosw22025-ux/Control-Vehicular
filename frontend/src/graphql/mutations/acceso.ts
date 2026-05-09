import { gql } from '@apollo/client'

export const REGISTRAR_ACCESO_MUTATION = gql`
  mutation RegistrarAcceso($input: ValidarAccesoInput!) {
    registrarAcceso(input: $input) {
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

export const REGISTRAR_ACCESO_MANUAL_MUTATION = gql`
  mutation RegistrarAccesoManual($input: AccesoManualInput!) {
    registrarAccesoManual(input: $input) {
      id
      tipo
      metodoAcceso
      timestamp
      puntoNombre
      placaVehiculo
    }
  }
`

export const GENERAR_QR_DELEGACION_MUTATION = gql`
  mutation GenerarQrDelegacion($input: GenerarQrDelegacionInput!) {
    generarQrDelegacion(input: $input) {
      id
      codigoHash
      motivo
      fechaGeneracion
      fechaExpiracion
      usado
      vigente
    }
  }
`

export const CREAR_PASE_TEMPORAL_MUTATION = gql`
  mutation CrearPaseTemporal($input: CrearPaseTemporalInput!) {
    crearPaseTemporal(input: $input) {
      id
      codigo
      validoDesde
      validoHasta
      usosMax
      usosActual
      activo
      vigente
      usosRestantes
    }
  }
`
