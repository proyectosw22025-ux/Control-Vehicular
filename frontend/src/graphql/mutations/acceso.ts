import { gql } from '@apollo/client'

export const REGISTRAR_ACCESO_MUTATION = gql`
  mutation RegistrarAcceso($input: ValidarAccesoInput!) {
    registrarAcceso(input: $input) {
      id tipo metodoAcceso timestamp observacion puntoNombre placaVehiculo
      alertasDetectadas {
        id tipoAnomalia severidad descripcion fecha vehiculoPlaca
      }
    }
  }
`

export const REGISTRAR_ACCESO_MANUAL_MUTATION = gql`
  mutation RegistrarAccesoManual($input: AccesoManualInput!) {
    registrarAccesoManual(input: $input) {
      id tipo metodoAcceso timestamp puntoNombre placaVehiculo
      alertasDetectadas {
        id tipoAnomalia severidad descripcion fecha vehiculoPlaca
      }
    }
  }
`

export const MARCAR_ALERTA_REVISADA_MUTATION = gql`
  mutation MarcarAlertaRevisada($alertaId: Int!) {
    marcarAlertaRevisada(alertaId: $alertaId) { id revisada }
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

export const REVOCAR_QR_DELEGACION_MUTATION = gql`
  mutation RevocarQrDelegacion($qrId: Int!) {
    revocarQrDelegacion(qrId: $qrId)
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
