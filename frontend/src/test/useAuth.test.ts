import { describe, it, expect, beforeEach } from 'vitest'
import { useAuth } from '../hooks/useAuth'

const USUARIO_ADMIN = {
  id: 1,
  ci: '11111111',
  nombreCompleto: 'Admin Test',
  email: 'admin@test.com',
  isSuperuser: true,
  roles: [],
}

const USUARIO_GUARDIA = {
  id: 2,
  ci: '22222222',
  nombreCompleto: 'Guardia Test',
  email: 'guardia@test.com',
  isSuperuser: false,
  roles: [{ nombre: 'Guardia' }],
}

const USUARIO_ESTUDIANTE = {
  id: 3,
  ci: '33333333',
  nombreCompleto: 'Estudiante Test',
  email: 'est@test.com',
  isSuperuser: false,
  roles: [{ nombre: 'Estudiante' }],
}

beforeEach(() => localStorage.clear())

describe('useAuth — detección de roles', () => {
  it('detecta administrador por isSuperuser=true', () => {
    localStorage.setItem('access_token', 'token')
    localStorage.setItem('usuario', JSON.stringify(USUARIO_ADMIN))
    const { esAdmin, esGuardia } = useAuth()
    expect(esAdmin).toBe(true)
    expect(esGuardia).toBe(false)
  })

  it('detecta guardia por rol', () => {
    localStorage.setItem('access_token', 'token')
    localStorage.setItem('usuario', JSON.stringify(USUARIO_GUARDIA))
    const { esAdmin, esGuardia } = useAuth()
    expect(esAdmin).toBe(false)
    expect(esGuardia).toBe(true)
  })

  it('usuario estudiante no es admin ni guardia', () => {
    localStorage.setItem('access_token', 'token')
    localStorage.setItem('usuario', JSON.stringify(USUARIO_ESTUDIANTE))
    const { esAdmin, esGuardia } = useAuth()
    expect(esAdmin).toBe(false)
    expect(esGuardia).toBe(false)
  })

  it('isAuthenticated es false sin token', () => {
    localStorage.setItem('usuario', JSON.stringify(USUARIO_ESTUDIANTE))
    const { isAuthenticated } = useAuth()
    expect(isAuthenticated).toBe(false)
  })

  it('isAuthenticated es true con token', () => {
    localStorage.setItem('access_token', 'mi_token_valido')
    localStorage.setItem('usuario', JSON.stringify(USUARIO_ESTUDIANTE))
    const { isAuthenticated } = useAuth()
    expect(isAuthenticated).toBe(true)
  })

  it('tieneRol funciona con múltiples roles', () => {
    localStorage.setItem('access_token', 'token')
    localStorage.setItem('usuario', JSON.stringify(USUARIO_GUARDIA))
    const { tieneRol } = useAuth()
    expect(tieneRol('Guardia', 'Administrador')).toBe(true)
    expect(tieneRol('Administrador')).toBe(false)
  })

  it('usuario sin datos en localStorage devuelve defaults seguros', () => {
    const { esAdmin, esGuardia, isAuthenticated, roles } = useAuth()
    expect(esAdmin).toBe(false)
    expect(esGuardia).toBe(false)
    expect(isAuthenticated).toBe(false)
    expect(roles).toHaveLength(0)
  })
})
