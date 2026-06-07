import { describe, it, expect, vi, afterEach } from 'vitest'
import { decodeJwtExp, tokenPorVencer } from '../apollo/client'

// Construye un JWT falso (cabecera/firma no importan, solo el payload "exp")
function jwtConExp(exp: number | undefined): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify(exp === undefined ? {} : { exp }))
  return `${header}.${payload}.firma-falsa`
}

afterEach(() => {
  vi.useRealTimers()
})

describe('decodeJwtExp', () => {
  it('extrae el campo exp de un token válido', () => {
    const token = jwtConExp(1_800_000_000)
    expect(decodeJwtExp(token)).toBe(1_800_000_000)
  })

  it('devuelve null si el token no es un JWT (sin puntos / payload corrupto)', () => {
    expect(decodeJwtExp('esto-no-es-un-token')).toBeNull()
  })

  it('devuelve null si el payload no trae exp numérico', () => {
    const token = jwtConExp(undefined)
    expect(decodeJwtExp(token)).toBeNull()
  })

  it('soporta base64url (con "-" y "_") sin lanzar errores', () => {
    // Construimos un payload cuyo base64 estándar contenga + y / para verificar
    // que el reemplazo a base64url no rompe el decodificado normal.
    const payload = btoa(JSON.stringify({ exp: 1_700_000_000, extra: '??>>++//' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    const token = `cabecera.${payload}.firma`
    expect(decodeJwtExp(token)).toBe(1_700_000_000)
  })
})

describe('tokenPorVencer', () => {
  it('es true cuando el token ya venció', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2_000_000_000 * 1000))
    const token = jwtConExp(1_999_999_999) // exp en el pasado
    expect(tokenPorVencer(token)).toBe(true)
  })

  it('es true cuando el token vence dentro del búfer (20s por defecto)', () => {
    vi.useFakeTimers()
    const ahora = 2_000_000_000
    vi.setSystemTime(new Date(ahora * 1000))
    const token = jwtConExp(ahora + 10) // vence en 10s, búfer de 20s
    expect(tokenPorVencer(token)).toBe(true)
  })

  it('es false cuando el token todavía tiene vida fuera del búfer', () => {
    vi.useFakeTimers()
    const ahora = 2_000_000_000
    vi.setSystemTime(new Date(ahora * 1000))
    const token = jwtConExp(ahora + 3600) // vence en 1 hora
    expect(tokenPorVencer(token)).toBe(false)
  })

  it('respeta un búfer personalizado', () => {
    vi.useFakeTimers()
    const ahora = 2_000_000_000
    vi.setSystemTime(new Date(ahora * 1000))
    const token = jwtConExp(ahora + 50)
    expect(tokenPorVencer(token, 30)).toBe(false)
    expect(tokenPorVencer(token, 60)).toBe(true)
  })

  it('es false si no se puede leer "exp" (token corrupto) — no fuerza un refresco innecesario', () => {
    expect(tokenPorVencer('token-invalido')).toBe(false)
  })
})
