import { gql } from '@apollo/client'

export const MARCAR_LEIDA_MUTATION = gql`
  mutation MarcarLeida($notificacionId: Int!) {
    marcarLeida(notificacionId: $notificacionId) {
      id titulo leido
    }
  }
`

export const MARCAR_TODAS_LEIDAS_MUTATION = gql`
  mutation MarcarTodasLeidas {
    marcarTodasLeidas
  }
`
