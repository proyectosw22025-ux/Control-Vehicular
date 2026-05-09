import { gql } from '@apollo/client'

export const LOGIN_MUTATION = gql`
  mutation Login($ci: String!, $password: String!) {
    login(input: { ci: $ci, password: $password }) {
      access
      refresh
      usuario {
        id
        ci
        nombreCompleto
        email
        isSuperuser
        roles {
          nombre
        }
      }
    }
  }
`
