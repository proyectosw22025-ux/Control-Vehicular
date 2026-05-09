import { gql } from '@apollo/client'

export const MIS_NOTIFICACIONES_QUERY = gql`
  query MisNotificaciones($soloNoLeidas: Boolean, $limite: Int) {
    misNotificaciones(soloNoLeidas: $soloNoLeidas, limite: $limite) {
      id
      titulo
      mensaje
      leido
      fecha
      tipoCodigo
    }
  }
`

export const CONTEO_NO_LEIDAS_QUERY = gql`
  query ConteoNoLeidas {
    conteoNoLeidas
  }
`
