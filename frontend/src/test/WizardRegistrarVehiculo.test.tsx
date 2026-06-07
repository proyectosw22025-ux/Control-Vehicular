import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WizardRegistrarVehiculo } from '../pages/Vehiculos'

const TIPOS = [
  { id: 1, nombre: 'Automóvil' },
  { id: 2, nombre: 'Motocicleta' },
]

const USUARIO = { id: 4, nombreCompleto: 'Carla Vega', ci: '44444444' }

function setup(esAdmin = false) {
  const onClose = vi.fn()
  const onFotoFile = vi.fn()
  const registrarVehiculo = vi.fn()
  render(
    <WizardRegistrarVehiculo
      tipos={TIPOS}
      usuarios={[]}
      esAdmin={esAdmin}
      usuario={USUARIO}
      onClose={onClose}
      onFotoFile={onFotoFile}
      registrarVehiculo={registrarVehiculo}
      loadingRegistrar={false}
    />
  )
  return { onClose, onFotoFile, registrarVehiculo }
}

function completarPaso1() {
  fireEvent.change(screen.getByPlaceholderText('ABC-1234'), { target: { value: 'ABC-1234' } })
  fireEvent.click(screen.getByText('Automóvil'))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('WizardRegistrarVehiculo — registro simplificado (2 pasos)', () => {
  it('muestra solo 2 pasos: "Identificación" y "Detalles (opcional)"', () => {
    setup()
    expect(screen.getByText('Identificación')).toBeInTheDocument()
    expect(screen.getByText('Detalles (opcional)')).toBeInTheDocument()
    // Ya no existe un tercer paso "Documentación" como paso obligatorio independiente
    expect(screen.queryByText('Datos técnicos')).toBeNull()
  })

  it('el botón "Siguiente" está deshabilitado hasta completar placa y tipo', () => {
    setup()
    const siguiente = screen.getByRole('button', { name: /Siguiente/ })
    expect(siguiente).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('ABC-1234'), { target: { value: 'ABC-1234' } })
    expect(siguiente).toBeDisabled()

    fireEvent.click(screen.getByText('Automóvil'))
    expect(siguiente).not.toBeDisabled()
  })

  it('avanza al paso 2 con secciones "Datos del vehículo" y "Documentación" colapsadas por defecto', () => {
    setup()
    completarPaso1()
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    expect(screen.getByText('Datos del vehículo')).toBeInTheDocument()
    expect(screen.getByText('Documentación')).toBeInTheDocument()
    // Colapsadas: los campos internos no están visibles aún
    expect(screen.queryByPlaceholderText('Toyota')).toBeNull()
    expect(screen.queryByPlaceholderText('SOA-123456')).toBeNull()
  })

  it('expande el acordeón "Datos del vehículo" al pulsarlo y muestra sus campos', () => {
    setup()
    completarPaso1()
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    fireEvent.click(screen.getByText('Datos del vehículo'))
    expect(screen.getByPlaceholderText('Toyota')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Corolla')).toBeInTheDocument()

    // Documentación sigue colapsada de forma independiente
    expect(screen.queryByPlaceholderText('SOA-123456')).toBeNull()
  })

  it('expande el acordeón "Documentación" al pulsarlo y muestra sus campos', () => {
    setup()
    completarPaso1()
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    fireEvent.click(screen.getByText('Documentación'))
    expect(screen.getByPlaceholderText('SOA-123456')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('MTR-XYZ789')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('1HGCM82633A123456')).toBeInTheDocument()
  })

  it('en el paso 2 ya se puede registrar de inmediato, sin llenar los campos opcionales', () => {
    const { registrarVehiculo } = setup()
    completarPaso1()
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))

    const registrar = screen.getByRole('button', { name: /Registrar vehículo/ })
    expect(registrar).not.toBeDisabled()
    fireEvent.click(registrar)
    expect(registrarVehiculo).toHaveBeenCalledTimes(1)
    const { input } = registrarVehiculo.mock.calls[0][0].variables
    expect(input.placa).toBe('ABC-1234')
    expect(input.marca).toBe('Sin especificar')
  })

  it('exige la fecha de vencimiento del SOAT si se ingresa el número de SOAT', () => {
    setup()
    completarPaso1()
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }))
    fireEvent.click(screen.getByText('Documentación'))

    fireEvent.change(screen.getByPlaceholderText('SOA-123456'), { target: { value: 'SOA-999999' } })

    const registrar = screen.getByRole('button', { name: /Registrar vehículo/ })
    expect(registrar).toBeDisabled()
    expect(screen.getByText('La fecha de vencimiento del SOAT es requerida')).toBeInTheDocument()
  })
})
