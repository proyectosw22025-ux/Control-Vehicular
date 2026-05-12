import { ApolloClient, InMemoryCache, createHttpLink } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { onError } from '@apollo/client/link/error'
import { Observable } from '@apollo/client/utilities'

const GRAPHQL_URI = import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/'

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
let refreshing = false
let queue: Array<(token: string | null) => void> = []

function drainQueue(token: string | null) {
  queue.forEach(cb => cb(token))
  queue = []
}

// ── Link: inyectar Bearer token en cada request ────────────
const authLink = setContext((_, { headers }) => {
  const token = localStorage.getItem('access_token')
  return {
    headers: {
      ...headers,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  }
})

// ── Link: capturar errores de autenticación y refrescar ────
const errorLink = onError(({ graphQLErrors, operation, forward }) => {
  const isAuthError = graphQLErrors?.some(
    e =>
      e.message.includes('Autenticación requerida') ||
      e.message.toLowerCase().includes('unauthenticated') ||
      e.extensions?.code === 'UNAUTHENTICATED'
  )

  if (!isAuthError) return

  // Si ya hay un refresco en curso, encolar esta operación
  if (refreshing) {
    return new Observable(observer => {
      queue.push((token: string | null) => {
        if (!token) { observer.complete(); return }
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
  }

  refreshing = true
  return new Observable(observer => {
    getNewAccessToken()
      .then(token => {
        refreshing = false
        drainQueue(token)
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
      .catch(() => {
        refreshing = false
        drainQueue(null)
        logout()
        observer.complete()
      })
  })
})

// ── Link: HTTP ─────────────────────────────────────────────
const httpLink = createHttpLink({ uri: GRAPHQL_URI })

// ── Client: errorLink → authLink → httpLink ────────────────
export const client = new ApolloClient({
  link: errorLink.concat(authLink).concat(httpLink),
  cache: new InMemoryCache(),
})
