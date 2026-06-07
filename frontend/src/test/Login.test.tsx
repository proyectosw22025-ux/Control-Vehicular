import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MockedProvider, MockedResponse } from '@apollo/client/testing'
import { MemoryRouter } from 'react-router-dom'
import { LOGIN_MUTATION } from '../graphql/mutations/auth'
import Login from '../pages/Login'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...real, useNavigate: () => navigateMock }
})

const USUARIO = {
  __typename: 'UsuarioType',
  id: 1,
  ci: '12345678',
  nombreCompleto: 'Estudiante Test',
  email: 'est@test.com',
  isSuperuser: false,
  roles: [{ __typename: 'RolType', nombre: 'Estudiante' }],
}

function renderLogin(mocks: MockedResponse[]) {
  return render(
    <MockedProvider mocks={mocks}>
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    </MockedProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  navigateMock.mockClear()
})

describe('Login', () => {
  it('muestra el formulario de inicio de sesión (CI + contraseña)', () => {
    renderLogin([])
    expect(screen.getByText('Inicia sesión')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ej: 12345678')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('••••••••')).toBeInTheDocument()
  })

  it('permite escribir CI y contraseña sin perder el foco ni reiniciar el valor', () => {
    renderLogin([])
    const ci = screen.getByPlaceholderText('Ej: 12345678') as HTMLInputElement
    const pass = screen.getByPlaceholderText('••••••••') as HTMLInputElement

    fireEvent.change(ci, { target: { value: '87654321' } })
    pass.focus()
    fireEvent.change(pass, { target: { value: 'secreta123' } })

    // Si el componente entero se reconstruyera en cada tecla (el bug original
    // de re-render), los inputs perderían su valor controlado o el foco.
    expect(ci.value).toBe('87654321')
    expect(pass.value).toBe('secreta123')
    expect(document.activeElement).toBe(pass)
  })

  it('alterna la visibilidad de la contraseña con el botón de ojo', () => {
    renderLogin([])
    const pass = screen.getByPlaceholderText('••••••••') as HTMLInputElement
    expect(pass.type).toBe('password')
    fireEvent.click(screen.getByLabelText('Ver contraseña'))
    expect(pass.type).toBe('text')
    fireEvent.click(screen.getByLabelText('Ocultar contraseña'))
    expect(pass.type).toBe('password')
  })

  it('muestra error si se envía el formulario sin completar los campos', () => {
    renderLogin([])
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
    expect(screen.getByText('Completa todos los campos')).toBeInTheDocument()
  })

  it('al iniciar sesión correctamente guarda los tokens y navega al dashboard', async () => {
    const mocks: MockedResponse[] = [
      {
        request: {
          query: LOGIN_MUTATION,
          variables: { ci: '12345678', password: 'secreta123', codigoTotp: undefined },
        },
        result: {
          data: {
            login: {
              __typename: 'LoginType',
              access: 'access-token-123',
              refresh: 'refresh-token-456',
              usuario: USUARIO,
            },
          },
        },
      },
    ]
    renderLogin(mocks)

    fireEvent.change(screen.getByPlaceholderText('Ej: 12345678'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secreta123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/'))
    expect(localStorage.getItem('access_token')).toBe('access-token-123')
    expect(localStorage.getItem('refresh_token')).toBe('refresh-token-456')
    expect(JSON.parse(localStorage.getItem('usuario') ?? '{}')).toMatchObject({ ci: '12345678' })
  })

  it('cuando el backend exige 2FA, muestra el paso de código TOTP', async () => {
    const mocks: MockedResponse[] = [
      {
        request: {
          query: LOGIN_MUTATION,
          variables: { ci: '12345678', password: 'secreta123', codigoTotp: undefined },
        },
        error: new Error('2FA_REQUIRED'),
      },
    ]
    renderLogin(mocks)

    fireEvent.change(screen.getByPlaceholderText('Ej: 12345678'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secreta123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(screen.getByText('Verificación de doble factor')).toBeInTheDocument())
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument()
  })
})
