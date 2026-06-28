import { useEffect, useRef, useCallback } from 'react'
import { useApolloClient } from '@apollo/client'
import { CONTEO_NO_LEIDAS_QUERY, MIS_NOTIFICACIONES_QUERY } from '../graphql/queries/notificaciones'
import { GRAPHQL_URI, wsUrl } from '../config/endpoints'

export interface NotifPayload {
  id: number
  titulo: string
  mensaje: string
  fecha: string
  tipoCodigo?: string
  datosExtra?: Record<string, unknown>  // contexto adicional (ej: vehiculo_id, placa)
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

    const ws = new WebSocket(`${wsUrl('/ws/notificaciones/')}?token=${token}`)

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
          onNuevaRef.current?.({
            id:         data.id,
            titulo:     data.titulo,
            mensaje:    data.mensaje,
            fecha:      data.fecha,
            tipoCodigo: data.tipo_codigo ?? '',
            datosExtra: data.datos_extra ?? {},
          })
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
