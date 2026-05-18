import { gql } from '@apollo/client'

export const REGISTRAR_MULTA_MUTATION = gql`
  mutation RegistrarMulta($input: RegistrarMultaInput!) {
    registrarMulta(input: $input) {
      id
      monto
      descripcion
      fecha
      estado
      tipo { nombre }
      placaVehiculo
    }
  }
`

export const PAGAR_MULTA_MUTATION = gql`
  mutation PagarMulta($input: PagarMultaInput!) {
    pagarMulta(input: $input) {
      id fechaPago montoPagado metodoPago comprobante comprobanteUrl referenciaPago
    }
  }
`

export const CONFIRMAR_PAGO_MUTATION = gql`
  mutation ConfirmarPago($input: ConfirmarPagoInput!) {
    confirmarPagoMulta(input: $input) {
      id monto estado placaVehiculo
    }
  }
`

export const APELAR_MULTA_MUTATION = gql`
  mutation ApelarMulta($input: ApelarMultaInput!) {
    apelarMulta(input: $input) {
      id motivo estado fecha
    }
  }
`

export const RESOLVER_APELACION_MUTATION = gql`
  mutation ResolverApelacion($input: ResolverApelacionInput!) {
    resolverApelacion(input: $input) {
      id estado respuesta fechaResolucion usuarioNombre
    }
  }
`
