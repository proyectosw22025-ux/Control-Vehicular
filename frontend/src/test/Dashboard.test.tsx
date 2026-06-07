import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MockedProvider, MockedResponse } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { VEHICULOS_QUERY, QR_DINAMICO_QUERY } from '../graphql/queries/vehiculos'
import { SESION_ACTIVA_VEHICULO_QUERY } from '../graphql/queries/parqueos'
import Dashboard from '../pages/Dashboard'

const USUARIO_ESTUDIANTE = {
  id: 9,
  ci: '99999999',
  nombreCompleto: 'María Pérez',
  email: 'maria@test.com',
  isSuperuser: false,
  roles: [{ nombre: 'Estudiante' }],
}

const VEHICULO_ACTIVO = {
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

function buildMocks(): MockedResponse[] {
  const vehiculosMock: MockedResponse = {
    request: { query: VEHICULOS_QUERY, variables: { propietarioId: USUARIO_ESTUDIANTE.id, porPagina: 5 } },
    result: { data: { vehiculos: { __typename: 'VehiculoPaginadoType', items: [VEHICULO_ACTIVO], total: 1, pagina: 1, totalPaginas: 1 } } },
  }
  const sesionMock: MockedResponse = {
    request: { query: SESION_ACTIVA_VEHICULO_QUERY, variables: { vehiculoId: VEHICULO_ACTIVO.id } },
    result: { data: { sesionActivaVehiculo: null } },
  }
  const qrDinamicoMock: MockedResponse = {
    request: { query: QR_DINAMICO_QUERY, variables: { vehiculoId: VEHICULO_ACTIVO.id } },
    result: { data: { qrDinamicoVehiculo: { __typename: 'QrDinamicoType', codigo: 'TOTP123456', segundosRestantes: 30, intervalo: 30 } } },
  }
  // cache-and-network dispara red dos veces; se duplican los mocks de vehículos/sesión
  return [vehiculosMock, vehiculosMock, sesionMock, sesionMock, qrDinamicoMock]
}

function renderDashboard() {
  return render(
    <MockedProvider mocks={buildMocks()}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('access_token', 'token')
  localStorage.setItem('usuario', JSON.stringify(USUARIO_ESTUDIANTE))
  localStorage.setItem('onboarding_completado', '1')
})

describe('Dashboard — atajo "Mostrar mi código QR"', () => {
  it('muestra el botón de atajo cuando el residente tiene un vehículo activo', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Mostrar mi código QR')).toBeInTheDocument())
    expect(screen.getByText(/Listo para portería en un toque · SCZ-4321/)).toBeInTheDocument()
  })

  it('al pulsar el atajo abre un modal con el QR del vehículo (sin pasar por "Vehículos")', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Mostrar mi código QR')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Mostrar mi código QR'))

    await waitFor(() => expect(screen.getByText('Código QR — SCZ-4321')).toBeInTheDocument())
  })

  it('el botón de cierre del modal lo oculta de nuevo', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('Mostrar mi código QR')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Mostrar mi código QR'))
    await waitFor(() => expect(screen.getByText('Código QR — SCZ-4321')).toBeInTheDocument())

    const cerrar = screen.getByText('Código QR — SCZ-4321').parentElement?.querySelector('button')
    expect(cerrar).toBeTruthy()
    fireEvent.click(cerrar!)

    expect(screen.queryByText('Código QR — SCZ-4321')).toBeNull()
  })
})

// ── Caso: el residente tiene MÁS DE UN vehículo activo ──────────────────────
// Antes el atajo elegía arbitrariamente "el primer vehículo activo" con
// `.find()`, mostrando una sola placa de forma ambigua cuando había varios
// vehículos activos ("solo agregaste el qr de un vehículo").

const VEHICULO_ACTIVO_2 = {
  ...VEHICULO_ACTIVO,
  id: 6,
  placa: 'SCZ-3456',
  marca: 'Honda',
  modelo: 'CB300',
  anio: 2022,
}

function buildMocksMultiplesActivos(): MockedResponse[] {
  const vehiculosMock: MockedResponse = {
    request: { query: VEHICULOS_QUERY, variables: { propietarioId: USUARIO_ESTUDIANTE.id, porPagina: 5 } },
    result: { data: { vehiculos: { __typename: 'VehiculoPaginadoType', items: [VEHICULO_ACTIVO, VEHICULO_ACTIVO_2], total: 2, pagina: 1, totalPaginas: 1 } } },
  }
  const sesionMock = (id: number): MockedResponse => ({
    request: { query: SESION_ACTIVA_VEHICULO_QUERY, variables: { vehiculoId: id } },
    result: { data: { sesionActivaVehiculo: null } },
  })
  const qrMock = (v: typeof VEHICULO_ACTIVO): MockedResponse => ({
    request: { query: QR_DINAMICO_QUERY, variables: { vehiculoId: v.id } },
    result: { data: { qrDinamicoVehiculo: { __typename: 'QrDinamicoType', codigo: `TOTP-${v.placa}`, segundosRestantes: 30, intervalo: 30 } } },
  })
  return [
    vehiculosMock, vehiculosMock,
    sesionMock(VEHICULO_ACTIVO.id), sesionMock(VEHICULO_ACTIVO.id),
    sesionMock(VEHICULO_ACTIVO_2.id), sesionMock(VEHICULO_ACTIVO_2.id),
    qrMock(VEHICULO_ACTIVO), qrMock(VEHICULO_ACTIVO_2),
  ]
}

function renderDashboardMultiplesActivos() {
  return render(
    <MockedProvider mocks={buildMocksMultiplesActivos()}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </MockedProvider>
  )
}

describe('Dashboard — atajo "Mostrar mi código QR" con varios vehículos activos', () => {
  it('el subtítulo del atajo indica cuántos vehículos activos hay, sin nombrar uno solo de forma ambigua', async () => {
    renderDashboardMultiplesActivos()
    await waitFor(() => expect(screen.getByText('Mostrar mi código QR')).toBeInTheDocument())

    expect(screen.getByText(/Listo para portería en un toque · 2 vehículos activos/)).toBeInTheDocument()
    // No debe mostrar una sola placa como si fuera "la" del atajo
    expect(screen.queryByText(/un toque · SCZ-4321/)).toBeNull()
  })

  it('el modal incluye un selector de placas y permite cambiar entre los QR de cada vehículo activo', async () => {
    renderDashboardMultiplesActivos()
    await waitFor(() => expect(screen.getByText('Mostrar mi código QR')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Mostrar mi código QR'))

    // Abre mostrando el primer vehículo activo
    await waitFor(() => expect(screen.getByText('Código QR — SCZ-4321')).toBeInTheDocument())

    // El selector lista ambas placas como opciones
    const chipSegundo = screen.getByRole('button', { name: 'SCZ-3456' })
    expect(screen.getByRole('button', { name: 'SCZ-4321' })).toBeInTheDocument()
    expect(chipSegundo).toBeInTheDocument()

    // Cambiar de vehículo actualiza el título del modal y el QR mostrado
    fireEvent.click(chipSegundo)
    await waitFor(() => expect(screen.getByText('Código QR — SCZ-3456')).toBeInTheDocument())
    expect(screen.queryByText('Código QR — SCZ-4321')).toBeNull()
  })
})
