import { useEffect, useRef, useCallback } from 'react'
import { useApolloClient } from '@apollo/client'
import { CONTEO_NO_LEIDAS_QUERY, MIS_NOTIFICACIONES_QUERY } from '../graphql/queries/notificaciones'

export interface NotifPayload {
  id: number
  titulo: string
  mensaje: string
  fecha: string
}

export function useNotificaciones(onNueva?: (n: NotifPayload) => void) {
  const client = useApolloClient()
  const wsRef = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeRef = useRef(true)
  const onNuevaRef = useRef(onNueva)

  // Mantener la callback actualizada sin re-conectar
  useEffect(() => { onNuevaRef.current = onNueva }, [onNueva])

  const conectar = useCallback(() => {
    if (!activeRef.current) return
    const token = localStorage.getItem('access_token')
    if (!token) return

    const WS_BASE = import.meta.env.VITE_WS_URI ?? 'ws://localhost:8000/ws/notificaciones/'
    const ws = new WebSocket(`${WS_BASE}?token=${token}`)

    ws.onopen = () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.tipo === 'conectado' || data.tipo === 'nueva_notificacion') {
          client.refetchQueries({ include: [CONTEO_NO_LEIDAS_QUERY, MIS_NOTIFICACIONES_QUERY] })
        }
        if (data.tipo === 'nueva_notificacion') {
          onNuevaRef.current?.({ id: data.id, titulo: data.titulo, mensaje: data.mensaje, fecha: data.fecha })
        }
      } catch { /* ignorar mensajes malformados */ }
    }

    ws.onclose = async (event) => {
      wsRef.current = null
      if (!activeRef.current) return

      if (event.code === 4001) {
        // Token expirado/inválido — intentar refrescar antes de reconectar
        const refresh = localStorage.getItem('refresh_token')
        if (!refresh) return  // sin refresh token: no reconectar, esperar login
        try {
          const GRAPHQL_URI = import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/'
          const res = await fetch(GRAPHQL_URI, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'mutation RefreshToken($refresh: String!) { refreshToken(refresh: $refresh) }',
              variables: { refresh },
            }),
          })
          const json = await res.json()
          const newToken: string | undefined = json.data?.refreshToken
          if (!newToken) return  // refresh falló: no reconectar
          localStorage.setItem('access_token', newToken)
          timerRef.current = setTimeout(conectar, 500)
        } catch {
          // error de red durante refresh: no reconectar en bucle
        }
        return
      }

      // Cierre normal (red, servidor reiniciado, etc.): reconectar en 4 s
      timerRef.current = setTimeout(conectar, 4000)
    }

    ws.onerror = () => { /* onclose se disparará automáticamente */ }

    wsRef.current = ws
  }, [client])

  useEffect(() => {
    activeRef.current = true
    conectar()
    return () => {
      activeRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [conectar])
}
