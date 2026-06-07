import { gql } from '@apollo/client'

export const REGISTRAR_INFRACCION_MUTATION = gql`
  mutation RegistrarInfraccion($input: RegistrarInfraccionInput!) {
    registrarInfraccion(input: $input) {
      id
      descripcion
      fecha
      estado
      tipo { nombre }
      placaVehiculo
      sancion { id tipoSancion monto estado }
    }
  }
`

export const PAGAR_SANCION_MUTATION = gql`
  mutation PagarSancion($input: PagarSancionInput!) {
    pagarSancion(input: $input) {
      id fechaPago montoPagado metodoPago comprobante comprobanteUrl referenciaPago
    }
  }
`

export const MARCAR_SANCION_CUMPLIDA_MUTATION = gql`
  mutation MarcarSancionCumplida($input: MarcarSancionCumplidaInput!) {
    marcarSancionCumplida(input: $input) {
      id tipoSancion monto estado placaVehiculo
    }
  }
`

export const APELAR_INFRACCION_MUTATION = gql`
  mutation ApelarInfraccion($input: ApelarInfraccionInput!) {
    apelarInfraccion(input: $input) {
      id motivo estado fecha
    }
  }
`

export const RESOLVER_APELACION_MUTATION = gql`
  mutation ResolverApelacion($input: ResolverApelacionInput!) {
    resolverApelacion(input: $input) {
      id estado respuesta fechaResolucion usuarioNombre resueltoPorNombre
    }
  }
`
