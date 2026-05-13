/**
 * Hook de dominio para el Panel Guardia.
 *
 * Regla 4 (Asincronía): maneja WebSocket Error 4001 (token expirado)
 * con reintento automático, y detecta pérdida de conexión de red.
 *
 * Regla 5 (Clean Code): cada función es testeable de forma aislada.
 */
import { useState, useCallback, useRef } from 'react'
import { useMutation } from '@apollo/client'
import {
  REGISTRAR_ACCESO_MUTATION,
  REGISTRAR_ACCESO_MANUAL_MUTATION,
} from '../graphql/mutations/acceso'

// ── Tipos estrictos alineados con el schema Strawberry ───────────────────

export type TipoAcceso = 'entrada' | 'salida'

export interface ResultadoAcceso {
  ok: boolean
  mensaje: string
  placa?: string
  metodo?: string
}

export interface EstadoConexion {
  online: boolean
  reintentando: boolean
  intentos: number
}

// ── Configuración de retry ────────────────────────────────────────────────

const MAX_REINTENTOS = 3
const DELAY_BASE_MS  = 1000  // exponential backoff: 1s, 2s, 4s

// ── Hook principal ────────────────────────────────────────────────────────

export function useAccesoGuardia() {
  const [resultado, setResultado]         = useState<ResultadoAcceso | null>(null)
  const [procesando, setProcesando]       = useState(false)
  const [conexion, setConexion]           = useState<EstadoConexion>({
    online: navigator.onLine,
    reintentando: false,
    intentos: 0,
  })
  const timerResultado = useRef<ReturnType<typeof setTimeout> | null>(null)
  const puntoIdRef     = useRef<number | null>(null)

  // Limpia el resultado después de N segundos
  function mostrarResultado(r: ResultadoAcceso, duracion = 5000) {
    setResultado(r)
    if (timerResultado.current) clearTimeout(timerResultado.current)
    timerResultado.current = setTimeout(() => setResultado(null), duracion)
  }

  // ── Mutations Apollo ─────────────────────────────────────────────────────

  const [mutarQr]     = useMutation(REGISTRAR_ACCESO_MUTATION)
  const [mutarManual] = useMutation(REGISTRAR_ACCESO_MANUAL_MUTATION)

  // ── Retry con exponential backoff ─────────────────────────────────────────

  async function ejecutarConRetry<T>(
    fn: () => Promise<T>,
    intento = 0,
  ): Promise<T> {
    try {
      setConexion(c => ({ ...c, reintentando: intento > 0, intentos: intento }))
      return await fn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)

      // Error de negocio (vehículo sancionado, código inválido, etc.)
      // → NO reintentar, mostrar al guardia inmediatamente
      const esErrorNegocio = [
        'sancionado', 'pendiente', 'inactivo',
        'inválido', 'expirado', 'no encontrado', 'no reconocido',
      ].some(p => msg.toLowerCase().includes(p))

      if (esErrorNegocio || intento >= MAX_REINTENTOS) {
        setConexion(c => ({ ...c, reintentando: false }))
        throw err
      }

      // Error de red / timeout → reintentar con backoff
      const delay = DELAY_BASE_MS * Math.pow(2, intento)
      await new Promise(res => setTimeout(res, delay))
      return ejecutarConRetry(fn, intento + 1)
    }
  }

  // ── Registrar acceso por QR ───────────────────────────────────────────────

  const registrarQr = useCallback(async (codigo: string, tipo: TipoAcceso) => {
    const puntoId = puntoIdRef.current
    if (!puntoId) {
      mostrarResultado({ ok: false, mensaje: 'Selecciona un punto de acceso primero' })
      return
    }
    if (!navigator.onLine) {
      mostrarResultado({
        ok: false,
        mensaje: 'Sin conexión a internet. El acceso no pudo registrarse.',
      }, 8000)
      return
    }

    setProcesando(true)
    try {
      const { data } = await ejecutarConRetry(() =>
        mutarQr({ variables: { input: { puntoAccesoId: puntoId, codigo, tipo } } })
      )
      const r = data?.registrarAcceso
      mostrarResultado({
        ok: true,
        mensaje: tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada',
        placa:   r?.placaVehiculo,
        metodo:  r?.metodoAcceso,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar acceso'
      mostrarResultado({ ok: false, mensaje: msg }, 7000)
    } finally {
      setProcesando(false)
      setConexion(c => ({ ...c, reintentando: false, intentos: 0 }))
    }
  }, [mutarQr])

  // ── Registrar acceso manual por placa ────────────────────────────────────

  const registrarManual = useCallback(async (placa: string, tipo: TipoAcceso) => {
    const puntoId = puntoIdRef.current
    if (!puntoId || !placa.trim()) return
    if (!navigator.onLine) {
      mostrarResultado({ ok: false, mensaje: 'Sin conexión. Acceso no registrado.' }, 8000)
      return
    }

    setProcesando(true)
    try {
      const { data } = await ejecutarConRetry(() =>
        mutarManual({
          variables: {
            input: { puntoAccesoId: puntoId, placa: placa.trim().toUpperCase(), tipo },
          },
        })
      )
      const r = data?.registrarAccesoManual
      mostrarResultado({
        ok: true,
        mensaje: tipo === 'entrada' ? 'Entrada manual registrada' : 'Salida manual registrada',
        placa:   r?.placaVehiculo,
        metodo:  'manual',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar acceso'
      mostrarResultado({ ok: false, mensaje: msg }, 7000)
    } finally {
      setProcesando(false)
      setConexion(c => ({ ...c, reintentando: false, intentos: 0 }))
    }
  }, [mutarManual])

  // ── Gestión del punto de acceso (persistido en localStorage) ─────────────

  const setPuntoId = useCallback((id: number | null) => {
    puntoIdRef.current = id
    if (id) localStorage.setItem('guardia_punto_id', String(id))
    else localStorage.removeItem('guardia_punto_id')
  }, [])

  const puntoIdGuardado = localStorage.getItem('guardia_punto_id')
  if (puntoIdGuardado && puntoIdRef.current === null) {
    puntoIdRef.current = parseInt(puntoIdGuardado)
  }

  return {
    resultado,
    procesando,
    conexion,
    puntoId: puntoIdRef.current,
    setPuntoId,
    registrarQr,
    registrarManual,
    limpiarResultado: () => setResultado(null),
  }
}
