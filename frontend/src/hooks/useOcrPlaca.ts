/**
 * Hook que gestiona el worker de Tesseract.js para OCR de placas bolivianas.
 *
 * Carga Tesseract dinámicamente (import()) para no aumentar el bundle principal.
 * El WASM y el modelo de idioma se cachean en IndexedDB del navegador tras la
 * primera descarga — permite uso offline posterior.
 *
 * Parámetros OCR ajustados para placas:
 *   - Whitelist: solo A-Z, 0-9 y guión
 *   - PSM 7: una sola línea de texto (formato de placa)
 *   - OEM 1: LSTM neural net (más preciso que tesseract legacy)
 */
import { useState, useEffect, useRef, useCallback } from 'react'

const PLACA_RE = /([A-Z]{2,4}[-\s]?\d{3,4}[A-Z]?)/i

export function useOcrPlaca() {
  const workerRef  = useRef<any>(null)
  const [inicializado, setInicializado] = useState(false)
  const [cargando,     setCargando]     = useState(false)

  useEffect(() => {
    let mounted = true
    setCargando(true)

    async function init() {
      try {
        const tesseract = await import('tesseract.js')
        const { createWorker } = tesseract
        const worker = await createWorker('eng', 1, {
          logger: () => {}, // suprimir logs verbosos
        })
        // PSM.SINGLE_LINE = 7, OEM.LSTM_ONLY = 1
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tessedit_pageseg_mode: (tesseract as any).PSM?.SINGLE_LINE ?? ('7' as any),
        })
        if (mounted) {
          workerRef.current = worker
          setInicializado(true)
        } else {
          await worker.terminate()
        }
      } catch (e) {
        console.error('[OCR] Error inicializando Tesseract:', e)
      } finally {
        if (mounted) setCargando(false)
      }
    }

    init()
    return () => {
      mounted = false
      workerRef.current?.terminate()
    }
  }, [])

  const reconocer = useCallback(async (canvas: HTMLCanvasElement): Promise<string | null> => {
    if (!workerRef.current) return null
    try {
      const { data: { text } } = await workerRef.current.recognize(canvas)
      // Limpiar texto: solo alfanumérico y guión
      const limpio = text.replace(/[^A-Z0-9-]/gi, '').toUpperCase()
      const match  = limpio.match(PLACA_RE)
      if (!match) return null
      // Normalizar: reemplazar espacio por guión
      return match[0].replace(/\s/g, '-').toUpperCase()
    } catch {
      return null
    }
  }, [])

  return { inicializado, cargando, reconocer }
}
