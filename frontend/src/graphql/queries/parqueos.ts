import { gql } from '@apollo/client'

export const ZONAS_QUERY = gql`
  query Zonas($soloActivas: Boolean) {
    zonas(soloActivas: $soloActivas) {
      id
      nombre
      descripcion
      ubicacion
      capacidadTotal
      activo
      espaciosDisponibles
    }
  }
`

export const ESPACIOS_POR_ZONA_QUERY = gql`
  query EspaciosPorZona($zonaId: Int!, $estado: String) {
    espaciosPorZona(zonaId: $zonaId, estado: $estado) {
      id
      numero
      estado
      ubicacionReferencia
      zona { id nombre }
      categoria { id nombre color }
    }
  }
`

export const CATEGORIAS_ESPACIO_QUERY = gql`
  query CategoriasEspacio {
    categoriasEspacio { id nombre descripcion esDiscapacidad color }
  }
`

export const SESION_ACTIVA_VEHICULO_QUERY = gql`
  query SesionActivaVehiculo($vehiculoId: Int!) {
    sesionActivaVehiculo(vehiculoId: $vehiculoId) {
      id
      horaEntrada
      estado
      duracionMinutos
      espacio { id numero zona { nombre } }
      placaVehiculo
    }
  }
`

export const HISTORIAL_SESIONES_QUERY = gql`
  query HistorialSesiones($vehiculoId: Int!, $limite: Int) {
    historialSesiones(vehiculoId: $vehiculoId, limite: $limite) {
      id
      horaEntrada
      horaSalida
      estado
      duracionMinutos
      espacio { numero zona { nombre } }
    }
  }
`

export const SESIONES_ACTIVAS_QUERY = gql`
  query SesionesActivas {
    sesionesActivas {
      id
      horaEntrada
      estado
      duracionMinutos
      placaVehiculo
      espacio { id numero zona { nombre } }
    }
  }
`

export const MAPA_PARQUEO_QUERY = gql`
  query MapaParqueo {
    mapaParqueo {
      id
      nombre
      ubicacion
      capacidadTotal
      espaciosDisponibles
      espacios {
        id
        numero
        estado
        ubicacionReferencia
        categoria { id nombre color }
      }
    }
  }
`
