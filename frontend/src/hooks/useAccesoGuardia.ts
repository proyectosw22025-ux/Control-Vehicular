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
  const [procesandoQr, setProcesandoQr]   = useState(false) // feedback previo a la red
  const [conexion, setConexion]           = useState<EstadoConexion>({
    online: navigator.onLine,
    reintentando: false,
    intentos: 0,
  })
  // puntoId necesita STATE (no solo ref) para que el select re-renderice cuando cambia.
  // El ref se mantiene para que registrarQr/registrarManual puedan leer el valor
  // dentro de callbacks sin depender del closure (evita stale closure).
  const [puntoIdState, setPuntoIdState]   = useState<number | null>(() => {
    const saved = localStorage.getItem('guardia_punto_id')
    return saved ? parseInt(saved) : null
  })
  const timerResultado = useRef<ReturnType<typeof setTimeout> | null>(null)
  const puntoIdRef     = useRef<number | null>(puntoIdState)
  // Ref síncrono para prevenir doble-ejecución antes del re-render.
  // `procesando` es estado (asincrónico) y no es suficiente como guard.
  const enEjecucionRef = useRef(false)

  // Limpia el resultado después de N segundos
  // Éxito = 3000ms (guardia procesa la placa en 2s) | Error = 7000ms (necesita más tiempo para leer)
  function mostrarResultado(r: ResultadoAcceso, duracion?: number) {
    const ms = duracion ?? (r.ok ? 3000 : 7000)
    setResultado(r)
    if (timerResultado.current) clearTimeout(timerResultado.current)
    timerResultado.current = setTimeout(() => setResultado(null), ms)
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

      // Error de negocio → NO reintentar, mostrar al guardia inmediatamente.
      // Incluye errores de estado (ya dentro/fuera) y de validación de datos.
      const esErrorNegocio = [
        'sancionado', 'pendiente', 'inactivo',
        'inválido', 'expirado', 'no encontrado', 'no reconocido',
        'ya está dentro', 'ya está fuera', 'ya ingresó', 'ya salió',
        'no tiene registros', 'no se puede registrar',
        'sin respuesta',
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
    // Guard síncrono: evita doble-registro si el scanner dispara antes del re-render
    if (enEjecucionRef.current) return
    enEjecucionRef.current = true

    const puntoId = puntoIdRef.current
    if (!puntoId) {
      mostrarResultado({ ok: false, mensaje: 'Selecciona un punto de acceso primero' })
      enEjecucionRef.current = false
      return
    }
    if (!navigator.onLine) {
      mostrarResultado({
        ok: false,
        mensaje: 'Sin conexión a internet. El acceso no pudo registrarse.',
      }, 8000)
      enEjecucionRef.current = false
      return
    }

    setProcesando(true)
    setProcesandoQr(true)
    try {
      const result = await ejecutarConRetry(() =>
        mutarQr({ variables: { input: { puntoAccesoId: puntoId, codigo, tipo } } })
      )
      // errorPolicy:'all' → errores GraphQL NO lanzan excepción, vienen en result.errors.
      // Sin esta verificación, el frontend mostraría "Entrada registrada" aunque el backend rechazara.
      if (result.errors?.length) {
        throw new Error(result.errors[0].message)
      }
      const r = result.data?.registrarAcceso
      if (!r) throw new Error('Sin respuesta del servidor. Intenta de nuevo.')
      mostrarResultado({
        ok: true,
        mensaje: tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada',
        placa:   r.placaVehiculo,
        metodo:  r.metodoAcceso,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar acceso'
      mostrarResultado({ ok: false, mensaje: msg }, 7000)
    } finally {
      setProcesando(false)
      setProcesandoQr(false)
      setConexion(c => ({ ...c, reintentando: false, intentos: 0 }))
      enEjecucionRef.current = false
    }
  }, [mutarQr])

  // ── Registrar acceso manual por placa ────────────────────────────────────

  const registrarManual = useCallback(async (placa: string, tipo: TipoAcceso) => {
    if (enEjecucionRef.current) return
    enEjecucionRef.current = true

    const puntoId = puntoIdRef.current
    if (!puntoId || !placa.trim()) { enEjecucionRef.current = false; return }
    if (!navigator.onLine) {
      mostrarResultado({ ok: false, mensaje: 'Sin conexión. Acceso no registrado.' }, 8000)
      enEjecucionRef.current = false
      return
    }

    setProcesando(true)
    try {
      const result = await ejecutarConRetry(() =>
        mutarManual({
          variables: {
            input: { puntoAccesoId: puntoId, placa: placa.trim().toUpperCase(), tipo },
          },
        })
      )
      if (result.errors?.length) {
        throw new Error(result.errors[0].message)
      }
      const r = result.data?.registrarAccesoManual
      if (!r) throw new Error('Sin respuesta del servidor. Intenta de nuevo.')
      mostrarResultado({
        ok: true,
        mensaje: tipo === 'entrada' ? 'Entrada manual registrada' : 'Salida manual registrada',
        placa:   r.placaVehiculo,
        metodo:  'manual',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar acceso'
      mostrarResultado({ ok: false, mensaje: msg }, 7000)
    } finally {
      setProcesando(false)
      setConexion(c => ({ ...c, reintentando: false, intentos: 0 }))
      enEjecucionRef.current = false
    }
  }, [mutarManual])

  // ── Gestión del punto de acceso ───────────────────────────────────────────

  const setPuntoId = useCallback((id: number | null) => {
    puntoIdRef.current = id          // ref para callbacks (no stale closure)
    setPuntoIdState(id)              // state para re-renderizar el select
    if (id) localStorage.setItem('guardia_punto_id', String(id))
    else     localStorage.removeItem('guardia_punto_id')
  }, [])

  return {
    resultado,
    procesando,
    procesandoQr,                    // true entre detección QR y respuesta de red
    conexion,
    puntoId: puntoIdState,
    setPuntoId,
    registrarQr,
    registrarManual,
    limpiarResultado: () => setResultado(null),
  }
}
