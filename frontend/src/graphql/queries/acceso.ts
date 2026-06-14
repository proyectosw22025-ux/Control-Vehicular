import { gql } from '@apollo/client'

export const PUNTOS_ACCESO_QUERY = gql`
  query PuntosAcceso {
    puntosAcceso { id nombre ubicacion tipo activo }
  }
`

export const AUTORIZACIONES_EXTERNAS_QUERY = gql`
  query AutorizacionesExternas($soloActivas: Boolean) {
    autorizacionesExternas(soloActivas: $soloActivas) {
      id placa empresa motivo emailProveedor
      validoDesde validoHasta codigoAcceso
      activo usado emailEnviado estado vigente
      dependenciaNombre dependenciaUbicacion
      autorizadoPorNombre urlVerificacion
      fechaCreacion
    }
  }
`

export const VERIFICAR_AUTORIZACION_EXTERNA_QUERY = gql`
  query VerificarAutorizacionExterna($codigo: String!) {
    verificarAutorizacionExterna(codigo: $codigo) {
      id placa empresa motivo
      validoDesde validoHasta codigoAcceso
      activo usado estado vigente
      dependenciaNombre dependenciaUbicacion
      autorizadoPorNombre urlVerificacion
    }
  }
`

export const VEHICULOS_TEMPORALES_QUERY = gql`
  query VehiculosTemporalesActivos {
    vehiculosTemporalesActivos {
      id placa tipo tipoDisplay destino responsable
      horaIngreso horaLimite horaSalida
      activo observacion minutosRestantes vencido espacioParqueo
    }
  }
`

export const ALERTAS_PANEL_QUERY = gql`
  query AlertasActivasPanel($limite: Int) {
    alertasActivasPanel(limite: $limite) {
      id tipoAnomalia severidad descripcion fecha revisada vehiculoPlaca
    }
  }
`

export const REGISTROS_ACCESO_QUERY = gql`
  query RegistrosAcceso($vehiculoId: Int, $puntoId: Int, $limite: Int) {
    registrosAcceso(vehiculoId: $vehiculoId, puntoId: $puntoId, limite: $limite) {
      id
      tipo
      metodoAcceso
      timestamp
      observacion
      puntoNombre
      placaVehiculo
      imagenUrl
    }
  }
`

export const AFORO_CAMPUS_QUERY = gql`
  query AforoCampus {
    aforoCampus { dentro maximo porcentaje estado }
  }
`

export const METRICAS_DESPACHO_QUERY = gql`
  query MetricasDespacho($dias: Int) {
    metricasDespacho(dias: $dias) {
      puntoNombre totalAccesos segundosMediana accesosPorHora horaPico
    }
  }
`

export const VEHICULOS_EN_CAMPUS_QUERY = gql`
  query VehiculosEnCampus {
    vehiculosEnCampus {
      vehiculoId placa marcaModelo
      propietarioNombre propietarioTelefono
      horaEntrada espacioParqueo
    }
  }
`

export const MIS_ACCESOS_QUERY = gql`
  query MisAccesos($limite: Int, $tipo: String) {
    misAccesos(limite: $limite, tipo: $tipo) {
      id
      tipo
      timestamp
      metodoAcceso
      puntoNombre
      placaVehiculo
      tipoVehiculo
      marcaModelo
      observacion
    }
  }
`

export const MIS_DELEGACIONES_QUERY = gql`
  query MisDelegaciones {
    misDelegaciones {
      id
      codigoHash
      motivo
      fechaGeneracion
      fechaExpiracion
      usado
      vigente
      tipoDelegacion
      tipoDelegacionDisplay
      usosMax
      usosActual
      usosRestantes
      urlQr
      placaVehiculo
      tipoDestinatario
      destinatarioNombre
      destinatarioCi
      destinatarioDisplay
    }
  }
`

export const QR_DELEGACIONES_QUERY = gql`
  query QrDelegacionesVehiculo($vehiculoId: Int!) {
    qrDelegacionesVehiculo(vehiculoId: $vehiculoId) {
      id
      codigoHash
      motivo
      fechaGeneracion
      fechaExpiracion
      usado
      vigente
      tipoDelegacion
      tipoDelegacionDisplay
      usosMax
      usosActual
      usosRestantes
      urlQr
      placaVehiculo
      tipoDestinatario
      destinatarioNombre
      destinatarioCi
      destinatarioDisplay
    }
  }
`

export const BUSCAR_DESTINATARIO_QUERY = gql`
  query BuscarDestinatarioUagrm($query: String!) {
    buscarDestinatarioUagrm(query: $query) {
      id
      ci
      nombreCompleto
      roles
    }
  }
`
