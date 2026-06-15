import { gql } from '@apollo/client'

export const REGISTRAR_ACCESO_MUTATION = gql`
  mutation RegistrarAcceso($input: ValidarAccesoInput!) {
    registrarAcceso(input: $input) {
      id tipo metodoAcceso timestamp observacion puntoNombre placaVehiculo
      propietarioNombre propietarioFotoUrl propietarioRol esFrecuente
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
      propietarioNombre propietarioFotoUrl propietarioRol esFrecuente
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

export const CREAR_AUTORIZACION_EXTERNA_MUTATION = gql`
  mutation CrearAutorizacionExterna(
    $placa: String! $empresa: String! $motivo: String!
    $validoDesde: String! $validoHasta: String!
    $dependenciaId: Int $emailProveedor: String $observacion: String
  ) {
    crearAutorizacionExterna(
      placa: $placa empresa: $empresa motivo: $motivo
      validoDesde: $validoDesde validoHasta: $validoHasta
      dependenciaId: $dependenciaId emailProveedor: $emailProveedor
      observacion: $observacion
    ) {
      id placa empresa motivo codigoAcceso estado vigente
      emailEnviado urlVerificacion validoDesde validoHasta
      dependenciaNombre
    }
  }
`

export const REVOCAR_AUTORIZACION_EXTERNA_MUTATION = gql`
  mutation RevocarAutorizacionExterna($authId: Int!) {
    revocarAutorizacionExterna(authId: $authId) { id activo estado }
  }
`

export const REGISTRAR_ACCESO_TEMPORAL_MUTATION = gql`
  mutation RegistrarAccesoTemporal(
    $placa: String! $tipo: String! $destino: String!
    $duracionHoras: Float! $responsable: String $observacion: String
  ) {
    registrarAccesoTemporal(
      placa: $placa tipo: $tipo destino: $destino
      duracionHoras: $duracionHoras responsable: $responsable observacion: $observacion
    ) {
      id placa tipo tipoDisplay destino horaIngreso horaLimite activo minutosRestantes
    }
  }
`

export const REGISTRAR_SALIDA_TEMPORAL_MUTATION = gql`
  mutation RegistrarSalidaTemporal($placa: String! $observacion: String) {
    registrarSalidaTemporal(placa: $placa observacion: $observacion) {
      id placa activo horaSalida
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
      tipoDelegacion
      tipoDelegacionDisplay
      usosMax
      usosActual
      usosRestantes
      urlQr
      placaVehiculo
      tipoDestinatario
      destinatarioNombre
      destinatarioCi
      destinatarioDisplay
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
