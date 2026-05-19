/**
 * Service Worker — Modo offline para el Panel Guardia (Sprint D1).
 *
 * Estrategia:
 *   - Intercepta solo POST /graphql/ con mutation registrarAccesoManual
 *   - Si la red falla → guarda en IndexedDB (accesos_pendientes)
 *   - Al recuperar conectividad → sincroniza automáticamente
 *   - QR dinámico TOTP queda deshabilitado offline (no puede validarse sin servidor)
 */

const DB_NAME    = 'vehicular_offline'
const DB_VERSION = 1
const STORE_NAME = 'accesos_pendientes'

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = e => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
        store.createIndex('timestamp', 'timestamp', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function guardarPendiente(payload) {
  const db    = await abrirDB()
  const tx    = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.add({ ...payload, timestamp: Date.now(), sincronizado: false })
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

async function obtenerPendientes() {
  const db    = await abrirDB()
  const tx    = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result.filter(r => !r.sincronizado))
    req.onerror   = () => reject(req.error)
  })
}

async function marcarSincronizado(id) {
  const db    = await abrirDB()
  const tx    = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  return new Promise((resolve, reject) => {
    const req = store.get(id)
    req.onsuccess = () => {
      const item = req.result
      if (item) { item.sincronizado = true; store.put(item) }
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

// ── Detectar si la request es una mutation de acceso manual ───────────────

function esMutationAccesoManual(body) {
  try {
    const parsed = JSON.parse(body)
    return parsed.query && parsed.query.includes('registrarAccesoManual')
  } catch {
    return false
  }
}

// ── Interceptar fetch ─────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  const esGraphQL = url.pathname.endsWith('/graphql/')

  if (!esGraphQL || event.request.method !== 'POST') return

  event.respondWith(handleGraphQL(event.request))
})

async function handleGraphQL(request) {
  // Clonar para poder leer el body
  const clone  = request.clone()
  const body   = await clone.text()
  const esMuta = esMutationAccesoManual(body)

  // Si la red está disponible → flujo normal
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(8000) })
    // Si es mutation de acceso manual y tuvo éxito → notificar sincronización OK
    if (esMuta && response.ok) {
      const clients = await self.clients.matchAll()
      clients.forEach(c => c.postMessage({ tipo: 'acceso_registrado_online' }))
    }
    return response
  } catch {
    // Sin red — solo guardar si es mutation de acceso manual
    if (esMuta) {
      await guardarPendiente({ body, url: request.url })
      const pendientes = await obtenerPendientes()
      const clients = await self.clients.matchAll()
      clients.forEach(c => c.postMessage({
        tipo: 'acceso_offline_guardado',
        pendientes: pendientes.length,
      }))
      // Respuesta simulada para no bloquear la UI
      return new Response(JSON.stringify({
        data: { registrarAccesoManual: { placaVehiculo: null, metodoAcceso: 'offline' } },
        extensions: { offline: true },
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    // Para otras queries offline → error normal
    return new Response(JSON.stringify({ errors: [{ message: 'Sin conexión a internet' }] }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

// ── Sincronización cuando regresa la red ─────────────────────────────────

self.addEventListener('message', async event => {
  if (event.data?.tipo === 'sync_ahora') {
    await sincronizarPendientes()
  }
})

self.addEventListener('online', () => { sincronizarPendientes() })

async function sincronizarPendientes() {
  let pendientes
  try { pendientes = await obtenerPendientes() } catch { return }
  if (!pendientes.length) return

  let sincronizados = 0
  for (const item of pendientes) {
    try {
      const resp = await fetch(item.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: item.body,
      })
      if (resp.ok) {
        await marcarSincronizado(item.id)
        sincronizados++
      }
    } catch { /* seguir con el siguiente */ }
  }

  if (sincronizados > 0) {
    const clients = await self.clients.matchAll()
    clients.forEach(c => c.postMessage({ tipo: 'sync_completada', sincronizados }))
  }
}

// ── Instalación y activación ──────────────────────────────────────────────

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})
