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

export const ELIMINAR_NOTIFICACION_MUTATION = gql`
  mutation EliminarNotificacion($notificacionId: Int!) {
    eliminarNotificacion(notificacionId: $notificacionId)
  }
`

export const ELIMINAR_TODAS_LEIDAS_MUTATION = gql`
  mutation EliminarTodasLeidas {
    eliminarTodasLeidas
  }
`
