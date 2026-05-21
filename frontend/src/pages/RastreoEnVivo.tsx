/**
 * RastreoEnVivo — Telemetría vehicular en tiempo real del campus UAGRM.
 *
 * Vista para Admin/Guardia:
 *   - Mapa Leaflet con todos los vehículos activos en campus
 *   - Posición se actualiza en tiempo real via WebSocket
 *   - Tabla lateral con velocidad, propietario, tiempo desde última actualización
 *
 * Vista para Propietario:
 *   - Botón "Compartir mi ubicación" (GPS del navegador → backend)
 *   - Muestra su propia posición en el mapa
 *   - Indicador de señal GPS y velocidad estimada
 */
import { useEffect, useRef, useState } from 'react'
import { Wifi, WifiOff, Navigation, Radio, Car, Clock, MapPin } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useRastreoEnVivo } from '../hooks/useRastreoEnVivo'
import { useCompartirUbicacion } from '../hooks/useCompartirUbicacion'
import { useQuery } from '@apollo/client'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'

const CAMPUS_CENTRO: [number, number] = [-17.775488, -63.19373]

// SVG compacto para el marcador del vehículo en el mapa de rastreo
const SVG_COMPACT: Record<string, string> = {
  'Automóvil':   `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚗</div>`,
  'Motocicleta': `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🏍</div>`,
  'Camioneta':   `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚙</div>`,
  'Minibús':     `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚌</div>`,
  'Bicicleta':   `<div style="font-size:22px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🚲</div>`,
}

function MapaRastreo({ vehiculos, centro }: { vehiculos: any[]; centro: [number,number] }) {
  const mapRef    = useRef<any>(null)
  const markersRef = useRef<Record<number, any>>({})
  const divRef    = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const t = setTimeout(() => {
      if (!divRef.current || mapRef.current) return
      import('leaflet').then(L => {
        const map = L.map(divRef.current!, { center: centro, zoom: 17, zoomControl: true })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap · UAGRM Rastreo en Vivo',
          maxZoom: 19,
        }).addTo(map)
        setTimeout(() => map.invalidateSize(), 200)
        mapRef.current = map
      })
    }, 80)
    return () => { clearTimeout(t); mapRef.current?.remove(); mapRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualizar marcadores cuando llegan nuevas posiciones
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      vehiculos.forEach(v => {
        const html = SVG_COMPACT[v.tipoVehiculo] ?? SVG_COMPACT['Automóvil']
        const icon = L.divIcon({
          html: `<div>
            ${html}
            <div style="background:rgba(0,0,0,0.75);color:white;font-size:9px;font-weight:700;
              border-radius:4px;padding:1px 4px;white-space:nowrap;margin-top:-2px;text-align:center">
              ${v.placa}
            </div>
          </div>`,
          className: '', iconSize: [50, 40], iconAnchor: [25, 20],
        })

        if (markersRef.current[v.vehiculoId]) {
          markersRef.current[v.vehiculoId].setLatLng([v.lat, v.lng])
          markersRef.current[v.vehiculoId].setIcon(icon)
        } else {
          const m = L.marker([v.lat, v.lng], { icon, zIndexOffset: 800 })
            .addTo(mapRef.current)
            .bindPopup(`
              <b>${v.placa}</b> · ${v.tipoVehiculo}<br>
              ${v.propietario}<br>
              <span style="color:#16a34a">${v.velocidadKmh.toFixed(0)} km/h</span><br>
              <small>Actualizado hace ${v.segundosDesdeActualizacion}s</small>
            `)
          markersRef.current[v.vehiculoId] = m
        }
      })

      // Eliminar marcadores de vehículos que ya no están
      const idsActivos = new Set(vehiculos.map(v => v.vehiculoId))
      Object.entries(markersRef.current).forEach(([id, m]) => {
        if (!idsActivos.has(parseInt(id))) {
          m.remove()
          delete markersRef.current[parseInt(id)]
        }
      })
    })
  }, [vehiculos])

  return <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
}

