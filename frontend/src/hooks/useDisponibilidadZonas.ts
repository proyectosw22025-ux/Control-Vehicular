/**
 * Hook de disponibilidad real de parqueo.
 *
 * Fuente primaria: WebSocket. El backend hace broadcast `disponibilidad_actualizada`
 * al abrir/cerrar una sesión de parqueo o cambiar un espacio — el hook parchea la
 * zona afectada al instante, sin re-consultar.
 *
 * Fallback: la query GraphQL `disponibilidadZonas` se ejecuta al montar y luego
 * cada 60s como red de seguridad (reconexión WS, página pública sin token, o un
 * cambio que no disparó broadcast). Antes esta query corría cada 15s para TODOS
 * los clientes — una tormenta de requests por datos que el servidor ya empuja.
 */
import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@apollo/client'
import { DISPONIBILIDAD_ZONAS_QUERY } from '../graphql/queries/parqueos'
import { wsUrl } from '../config/endpoints'

export interface DisponibilidadZona {
  id:               number
  nombre:           string
  descripcion:      string
  ubicacion:        string
  capacidadTotal:   number
  libres:           number
  sesionesActivas:  number
  enMantenimiento:  number
  porcentajeLibre:  number
  estado:           'disponible' | 'limitado' | 'saturado' | 'lleno' | 'sin_datos'
  colorEstado:      string
}

export interface AlertaSaturacion {
  zonaId:         number
  zonaNombre:     string
  estadoAnterior: string
  estadoNuevo:    string
  libres:         number
  timestamp:      number
}

const ORDEN_GRAVEDAD = ['disponible', 'limitado', 'saturado', 'lleno']

export function useDisponibilidadZonas() {
  const [zonas,     setZonas]     = useState<DisponibilidadZona[]>([])
  const [alertas,   setAlertas]   = useState<AlertaSaturacion[]>([])
  const zonasRef = useRef<DisponibilidadZona[]>([])
  zonasRef.current = zonas

  // Genera alerta si una zona EMPEORA de estado (disponible→limitado, etc.).
  function detectarAlerta(prev: DisponibilidadZona | undefined, nueva: DisponibilidadZona) {
    if (!prev || prev.estado === nueva.estado) return
    const idxPrev  = ORDEN_GRAVEDAD.indexOf(prev.estado)
    const idxNuevo = ORDEN_GRAVEDAD.indexOf(nueva.estado)
    if (idxNuevo > idxPrev) {
      setAlertas(a => [{
        zonaId: nueva.id, zonaNombre: nueva.nombre,
        estadoAnterior: prev.estado, estadoNuevo: nueva.estado,
        libres: nueva.libres, timestamp: Date.now(),
      }, ...a].slice(0, 5))
    }
  }

  // ── Fallback: query inicial + poll lento (60s) ───────────────────────────
  const { data, loading, refetch } = useQuery(DISPONIBILIDAD_ZONAS_QUERY, {
    pollInterval: 60_000,
    fetchPolicy:  'network-only',
    notifyOnNetworkStatusChange: false,
  })

  useEffect(() => {
    const frescas: DisponibilidadZona[] = data?.disponibilidadZonas ?? []
    if (!frescas.length) return
    frescas.forEach(z => detectarAlerta(zonasRef.current.find(p => p.id === z.id), z))
    setZonas(frescas)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // ── Fuente primaria: WebSocket en vivo ───────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return  // página pública sin sesión → solo polling

    const WS_BASE = wsUrl('/ws/notificaciones/')
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let activo = true

    const conectar = () => {
      if (!activo) return
      ws = new WebSocket(`${WS_BASE}?token=${token}`)
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data)
          if (d.tipo !== 'disponibilidad_actualizada') return
          // Parcheo en vivo de la zona afectada (mapea snake_case → camelCase).
          setZonas(prev => {
            const idx = prev.findIndex(z => z.id === d.zona_id)
            const actualizada: DisponibilidadZona = {
              id: d.zona_id,
              nombre: d.zona_nombre,
              descripcion: idx >= 0 ? prev[idx].descripcion : '',
              ubicacion:   idx >= 0 ? prev[idx].ubicacion   : '',
              capacidadTotal:  d.total,
              libres:          d.libres,
              sesionesActivas: d.sesiones_activas,
              enMantenimiento: d.en_mantenimiento,
              porcentajeLibre: d.porcentaje_libre,
              estado:          d.estado,
              colorEstado:     d.color_estado,
            }
            if (idx >= 0) detectarAlerta(prev[idx], actualizada)
            if (idx < 0) return [...prev, actualizada]
            const copia = [...prev]
            copia[idx] = actualizada
            return copia
          })
        } catch { /* ignorar mensajes malformados */ }
      }
      ws.onclose = () => {
        ws = null
        if (activo) reconnectTimer = setTimeout(conectar, 4000)  // reconexión simple
      }
      ws.onerror = () => { /* onclose se encarga */ }
    }
    conectar()

    return () => {
      activo = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])

  const descartarAlerta = (zonaId: number) =>
    setAlertas(a => a.filter(al => al.zonaId !== zonaId))

  return { zonas, loading, alertas, descartarAlerta, refetch }
}
