/**
 * Única fuente de verdad de las URLs del backend.
 *
 * - Desarrollo (vite dev): apunta al backend local en :8000.
 * - Producción (build Docker / Nginx): usa MISMO ORIGEN — así una sola imagen
 *   funciona en cualquier host (VPS, otra PC, dominio). Nginx ya proxea
 *   /graphql, /api, /media, /static y /ws hacia el backend, por lo que NO hay
 *   que recompilar el frontend por cada servidor.
 * - VITE_GRAPHQL_URI / VITE_WS_URI permiten forzar un destino fijo si se desea
 *   (por ejemplo, un dominio de API separado).
 */
const DEV = import.meta.env.DEV

/** URL del endpoint GraphQL. */
export const GRAPHQL_URI: string =
  import.meta.env.VITE_GRAPHQL_URI ??
  (DEV ? 'http://127.0.0.1:8000/graphql/' : '/graphql/')

/** Base HTTP del backend, sin el sufijo /graphql/ (para /api/..., /media/...). */
export const API_BASE: string = GRAPHQL_URI.replace(/\/graphql\/?$/, '')

/**
 * Construye la URL absoluta de un WebSocket del backend.
 * @param path ruta del WS, p.ej. '/ws/notificaciones/'
 */
export function wsUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const override = import.meta.env.VITE_WS_URI
  if (override) {
    // Acepta override con o sin la ruta /ws/...; nos quedamos con la base.
    const base = override.replace(/\/ws\/?.*$/, '').replace(/\/$/, '')
    return `${base}${p}`
  }
  if (DEV) return `ws://127.0.0.1:8000${p}`
  // Producción: mismo origen, con wss si la página va por https.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${p}`
}
