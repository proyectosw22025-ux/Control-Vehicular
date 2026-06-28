/**
 * Hook de telemetría GPS — propietario comparte su posición en tiempo real.
 *
 * Usa la Geolocation API del navegador (watchPosition) para obtener coordenadas
 * continuas y las envía al backend cada vez que cambia la posición (máx cada 3s).
 * El backend las persiste y las distribuye via WebSocket a Admin/Guardia.
 *
 * Requisitos del dispositivo:
 *   - HTTPS (obligatorio para Geolocation API en producción)
 *   - Permiso de ubicación concedido por el usuario
 *   - GPS activo (enableHighAccuracy: true)
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE as BASE_URL } from '../config/endpoints'

export interface EstadoCompartir {
  compartiendo: boolean
  error: string
  lat: number | null
  lng: number | null
  velocidadKmh: number | null
  precision: number | null      // metros de precisión GPS
  ultimaActualizacion: string | null
}

export function useCompartirUbicacion(vehiculoId: number | null, activo: boolean) {
  const [estado, setEstado] = useState<EstadoCompartir>({
    compartiendo: false, error: '', lat: null, lng: null,
    velocidadKmh: null, precision: null, ultimaActualizacion: null,
  })

  const watchIdRef  = useRef<number | null>(null)
  const ultimoEnvio = useRef<number>(0)
  const MIN_INTERVALO_MS = 3000  // no enviar más de 1 vez cada 3 segundos

  const enviarPosicion = useCallback(async (coords: GeolocationCoordinates) => {
    if (!vehiculoId) return
    const ahora = Date.now()
    if (ahora - ultimoEnvio.current < MIN_INTERVALO_MS) return
    ultimoEnvio.current = ahora

    const velocidadKmh = coords.speed != null ? coords.speed * 3.6 : 0
    try {
      const token = localStorage.getItem('access_token') ?? ''
      await fetch(`${BASE_URL}/api/rastreo/ubicacion/`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehiculo_id: vehiculoId,
          lat:         coords.latitude,
          lng:         coords.longitude,
          velocidad:   velocidadKmh,
        }),
        signal: AbortSignal.timeout(5000),
      })
      setEstado(e => ({
        ...e,
        compartiendo:         true,
        error:                '',
        lat:                  coords.latitude,
        lng:                  coords.longitude,
        velocidadKmh,
        precision:            coords.accuracy,
        ultimaActualizacion:  new Date().toLocaleTimeString('es-BO'),
      }))
    } catch {
      // Silencioso — puede fallar si hay corte de red momentáneo
      setEstado(e => ({ ...e, error: 'Sin conexión — reintentando...' }))
    }
  }, [vehiculoId])

  const detenerCompartir = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setEstado(e => ({ ...e, compartiendo: false }))
    // Notificar al backend que el vehículo dejó de compartir
    if (vehiculoId) {
      try {
        const token = localStorage.getItem('access_token') ?? ''
        await fetch(`${BASE_URL}/api/rastreo/ubicacion/${vehiculoId}/`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        })
      } catch { /* ignorar */ }
    }
  }, [vehiculoId])

  useEffect(() => {
    if (!activo || !vehiculoId) {
      if (watchIdRef.current !== null) detenerCompartir()
      return
    }

    if (!('geolocation' in navigator)) {
      setEstado(e => ({ ...e, error: 'GPS no disponible en este navegador' }))
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => enviarPosicion(pos.coords),
      (err) => {
        const msgs: Record<number, string> = {
          1: 'Permiso de ubicación denegado — actívalo en la configuración del navegador',
          2: 'Señal GPS débil — muévete a un lugar con mejor cobertura',
          3: 'Tiempo de espera del GPS agotado — reintentando',
        }
        setEstado(e => ({ ...e, error: msgs[err.code] ?? err.message }))
      },
      {
        enableHighAccuracy: true,
        timeout:            10_000,
        maximumAge:         2_000,   // usar caché de hasta 2s
      }
    )

    return () => { if (watchIdRef.current !== null) detenerCompartir() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo, vehiculoId])

  return { estado, detenerCompartir }
}
