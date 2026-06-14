/**
 * Hook de dominio para el Panel Guardia.
 *
 * Regla 4 (Asincronía): maneja WebSocket Error 4001 (token expirado)
 * con reintento automático, y detecta pérdida de conexión de red.
 *
 * Regla 5 (Clean Code): cada función es testeable de forma aislada.
 */
import { useState, useCallback, useRef } from 'react'
import { useMutation, useApolloClient } from '@apollo/client'
import {
  REGISTRAR_ACCESO_MUTATION,
  REGISTRAR_ACCESO_MANUAL_MUTATION,
} from '../graphql/mutations/acceso'
import { SUGERENCIAS_PLACA_QUERY } from '../graphql/queries/vehiculos'

// ── Tipos estrictos alineados con el schema Strawberry ───────────────────

// 'auto' = el backend deduce entrada/salida según el estado del vehículo.
// El guardia no decide la dirección: cero errores de toggle, cero colas a contraflujo.
export type TipoAcceso = 'entrada' | 'salida' | 'auto'

export interface AlertaInfo {
  id:             number
  tipoAnomalia:   string
  severidad:      'critica' | 'advertencia' | 'info'
  descripcion:    string
  fecha?:         string
  vehiculoPlaca?: string
}

export interface SugerenciaPlaca {
  id:                number
  placa:             string
  marca:             string
  modelo:            string
  color:             string
  propietarioNombre: string
}

export interface EspacioSugerido {
  espacioId:       number
  numero:          string
  zonaNombre:      string
  categoriaNombre: string
  vehiculoId:      number
}

export interface ResultadoAcceso {
  ok:      boolean
  mensaje: string
  placa?:  string
  metodo?: string
  alertas: AlertaInfo[]
  // Cuando la placa no se encontró, candidatos a distancia de edición 1.
  sugerencias?: SugerenciaPlaca[]
  // Tras una entrada, espacio libre compatible para asignar con un toque.
  espacioSugerido?: EspacioSugerido | null
  // Identidad del dueño para verificación visual en el portón.
  propietarioNombre?:  string | null
  propietarioFotoUrl?: string | null
  // Carril express: despacho inmediato del vehículo frecuente.
  esFrecuente?: boolean
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
  const apollo = useApolloClient()
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

  // Busca placas a distancia 1 cuando el lookup falló ("no registrado").
  // Devuelve [] ante cualquier problema — la sugerencia es un extra, no debe
  // romper el flujo de error principal.
  async function buscarSugerencias(placa: string): Promise<SugerenciaPlaca[]> {
    try {
      const { data } = await apollo.query({
        query: SUGERENCIAS_PLACA_QUERY,
        variables: { placa },
        fetchPolicy: 'network-only',
      })
      return data?.sugerenciasPlaca ?? []
    } catch {
      return []
    }
  }

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
      mostrarResultado({ ok: false, mensaje: 'Selecciona un punto de acceso primero', alertas: [] })
      enEjecucionRef.current = false
      return
    }
    if (!navigator.onLine) {
      mostrarResultado({
        ok: false, alertas: [],
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
      const alertas: AlertaInfo[] = (r.alertasDetectadas ?? []).map((a: any) => ({
        id:             a.id,
        tipoAnomalia:   a.tipoAnomalia,
        severidad:      a.severidad,
        descripcion:    a.descripcion,
        fecha:          a.fecha,
        vehiculoPlaca:  a.vehiculoPlaca,
      }))
      // En modo Auto el backend decide la dirección; el mensaje refleja r.tipo real.
      const dir = (r.tipo ?? tipo) === 'entrada' ? 'Entrada' : 'Salida'
      mostrarResultado({
        ok:      true,
        mensaje: `${dir} registrada`,
        placa:   r.placaVehiculo,
        metodo:  r.metodoAcceso,
        alertas,
        espacioSugerido: r.espacioSugerido ?? null,
        propietarioNombre:  r.propietarioNombre ?? null,
        propietarioFotoUrl: r.propietarioFotoUrl ?? null,
        esFrecuente: r.esFrecuente ?? false,
      }, r.espacioSugerido ? 12000 : undefined)  // más tiempo si hay acción pendiente
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar acceso'
      mostrarResultado({ ok: false, mensaje: msg, alertas: [] }, 7000)
    } finally {
      setProcesando(false)
      setProcesandoQr(false)
      setConexion(c => ({ ...c, reintentando: false, intentos: 0 }))
      enEjecucionRef.current = false
    }
  }, [mutarQr])

  // ── Registrar acceso manual por placa ────────────────────────────────────

  const registrarManual = useCallback(async (placa: string, tipo: TipoAcceso, imagenEvidencia?: string) => {
    if (enEjecucionRef.current) return
    enEjecucionRef.current = true

    const puntoId = puntoIdRef.current
    if (!puntoId || !placa.trim()) { enEjecucionRef.current = false; return }
    if (!navigator.onLine) {
      mostrarResultado({ ok: false, mensaje: 'Sin conexión. Acceso no registrado.', alertas: [] }, 8000)
      enEjecucionRef.current = false
      return
    }

    setProcesando(true)
    try {
      const result = await ejecutarConRetry(() =>
        mutarManual({
          variables: {
            input: {
              puntoAccesoId: puntoId, placa: placa.trim().toUpperCase(), tipo,
              ...(imagenEvidencia ? { imagenEvidencia } : {}),
            },
          },
        })
      )
      if (result.errors?.length) {
        throw new Error(result.errors[0].message)
      }
      const r = result.data?.registrarAccesoManual
      if (!r) throw new Error('Sin respuesta del servidor. Intenta de nuevo.')
      const alertasM: AlertaInfo[] = (r.alertasDetectadas ?? []).map((a: any) => ({
        id:             a.id,
        tipoAnomalia:   a.tipoAnomalia,
        severidad:      a.severidad,
        descripcion:    a.descripcion,
        fecha:          a.fecha,
        vehiculoPlaca:  a.vehiculoPlaca,
      }))
      const dir = (r.tipo ?? tipo) === 'entrada' ? 'Entrada' : 'Salida'
      mostrarResultado({
        ok:      true,
        mensaje: `${dir} manual registrada`,
        placa:   r.placaVehiculo,
        metodo:  'manual',
        alertas: alertasM,
        espacioSugerido: r.espacioSugerido ?? null,
        propietarioNombre:  r.propietarioNombre ?? null,
        propietarioFotoUrl: r.propietarioFotoUrl ?? null,
        esFrecuente: r.esFrecuente ?? false,
      }, r.espacioSugerido ? 12000 : undefined)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al registrar acceso'
      // Si la placa no existe (OCR mal leído o tipeo), ofrecer placas cercanas.
      const sugerencias = /no registrad/i.test(msg)
        ? await buscarSugerencias(placa)
        : []
      mostrarResultado({ ok: false, mensaje: msg, alertas: [], sugerencias }, sugerencias.length ? 10000 : 7000)
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
