import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MockedProvider, MockedResponse } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import {
  SANCIONES_PENDIENTES_QUERY,
  TIPOS_INFRACCION_QUERY,
  APELACIONES_PENDIENTES_QUERY,
} from '../graphql/queries/infracciones'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import Infracciones from '../pages/Infracciones'

const USUARIO_ADMIN = {
  id: 1,
  ci: '11111111',
  nombreCompleto: 'Admin UAGRM',
  email: 'admin@test.com',
  isSuperuser: true,
  roles: [{ nombre: 'Administrador' }],
}

const VEHICULO = {
  __typename: 'VehiculoType',
  id: 5,
  placa: 'SCZ-4321',
  marca: 'Honda',
  modelo: 'Civic',
  anio: 2021,
  color: 'Negro',
  estado: 'activo',
  codigoQr: 'qr-veh-5',
  createdAt: '2026-01-01T00:00:00Z',
  tipo: { __typename: 'TipoVehiculoType', id: 1, nombre: 'Automóvil' },
  propietarioNombre: 'María Pérez',
  propietarioCi: '99999999',
  propietarioRoles: 'Estudiante',
  estadoDocumentacion: 'al_dia',
  documentos: [],
}

const TIPO_INFRACCION = {
  __typename: 'TipoInfraccionType',
  id: 3,
  nombre: 'Exceso de velocidad',
  descripcion: 'Circular por encima del límite permitido',
  gravedad: 'grave',
  tipoSancionSugerido: 'multa_economica',
  montoBase: 150,
}

const SANCION_PENDIENTE = {
  __typename: 'SancionPendienteType',
  id: 10,
  tipoSancion: 'multa_economica',
  monto: 150,
  estado: 'pendiente',
  fecha: '2026-05-01T10:00:00Z',
  infraccionId: 20,
  placaVehiculo: 'SCZ-4321',
  tipoInfraccionNombre: 'Exceso de velocidad',
  descripcionInfraccion: 'Circulaba a 80 km/h en zona de 40 km/h',
}

function buildMocks(): MockedResponse[] {
  const sancionesPendientesMock: MockedResponse = {
    request: { query: SANCIONES_PENDIENTES_QUERY },
    result: { data: { sancionesPendientes: [SANCION_PENDIENTE] } },
  }
  const vehiculosMock: MockedResponse = {
    request: { query: VEHICULOS_QUERY, variables: { propietarioId: undefined, estado: 'activo', porPagina: 100 } },
    result: { data: { vehiculos: { __typename: 'VehiculoPaginadoType', items: [VEHICULO], total: 1, pagina: 1, totalPaginas: 1 } } },
  }
  const tiposMock: MockedResponse = {
    request: { query: TIPOS_INFRACCION_QUERY },
    result: { data: { tiposInfraccion: [TIPO_INFRACCION] } },
  }
  const apelacionesMock: MockedResponse = {
    request: { query: APELACIONES_PENDIENTES_QUERY },
    result: { data: { apelacionesPendientes: [] } },
  }
  // cache-and-network dispara red dos veces para vehículos
  return [sancionesPendientesMock, vehiculosMock, vehiculosMock, tiposMock, apelacionesMock]
}

function renderInfracciones() {
  return render(
    <MockedProvider mocks={buildMocks()}>
      <MemoryRouter>
        <Infracciones />
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('access_token', 'token')
  localStorage.setItem('usuario', JSON.stringify(USUARIO_ADMIN))
  localStorage.setItem('onboarding_completado', '1')
})

describe('Infracciones — vista de personal (admin)', () => {
  it('renderiza el encabezado y la pestaña de sanciones pendientes con datos', async () => {
    renderInfracciones()

    expect(screen.getByText('Infracciones')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/Sanciones pendientes/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('SCZ-4321')).toBeInTheDocument())
    expect(screen.getByText('Exceso de velocidad')).toBeInTheDocument()
  })

  it('al pulsar "Registrar Infracción" abre el modal con el selector de tipo de sanción', async () => {
    renderInfracciones()
    await waitFor(() => expect(screen.getByText(/Sanciones pendientes/)).toBeInTheDocument())

    fireEvent.click(screen.getByText('Registrar Infracción'))
    await waitFor(() => expect(screen.getByText('Tipo de infracción *')).toBeInTheDocument())

    const selectTipo = screen.getByText('Tipo de infracción *').nextElementSibling as HTMLSelectElement
    fireEvent.change(selectTipo, { target: { value: String(TIPO_INFRACCION.id) } })

    await waitFor(() => expect(screen.getByText('Sanción a aplicar')).toBeInTheDocument())
    expect(screen.getByText('Multa económica', { selector: 'option' })).toBeInTheDocument()
    expect(screen.getByText('Monto (Bs.) — opcional')).toBeInTheDocument()
  })
})
