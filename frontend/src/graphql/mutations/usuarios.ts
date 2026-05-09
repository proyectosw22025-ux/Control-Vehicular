import { gql } from '@apollo/client'

export const CREAR_USUARIO_MUTATION = gql`
  mutation CrearUsuario($input: CrearUsuarioInput!) {
    crearUsuario(input: $input) {
      id
      ci
      nombreCompleto
      email
      roles { nombre }
    }
  }
`

export const ACTUALIZAR_USUARIO_MUTATION = gql`
  mutation ActualizarUsuario($id: Int!, $input: ActualizarUsuarioInput!) {
    actualizarUsuario(id: $id, input: $input) {
      id
      ci
      nombreCompleto
      email
      telefono
    }
  }
`

export const DESACTIVAR_USUARIO_MUTATION = gql`
  mutation DesactivarUsuario($id: Int!) {
    desactivarUsuario(id: $id) {
      ok
      mensaje
    }
  }
`

export const ASIGNAR_ROL_MUTATION = gql`
  mutation AsignarRol($usuarioId: Int!, $rolId: Int!) {
    asignarRol(input: { usuarioId: $usuarioId, rolId: $rolId }) {
      ok
      mensaje
    }
  }
`

export const CREAR_ROL_MUTATION = gql`
  mutation CrearRol($nombre: String!, $descripcion: String) {
    crearRol(nombre: $nombre, descripcion: $descripcion) {
      id
      nombre
      descripcion
    }
  }
`

export const CAMBIAR_PASSWORD_MUTATION = gql`
  mutation CambiarPassword($passwordActual: String!, $passwordNuevo: String!) {
    cambiarPassword(passwordActual: $passwordActual, passwordNuevo: $passwordNuevo) {
      ok
      mensaje
    }
  }
`
