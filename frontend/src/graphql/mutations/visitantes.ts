import { gql } from '@apollo/client'

// Pública — no requiere auth. Permite a visitantes externos pre-registrar su CI.
export const PRE_REGISTRAR_VISITANTE_MUTATION = gql`
  mutation PreRegistrarVisitante($input: CrearVisitanteInput!) {
    preRegistrarVisitante(input: $input) {
      id
      ci
      nombreCompleto
    }
  }
`

export const REGISTRAR_VISITANTE_MUTATION = gql`
  mutation RegistrarVisitante($input: CrearVisitanteInput!) {
    registrarVisitante(input: $input) {
      id
      nombre
      apellido
      ci
      telefono
      email
      nombreCompleto
    }
  }
`

export const REGISTRAR_VISITA_MUTATION = gql`
  mutation RegistrarVisita($input: RegistrarVisitaInput!) {
    registrarVisita(input: $input) {
      id
      motivo
      estado
      placaVehiculoVisitante
      visitante { nombreCompleto ci }
      anfitrionNombre
    }
  }
`

export const INICIAR_VISITA_MUTATION = gql`
  mutation IniciarVisita($visitaId: Int!) {
    iniciarVisita(visitaId: $visitaId) {
      id estado fechaEntrada
    }
  }
`

export const FINALIZAR_VISITA_MUTATION = gql`
  mutation FinalizarVisita($visitaId: Int!, $observaciones: String) {
    finalizarVisita(visitaId: $visitaId, observaciones: $observaciones) {
      id estado fechaSalida observaciones
    }
  }
`

export const CANCELAR_VISITA_MUTATION = gql`
  mutation CancelarVisita($visitaId: Int!, $motivoCancelacion: String) {
    cancelarVisita(visitaId: $visitaId, motivoCancelacion: $motivoCancelacion) {
      id estado
    }
  }
`
