/**
 * Hook de OCR de placas vehiculares — Opción B: PaddleOCR en backend.
 *
 * Cambio vs Tesseract.js local:
 *   - No descarga WASM ni modelo en el navegador (primera carga instantánea)
 *   - Envía el frame como base64 JPEG al endpoint Django /api/ocr/placa/
 *   - PaddleOCR (PP-OCRv4) corre en el servidor Railway con preprocessing PIL
 *   - Precisión estimada: ~88-95% vs ~75-88% de Tesseract local
 *   - Requiere conexión a internet (degradación graceful: retorna null si sin red)
 *   - Timeout de 5 segundos para no bloquear al guardia
 *
 * La interfaz pública (inicializado, cargando, reconocer) es idéntica a la
 * versión anterior — PlacaScanner.tsx no requiere cambios.
 */
import { useCallback } from 'react'

const BASE_URL = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/')
  .replace(/\/graphql\/?$/, '')

export function useOcrPlaca() {
  // Sin inicialización pesada — el backend ya tiene el modelo cargado
  const inicializado = true
  const cargando     = false

  const reconocer = useCallback(async (canvas: HTMLCanvasElement): Promise<string | null> => {
    if (!navigator.onLine) return null  // sin red → caer a manual directamente

    try {
      // Extraer frame como JPEG base64 (calidad 0.85 — balance tamaño/precisión)
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
      const token  = localStorage.getItem('access_token') ?? ''

      const resp = await fetch(`${BASE_URL}/api/ocr/placa/`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body:   JSON.stringify({ imagen: base64 }),
        signal: AbortSignal.timeout(5000),  // 5s máximo — guardia no puede esperar más
      })

      if (!resp.ok) return null

      const data = await resp.json()
      return (data.placa as string | null) ?? null
    } catch {
      // Timeout, red caída o error del servidor → caer a manual silenciosamente
      return null
    }
  }, [])

  return { inicializado, cargando, reconocer }
}
