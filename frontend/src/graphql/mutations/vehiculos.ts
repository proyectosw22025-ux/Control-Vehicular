import { gql } from '@apollo/client'

export const REGISTRAR_VEHICULO_MUTATION = gql`
  mutation RegistrarVehiculo($input: CrearVehiculoInput!) {
    registrarVehiculo(input: $input) {
      id placa marca modelo anio color estado codigoQr
      numeroMotor numeroChasis numPuertas cilindrada colorHex fotoVehiculo numeroSoat capacidadCarga
      tipo { id nombre }
      propietarioNombre
      documentos { id tipoDoc numero fechaVencimiento }
    }
  }
`

export const ACTUALIZAR_VEHICULO_MUTATION = gql`
  mutation ActualizarVehiculo($id: Int!, $input: ActualizarVehiculoInput!) {
    actualizarVehiculo(id: $id, input: $input) {
      id placa marca modelo anio color estado
    }
  }
`

export const APROBAR_VEHICULO_MUTATION = gql`
  mutation AprobarVehiculo($vehiculoId: Int!) {
    aprobarVehiculo(vehiculoId: $vehiculoId) {
      id placa estado
    }
  }
`

export const RECHAZAR_VEHICULO_MUTATION = gql`
  mutation RechazarVehiculo($vehiculoId: Int!, $motivo: String!) {
    rechazarVehiculo(vehiculoId: $vehiculoId, motivo: $motivo) {
      id placa estado
    }
  }
`

export const MARCAR_ALERTA_SEGURIDAD_MUTATION = gql`
  mutation MarcarAlertaSeguridad($vehiculoId: Int!, $enAlerta: Boolean!, $motivo: String) {
    marcarAlertaSeguridad(vehiculoId: $vehiculoId, enAlerta: $enAlerta, motivo: $motivo) {
      id placa enAlerta motivoAlerta
    }
  }
`

export const MARCAR_FRECUENTE_MUTATION = gql`
  mutation MarcarFrecuente($vehiculoId: Int!, $esFrecuente: Boolean!) {
    marcarVehiculoFrecuente(vehiculoId: $vehiculoId, esFrecuente: $esFrecuente) {
      id placa esFrecuente
    }
  }
`

export const REGENERAR_QR_MUTATION = gql`
  mutation RegenerarQr($vehiculoId: Int!) {
    regenerarQr(vehiculoId: $vehiculoId) {
      id placa codigoQr
    }
  }
`

export const AGREGAR_DOCUMENTO_MUTATION = gql`
  mutation AgregarDocumento($input: AgregarDocumentoInput!) {
    agregarDocumento(input: $input) {
      id tipoDoc numero fechaVencimiento
      estado diasParaVencer archivoUrl
    }
  }
`

export const CREAR_TIPO_VEHICULO_MUTATION = gql`
  mutation CrearTipoVehiculo($nombre: String!, $descripcion: String) {
    crearTipoVehiculo(nombre: $nombre, descripcion: $descripcion) {
      id nombre descripcion
    }
  }
`
