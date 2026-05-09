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

    const ws = new WebSocket(`ws://localhost:8000/ws/notificaciones/?token=${token}`)

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

    ws.onclose = () => {
      wsRef.current = null
      if (!activeRef.current) return
      // Reconexión exponencial simple (4 s)
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
