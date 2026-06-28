/**
 * Hook de telemetría — recibe posiciones GPS y eventos de acceso en tiempo real.
 *
 * Fuentes de posición:
 *   'qr'  → el guardia escaneó el QR en una portería (posición exacta de la portería)
 *   'gps' → el propietario activó GPS sharing (posición real del dispositivo)
 *
 * Grupos WebSocket:
 *   rastreo_campus       → Admin/Guardia: ven todos los vehículos
 *   rastreo_usuario_<id> → Propietario: ve solo el suyo
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { wsUrl } from '../config/endpoints'

export interface VehiculoEnCampus {
  vehiculoId:                 number
  placa:                      string
  lat:                        number
  lng:                        number
  velocidadKmh:               number
  timestamp:                  string
  propietario:                string
  tipoVehiculo:               string
  enCampus:                   boolean
  segundosDesdeActualizacion: number
  puntoAcceso:                string   // portería de ingreso
  fuente:                     'qr' | 'gps'
  historial:                  [number, number][]  // trail de posiciones recientes
}

export interface EventoAcceso {
  id:           string
  vehiculoId:   number
  placa:        string
  propietario:  string
  tipoVehiculo: string
  evento:       'entrada' | 'salida'
  puntoAcceso:  string
  timestamp:    string
  lat:          number | null
  lng:          number | null
}

const MAX_HISTORIAL = 30   // máximo de posiciones en el trail por vehículo
const MAX_EVENTOS   = 50   // máximo de eventos en el feed

export function useRastreoEnVivo() {
  const [vehiculos, setVehiculos] = useState<VehiculoEnCampus[]>([])
  const [eventos,   setEventos]   = useState<EventoAcceso[]>([])
  const [conectado, setConectado] = useState(false)
  const [intento,   setIntento]   = useState(0)
  const wsRef    = useRef<WebSocket | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Actualiza el contador de "hace Xs" cada 5 segundos
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
    const token = localStorage.getItem('access_token') ?? ''

    // URL del WebSocket de rastreo (mismo origen en producción).
    const url = `${wsUrl('/ws/rastreo/')}?token=${token}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    let pingInterval: ReturnType<typeof setInterval> | null = null

    ws.onopen = () => {
      setConectado(true)
      setIntento(0)
      // Heartbeat cliente→servidor cada 20s: responde al ping del servidor
      // y envía pings propios para mantener la conexión activa en Railway
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ accion: 'pong' }))
        }
      }, 20_000)
    }

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.tipo === 'ping') {
          // El servidor mandó ping — responder con pong
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ accion: 'pong' }))
          return
        }

        // ── Estado inicial al conectar ────────────────────────────────────
        if (data.tipo === 'conectado' && Array.isArray(data.ubicaciones_actuales)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setVehiculos(data.ubicaciones_actuales.map((d: any) => mapearVehiculo(d, 'gps')))
        }

        // ── Posición GPS actualizada (propietario compartiendo) ───────────
        if (data.tipo === 'ubicacion') {
          setVehiculos(prev => actualizarVehiculo(prev, {
            vehiculo_id:   data.vehiculo_id,
            placa:         data.placa,
            lat:           data.lat,
            lng:           data.lng,
            velocidad:     data.velocidad,
            timestamp:     data.timestamp,
            propietario:   data.propietario,
            tipo_vehiculo: data.tipo_vehiculo,
            en_campus:     data.en_campus,
            punto_acceso:  data.punto_acceso ?? '',
            fuente:        'gps',
          }))
        }

        // ── Evento de acceso QR (entrada o salida registrada por guardia) ──
        if (data.tipo === 'evento_acceso') {
          const nuevo: EventoAcceso = {
            id:           `${data.vehiculo_id}-${data.timestamp}`,
            vehiculoId:   data.vehiculo_id,
            placa:        data.placa,
            propietario:  data.propietario ?? '',
            tipoVehiculo: data.tipo_vehiculo ?? 'Automóvil',
            evento:       data.evento,
            puntoAcceso:  data.punto_acceso ?? '',
            timestamp:    data.timestamp,
            lat:          data.lat ?? null,
            lng:          data.lng ?? null,
          }
          setEventos(prev => [nuevo, ...prev].slice(0, MAX_EVENTOS))

          if (data.evento === 'entrada' && data.lat != null) {
            setVehiculos(prev => actualizarVehiculo(prev, {
              vehiculo_id:   data.vehiculo_id,
              placa:         data.placa,
              lat:           data.lat,
              lng:           data.lng,
              velocidad:     0,
              timestamp:     data.timestamp,
              propietario:   data.propietario ?? '',
              tipo_vehiculo: data.tipo_vehiculo ?? 'Automóvil',
              en_campus:     true,
              punto_acceso:  data.punto_acceso ?? '',
              fuente:        'qr',
            }))
          }

          if (data.evento === 'salida') {
            setVehiculos(prev => prev.filter(v => v.vehiculoId !== data.vehiculo_id))
          }
        }

        // ── Vehículo salió (delete explícito desde rastreo REST) ──────────
        if (data.tipo === 'vehiculo_salio') {
          setVehiculos(prev => prev.filter(v => v.vehiculoId !== data.vehiculo_id))
        }

      } catch { /* ignorar mensajes malformados */ }
    }

    ws.onclose = (e) => {
      if (pingInterval) clearInterval(pingInterval)
      setConectado(false)
      // 4001 = no autenticado, 4002 = error de servidor permanente → no reconectar
      if (e.code !== 4001 && e.code !== 4002) {
        const delay = Math.min(3000 * Math.pow(2, intento), 30_000)
        setTimeout(() => setIntento(n => n + 1), delay)
      }
    }
  }, [intento])

  useEffect(() => {
    conectar()
    return () => { wsRef.current?.close() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento])

  const vehiculosActivos = vehiculos.filter(v => v.enCampus)
  return {
    vehiculos: vehiculosActivos,
    eventos,
    conectado,
    totalEnCampus: vehiculosActivos.length,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function mapearVehiculo(d: any, fuente: 'qr' | 'gps'): VehiculoEnCampus {
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
    puntoAcceso:                 d.punto_acceso ?? '',
    fuente:                      d.fuente ?? fuente,
    historial:                   [[d.lat, d.lng]],
  }
}

function actualizarVehiculo(
  prev: VehiculoEnCampus[],
  d: {
    vehiculo_id: number; placa: string; lat: number; lng: number;
    velocidad: number; timestamp: string; propietario: string;
    tipo_vehiculo: string; en_campus: boolean;
    punto_acceso: string; fuente: 'qr' | 'gps'
  }
): VehiculoEnCampus[] {
  const idx = prev.findIndex(v => v.vehiculoId === d.vehiculo_id)
  const nuevo: VehiculoEnCampus = {
    vehiculoId:                 d.vehiculo_id,
    placa:                      d.placa,
    lat:                        d.lat,
    lng:                        d.lng,
    velocidadKmh:               d.velocidad ?? 0,
    timestamp:                  d.timestamp,
    propietario:                d.propietario,
    tipoVehiculo:               d.tipo_vehiculo,
    enCampus:                   d.en_campus ?? true,
    segundosDesdeActualizacion: 0,
    puntoAcceso:                d.punto_acceso,
    fuente:                     d.fuente,
    historial: idx >= 0
      ? [[d.lat, d.lng], ...prev[idx].historial].slice(0, MAX_HISTORIAL) as [number,number][]
      : [[d.lat, d.lng]],
  }
  if (idx >= 0) {
    const arr = [...prev]; arr[idx] = nuevo; return arr
  }
  return [...prev, nuevo]
}
