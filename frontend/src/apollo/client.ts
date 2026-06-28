import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { Observable } from '@apollo/client/utilities'
import { GRAPHQL_URI } from '../config/endpoints'

// ── Lectura del campo "exp" de un JWT (sin verificar firma) ─
// Exportadas para poder probar la lógica de refresco proactivo sin
// necesidad de levantar un cliente Apollo completo.
export function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.exp === 'number' ? json.exp : null
  } catch {
    return null
  }
}

// El access token vence en pocos segundos (o ya venció): hay que refrescarlo
// ANTES de usarlo. El backend (JWTAuthMiddleware) ignora tokens inválidos en
// silencio y trata la petición como anónima sin lanzar error de autenticación
// — por eso no basta con reaccionar a errores, hay que anticiparse al vencimiento.
export function tokenPorVencer(token: string, bufferSegundos = 20): boolean {
  const exp = decodeJwtExp(token)
  if (exp === null) return false
  return exp * 1000 - Date.now() < bufferSegundos * 1000
}

// ── Refresco de token ──────────────────────────────────────
// Usa fetch nativo para evitar dependencia circular con el client de Apollo.
async function getNewAccessToken(): Promise<string | null> {
  const refresh = localStorage.getItem('refresh_token')
  if (!refresh) return null
  try {
    const res = await fetch(GRAPHQL_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `mutation RefreshToken($refresh: String!) { refreshToken(refresh: $refresh) }`,
        variables: { refresh },
      }),
    })
    const json = await res.json()
    const newToken: string | undefined = json.data?.refreshToken
    if (!newToken) return null
    localStorage.setItem('access_token', newToken)
    return newToken
  } catch {
    return null
  }
}

function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('usuario')
  window.location.href = '/login'
}

// ── Guarda de refresco para evitar múltiples llamadas simultáneas ──
// Tanto el refresco proactivo (authLink) como el reactivo (errorLink) pasan
// por aquí: si ya hay un refresco en curso, todos esperan ese mismo resultado
// en vez de disparar peticiones de refresh en paralelo.
let refreshing = false
let queue: Array<(token: string | null) => void> = []

function drainQueue(token: string | null) {
  queue.forEach(cb => cb(token))
  queue = []
}

function ensureFreshToken(): Promise<string | null> {
  if (refreshing) {
    return new Promise(resolve => queue.push(resolve))
  }
  refreshing = true
  return getNewAccessToken()
    .then(token => { refreshing = false; drainQueue(token); return token })
    .catch(() => { refreshing = false; drainQueue(null); return null })
}

// ── Link: inyectar Bearer token en cada request ────────────
// Si el token está por vencer, se refresca ANTES de enviar la petición
// (refresco proactivo) — así el backend nunca lo recibe expirado.
const authLink = setContext(async (_, { headers }) => {
  let token = localStorage.getItem('access_token')
  if (token && tokenPorVencer(token)) {
    const fresco = await ensureFreshToken()
    if (!fresco) { logout(); return { headers } }
    token = fresco
  }
  return {
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }
})

// ── Link: capturar errores de autenticación y refrescar ────
// Red de seguridad para casos que el refresco proactivo no cubra
// (desfase de reloj, token revocado en el servidor, etc.)
const errorLink = onError(({ graphQLErrors, operation, forward }) => {
  const isAuthError = graphQLErrors?.some(
    e =>
      e.message.includes('Autenticación requerida') ||
      e.message.toLowerCase().includes('unauthenticated') ||
      e.extensions?.code === 'UNAUTHENTICATED'
  )

  if (!isAuthError) return

  return new Observable(observer => {
    ensureFreshToken().then(token => {
      if (!token) { logout(); observer.complete(); return }
      operation.setContext(({ headers = {} }: { headers: Record<string, string> }) => ({
        headers: { ...headers, authorization: `Bearer ${token}` },
      }))
      forward(operation).subscribe({
        next:     observer.next.bind(observer),
        error:    observer.error.bind(observer),
        complete: observer.complete.bind(observer),
      })
    })
  })
})

// Fetch con timeout de 20s para evitar "Guardando..." eterno en Railway
const fetchWithTimeout: typeof fetch = (input, options = {}) => {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), 20_000)
  return fetch(input, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(id))
}

// ── Link: HTTP ─────────────────────────────────────────────
const httpLink = createHttpLink({ uri: GRAPHQL_URI, fetch: fetchWithTimeout })

// ── Client: errorLink → authLink → httpLink ────────────────
export const client = new ApolloClient({
  link: errorLink.concat(authLink).concat(httpLink),
  cache: new InMemoryCache(),
  defaultOptions: {
    mutate:     { errorPolicy: 'all' },
    query:      { errorPolicy: 'all' },
    watchQuery: { errorPolicy: 'all' },
  },
})
