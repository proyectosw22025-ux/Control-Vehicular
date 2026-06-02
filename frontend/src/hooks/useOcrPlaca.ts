/**
 * Hook OCR de placas v3 — FastALPR backend con soporte multi-frame.
 *
 * Modos:
 *   reconocer(canvas)            → single frame (compatibilidad)
 *   reconocerMultiframe(frames)  → 3 frames → backend vota el resultado más frecuente
 *
 * Respuesta mejorada:
 *   { placa, confianza, nivel: 'alto'|'medio'|'bajo', metodo, ms }
 *
 * Niveles de confianza:
 *   alto   >= 0.85 → acepta automáticamente (verde)
 *   medio  0.60-0.84 → muestra "Revisar" (amarillo) — guardia confirma
 *   bajo   < 0.60 → rechaza, pide nueva foto (rojo)
 */
import { useCallback } from 'react'

const BASE_URL = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/')
  .replace(/\/graphql\/?$/, '')

export interface ResultadoOcr {
  placa:      string | null
  confianza:  number
  nivel:      'alto' | 'medio' | 'bajo'
  metodo:     string
  ms:         number
}

export function useOcrPlaca() {
  const inicializado = true
  const cargando     = false

  /** Single frame — compatibilidad con código existente */
  const reconocer = useCallback(async (canvas: HTMLCanvasElement): Promise<string | null> => {
    const resultado = await reconocerConConfianza(canvas)
    return resultado?.placa ?? null
  }, [])

  /** Single frame con confianza completa */
  const reconocerConConfianza = useCallback(async (
    canvas: HTMLCanvasElement
  ): Promise<ResultadoOcr | null> => {
    if (!navigator.onLine) return null
    try {
      const base64 = canvas.toDataURL('image/jpeg', 0.90).split(',')[1]
      const token  = localStorage.getItem('access_token') ?? ''
      const resp   = await fetch(`${BASE_URL}/api/ocr/placa/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ imagen: base64 }),
        signal:  AbortSignal.timeout(8000),
      })
      if (!resp.ok) return null
      const data = await resp.json()
      return {
        placa:     data.placa ?? null,
        confianza: data.confianza ?? 0,
        nivel:     data.nivel ?? 'bajo',
        metodo:    data.metodo ?? 'desconocido',
        ms:        data.ms ?? 0,
      }
    } catch {
      return null
    }
  }, [])

  /**
   * Multi-frame: envía N frames al backend que vota el mejor resultado.
   * Reduce falsos negativos. Recomendado: 3 frames cada 500ms.
   */
  const reconocerMultiframe = useCallback(async (
    frames: string[]   // array de base64 JPEG
  ): Promise<ResultadoOcr | null> => {
    if (!navigator.onLine || frames.length === 0) return null
    try {
      const token = localStorage.getItem('access_token') ?? ''
      const resp  = await fetch(`${BASE_URL}/api/ocr/placa/`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ imagenes: frames }),
        signal:  AbortSignal.timeout(15_000),  // multi-frame puede tardar más
      })
      if (!resp.ok) return null
      const data = await resp.json()
      return {
        placa:     data.placa ?? null,
        confianza: data.confianza ?? 0,
        nivel:     data.nivel ?? 'bajo',
        metodo:    data.metodo ?? 'desconocido',
        ms:        data.ms ?? 0,
      }
    } catch {
      return null
    }
  }, [])

  return { inicializado, cargando, reconocer, reconocerConConfianza, reconocerMultiframe }
}
