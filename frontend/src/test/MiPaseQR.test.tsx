import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MockedProvider, MockedResponse } from '@apollo/client/testing'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { MIS_DELEGACIONES_QUERY } from '../graphql/queries/acceso'
import MiPaseQR from '../pages/MiPaseQR'

const USUARIO = { id: 7, ci: '12345678', nombreCompleto: 'Test', email: 't@t.com', isSuperuser: false, roles: [] }

const VEHICULO = {
  __typename: 'VehiculoType',
  id: 1,
  placa: 'SCZ-1234',
  marca: 'Toyota',
  modelo: 'Corolla',
  anio: 2020,
  color: 'Blanco',
  estado: 'activo',
  codigoQr: 'qr-veh-1',
  createdAt: '2026-01-01T00:00:00Z',
  tipo: { __typename: 'TipoVehiculoType', id: 1, nombre: 'Automóvil' },
  propietarioNombre: 'Test Usuario',
  propietarioCi: '12345678',
  propietarioRoles: 'Estudiante',
  estadoDocumentacion: 'al_dia',
  documentos: [],
}

const DELEGACION = {
  __typename: 'DelegacionAccesoType',
  id: 100,
  codigoHash: 'hash-abc-123',
  motivo: 'Préstamo a un familiar',
  fechaGeneracion: '2026-06-01T10:00:00Z',
  fechaExpiracion: '2099-06-01T10:00:00Z',
  usado: false,
  vigente: true,
  tipoDelegacion: 'ambos',
  tipoDelegacionDisplay: 'Entrada y salida',
  usosMax: 2,
  usosActual: 0,
  usosRestantes: 2,
  urlQr: 'https://app.test/qr/hash-abc-123',
  placaVehiculo: 'SCZ-1234',
  tipoDestinatario: 'externo',
  destinatarioNombre: 'Juan Pérez',
  destinatarioCi: '',
  destinatarioDisplay: 'Juan Pérez',
}

function buildMocks(): MockedResponse[] {
  return [
    {
      request: { query: VEHICULOS_QUERY, variables: { propietarioId: USUARIO.id, porPagina: 50 } },
      result: { data: { vehiculos: { __typename: 'VehiculoPaginadoType', items: [VEHICULO], total: 1, pagina: 1, totalPaginas: 1 } } },
    },
    {
      request: { query: MIS_DELEGACIONES_QUERY },
      result: { data: { misDelegaciones: [DELEGACION] } },
    },
    // refetch tras montar (cache-and-network dispara una segunda red)
    {
      request: { query: MIS_DELEGACIONES_QUERY },
      result: { data: { misDelegaciones: [DELEGACION] } },
    },
  ]
}

function renderPage() {
  return render(
    <MockedProvider mocks={buildMocks()}>
      <MiPaseQR />
    </MockedProvider>
  )
}

beforeEach(() => {
  localStorage.setItem('access_token', 'token')
  localStorage.setItem('usuario', JSON.stringify(USUARIO))
})

describe('MiPaseQR — recuperar el QR de delegación tras navegar fuera', () => {
  it('lista la delegación activa con un botón "Ver QR" para volver a mostrarla', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Préstamo a un familiar')).toBeInTheDocument())
    expect(screen.getByTitle('Ver y compartir este QR')).toBeInTheDocument()
  })

  it('al hacer clic en "Ver QR" reaparece la tarjeta del QR con botón para ocultarla', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Préstamo a un familiar')).toBeInTheDocument())

    // Antes de pulsar "Ver QR" no debería haber tarjeta de QR expandida
    expect(screen.queryByText('QR de delegación listo')).toBeNull()

    fireEvent.click(screen.getByTitle('Ver y compartir este QR'))

    await waitFor(() => expect(screen.getByText('QR de delegación listo')).toBeInTheDocument())
    expect(screen.getByText('Juan Pérez', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ocultar QR')).toBeInTheDocument()
  })

  it('el botón "Ocultar QR" cierra la tarjeta sin perder la delegación de la lista', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Préstamo a un familiar')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Ver y compartir este QR'))
    await waitFor(() => expect(screen.getByText('QR de delegación listo')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Ocultar QR'))

    expect(screen.queryByText('QR de delegación listo')).toBeNull()
    // La delegación sigue listada y se puede volver a abrir
    expect(screen.getByTitle('Ver y compartir este QR')).toBeInTheDocument()
  })
})
