import { gql } from '@apollo/client'

export const ME_QUERY = gql`
  query Me {
    me {
      id
      ci
      nombreCompleto
      email
      telefono
      isActive
      roles {
        id
        nombre
      }
    }
  }
`

export const USUARIOS_QUERY = gql`
  query Usuarios {
    usuarios {
      id
      ci
      nombreCompleto
      email
      telefono
      isActive
      roles {
        nombre
      }
    }
  }
`

export const ROLES_QUERY = gql`
  query Roles {
    roles {
      id
      nombre
      descripcion
    }
  }
`
