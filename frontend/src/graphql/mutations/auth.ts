import { gql } from '@apollo/client'

export const LOGIN_MUTATION = gql`
  mutation Login($ci: String!, $password: String!, $codigoTotp: String) {
    login(input: { ci: $ci, password: $password, codigoTotp: $codigoTotp }) {
      access
      refresh
      usuario {
        id
        ci
        nombreCompleto
        email
        isSuperuser
        roles { nombre }
      }
    }
  }
`

export const INICIAR_2FA_MUTATION = gql`
  mutation Iniciar2FA {
    iniciarConfiguracion2fa { otpauthUrl secretBase32 }
  }
`

export const VERIFICAR_2FA_MUTATION = gql`
  mutation Verificar2FA($codigo: String!) {
    verificarConfiguracion2fa(codigo: $codigo) { ok mensaje }
  }
`

export const DESACTIVAR_2FA_MUTATION = gql`
  mutation Desactivar2FA($codigo: String!) {
    desactivar2fa(codigo: $codigo) { ok mensaje }
  }
`