export default function RastreoEnVivo() {
  const { esAdmin, esGuardia, usuario } = useAuth()
  const esPersonal = esAdmin || esGuardia

  const { vehiculos, conectado, totalEnCampus } = useRastreoEnVivo()

  // Para el propietario: seleccionar su vehículo para compartir
  const [compartirActivo, setCompartirActivo] = useState(false)
  const [vehiculoIdSel, setVehiculoSel]       = useState<number | null>(null)

  const { data: vehData } = useQuery(VEHICULOS_QUERY, {
    variables: {
      propietarioId: esPersonal ? undefined : usuario?.id,
      estado: 'activo', porPagina: 20,
    },
    skip: esPersonal,
  })
  const misVehiculos = vehData?.vehiculos?.items ?? []

  const { estado: gps } = useCompartirUbicacion(
    compartirActivo ? vehiculoIdSel : null,
    compartirActivo,
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-900">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ background: 'linear-gradient(90deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="bg-red-500 p-2 rounded-xl animate-pulse"><Radio size={18} className="text-white" /></div>
          <div>
            <h1 className="font-bold text-white text-sm">Rastreo en Vivo — Campus UAGRM</h1>
            <p className="text-blue-300 text-xs flex items-center gap-2">
              {conectado
                ? <><Wifi size={10} className="text-emerald-400" /> <span className="text-emerald-400">WebSocket conectado</span></>
                : <><WifiOff size={10} className="text-red-400" /> <span className="text-red-400">Reconectando...</span></>}
              {esPersonal && totalEnCampus > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {totalEnCampus} en campus
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Panel lateral */}
        <div className="w-72 shrink-0 bg-white overflow-y-auto border-r border-slate-200 p-4 space-y-3">

          {/* Panel Admin/Guardia */}
          {esPersonal && (
            <>
              <div className="bg-slate-800 text-white rounded-2xl p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">Campus ahora</p>
                <p className="text-3xl font-black">{totalEnCampus}</p>
                <p className="text-slate-300 text-sm">vehículos activos</p>
              </div>

              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Vehículos en campus</p>

              {vehiculos.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <Car size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Sin vehículos compartiendo ubicación</p>
                  <p className="text-xs mt-1 text-slate-300">Los vehículos aparecen cuando el propietario activa la compartición</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {vehiculos.map(v => (
                    <div key={v.vehiculoId} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-bold text-slate-800">{v.placa}</span>
                        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                          {v.velocidadKmh.toFixed(0)} km/h
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">{v.propietario}</p>
                      <p className="text-xs text-slate-400">{v.tipoVehiculo}</p>
                      <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-400">
                        <Clock size={10} />
                        {v.segundosDesdeActualizacion < 10
                          ? 'Ahora mismo'
                          : `Hace ${v.segundosDesdeActualizacion}s`}
                        <MapPin size={10} className="ml-1" />
                        {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Panel Propietario — compartir ubicación */}
          {!esPersonal && (
            <>
              <div className={`rounded-2xl p-4 border ${compartirActivo ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
                <p className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                  <Radio size={14} className={compartirActivo ? 'text-emerald-500 animate-pulse' : 'text-slate-400'} />
                  {compartirActivo ? 'Compartiendo ubicación' : 'Ubicación no compartida'}
                </p>
                {compartirActivo && gps.compartiendo && (
                  <>
                    <p className="text-xs text-emerald-600">📍 {gps.lat?.toFixed(5)}, {gps.lng?.toFixed(5)}</p>
                    <p className="text-xs text-emerald-600">⚡ {gps.velocidadKmh?.toFixed(0) ?? 0} km/h</p>
                    <p className="text-xs text-emerald-600">🎯 Precisión: ±{gps.precision?.toFixed(0) ?? '?'}m</p>
                    <p className="text-xs text-slate-400 mt-1">Actualizado: {gps.ultimaActualizacion}</p>
                  </>
                )}
                {gps.error && <p className="text-xs text-red-600 mt-1">{gps.error}</p>}
              </div>

              {!compartirActivo && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Selecciona tu vehículo</label>
                  <select value={vehiculoIdSel ?? ''}
                    onChange={e => setVehiculoSel(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
                    <option value="">Seleccionar...</option>
                    {misVehiculos.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.placa} — {v.tipo?.nombre}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={() => setCompartirActivo(a => !a)}
                disabled={!compartirActivo && !vehiculoIdSel}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-colors disabled:opacity-40 shadow-lg ${
                  compartirActivo
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
              >
                <Radio size={16} className={compartirActivo ? 'animate-pulse' : ''} />
                {compartirActivo ? 'Detener compartición' : 'Activar rastreo en vivo'}
              </button>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-semibold mb-1">¿Cómo funciona?</p>
                <p>Tu GPS se envía al sistema cada 3 segundos. El guardia y el admin pueden ver tu posición en tiempo real mientras estés en el campus.</p>
              </div>
            </>
          )}
        </div>

        {/* Mapa */}
        <div className="relative flex-1">
          <MapaRastreo vehiculos={vehiculos} centro={CAMPUS_CENTRO} />

          {/* Overlay sin vehículos (admin) */}
          {esPersonal && vehiculos.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-white/90 rounded-xl px-4 py-2 text-sm text-slate-600 shadow-md border border-slate-200 flex items-center gap-2">
              <Navigation size={14} className="text-slate-400" />
              Sin vehículos compartiendo ubicación en este momento
            </div>
          )}

          {/* Indicador conectado */}
          <div className="absolute bottom-4 right-4 z-[1000] bg-white/90 rounded-xl px-3 py-2 text-xs shadow-md border border-slate-200 flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${conectado ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-slate-600">{conectado ? 'WebSocket activo' : 'Reconectando...'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
