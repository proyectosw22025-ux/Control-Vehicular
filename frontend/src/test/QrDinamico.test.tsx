import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MockedProvider, MockedResponse } from '@apollo/client/testing'
import QRCode from 'qrcode'
import { QrDinamico } from '../components/QrDinamico'
import { QR_DINAMICO_QUERY } from '../graphql/queries/vehiculos'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') },
}))

const VEHICULO_ID = 5

function buildMocks(): MockedResponse[] {
  return [
    {
      request: { query: QR_DINAMICO_QUERY, variables: { vehiculoId: VEHICULO_ID } },
      result: { data: { qrDinamicoVehiculo: { __typename: 'QrDinamicoType', codigo: 'TOTP123456', segundosRestantes: 30, intervalo: 30 } } },
    },
  ]
}

function renderQr() {
  return render(
    <MockedProvider mocks={buildMocks()}>
      <QrDinamico vehiculoId={VEHICULO_ID} placa="SCZ-4321" />
    </MockedProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('QrDinamico — costo de renderizado del QR (rendimiento)', () => {
  it('genera la imagen con un tamaño acotado y nivel de corrección "M" en vez de "H"', async () => {
    renderQr()
    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalled())

    const [codigo, opciones] = (QRCode.toDataURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(codigo).toBe('TOTP123456')

    // El QR se muestra a 220px — generarlo a 480px con corrección 'H' fuerza
    // a `qrcode` a rasterizar ~4.7x más píxeles y elegir una matriz más densa
    // de lo necesario para un código TOTP corto, sumando trabajo de CPU
    // perceptible cada vez que se abre o se regenera (cada 30s).
    expect(opciones.width).toBeLessThanOrEqual(300)
    expect(opciones.errorCorrectionLevel).toBe('M')
  })

  it('no regenera la imagen si el código TOTP no cambia entre renders', async () => {
    renderQr()
    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledTimes(1))

    // Esperar un instante adicional: si `generarImagen` se disparara en cada
    // render (p.ej. por una dependencia inestable en el efecto), veríamos
    // múltiples llamadas pese a que el código TOTP sigue siendo el mismo.
    await new Promise(r => setTimeout(r, 50))
    expect(QRCode.toDataURL).toHaveBeenCalledTimes(1)
  })
})
