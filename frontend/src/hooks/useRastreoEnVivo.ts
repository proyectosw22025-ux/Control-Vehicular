/**
 * Hook de telemetría — recibe posiciones GPS en tiempo real via WebSocket.
 *
 * Se conecta a ws/rastreo/ y mantiene el mapa de vehículos activos en campus.
 * Admin/Guardia ven todos los vehículos. Propietario solo el suyo.
 *
 * Re-conecta automáticamente si el WebSocket se cae (con backoff exponencial).
 */
import { useState, useEffect, useRef, useCallback } from 'react'

export interface VehiculoEnCampus {
  vehiculoId:       number
  placa:            string
  lat:              number
  lng:              number
  velocidadKmh:     number
  timestamp:        string
  propietario:      string
  tipoVehiculo:     string
  enCampus:         boolean
  segundosDesdeActualizacion: number
}

export function useRastreoEnVivo() {
  const [vehiculos, setVehiculos] = useState<VehiculoEnCampus[]>([])
  const [conectado, setConectado] = useState(false)
  const [intento, setIntento]     = useState(0)
  const wsRef   = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Actualiza el contador "segundosDesdeActualizacion" cada 5s
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setVehiculos(prev =>
        prev.map(v => ({
          ...v,
          segundosDesdeActualizacion: Math.floor(
            (Date.now() - new Date(v.timestamp).getTime()) / 1000
          ),
        }))
      )
    }, 5000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const conectar = useCallback(() => {
    const token  = localStorage.getItem('access_token') ?? ''
    const wsBase = (import.meta.env.VITE_WS_URI ?? 'ws://127.0.0.1:8000/ws/')
      .replace(/\/notificaciones\/?$/, '')
    const url = `${wsBase}rastreo/?token=${token}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => { setConectado(true); setIntento(0) }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)

        if (data.tipo === 'conectado' && Array.isArray(data.ubicaciones_actuales)) {
          // Cargar estado inicial al conectar
          setVehiculos(data.ubicaciones_actuales.map(mapear))
        }

        if (data.tipo === 'ubicacion') {
          setVehiculos(prev => {
            const idx = prev.findIndex(v => v.vehiculoId === data.vehiculo_id)
            const nuevo = mapear({
              vehiculo_id:    data.vehiculo_id,
              placa:          data.placa,
              lat:            data.lat,
              lng:            data.lng,
              velocidad:      data.velocidad,
              timestamp:      data.timestamp,
              propietario:    data.propietario,
              tipo_vehiculo:  data.tipo_vehiculo,
              en_campus:      data.en_campus,
            })
            if (idx >= 0) {
              const arr = [...prev]
              arr[idx] = nuevo
              return arr
            }
            return [...prev, nuevo]
          })
        }

        if (data.tipo === 'vehiculo_salio') {
          setVehiculos(prev => prev.filter(v => v.vehiculoId !== data.vehiculo_id))
        }
      } catch { /* ignorar mensajes malformados */ }
    }

    ws.onclose = (e) => {
      setConectado(false)
      if (e.code !== 4001) {
        // Reconectar con backoff: 2s, 4s, 8s … máx 30s
        const delay = Math.min(2000 * Math.pow(2, intento), 30_000)
        setTimeout(() => { setIntento(n => n + 1) }, delay)
      }
    }
  }, [intento])

  useEffect(() => {
    conectar()
    return () => { wsRef.current?.close() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento])

  const vehiculosActivos = vehiculos.filter(v => v.enCampus)

  return { vehiculos: vehiculosActivos, conectado, totalEnCampus: vehiculosActivos.length }
}

function mapear(d: any): VehiculoEnCampus {
  return {
    vehiculoId:                  d.vehiculo_id,
    placa:                       d.placa,
    lat:                         d.lat,
    lng:                         d.lng,
    velocidadKmh:                d.velocidad ?? 0,
    timestamp:                   d.timestamp,
    propietario:                 d.propietario ?? '',
    tipoVehiculo:                d.tipo_vehiculo ?? 'Automóvil',
    enCampus:                    d.en_campus ?? true,
    segundosDesdeActualizacion:  0,
  }
}
