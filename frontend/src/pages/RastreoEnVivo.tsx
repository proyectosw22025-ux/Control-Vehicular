/**
 * RastreoEnVivo v2 — Telemetría vehicular en tiempo real, Campus UAGRM.
 *
 * Flujo automático:
 *   1. Guardia escanea QR en portería → vehículo aparece en el mapa en esa portería
 *   2. Si el propietario activa GPS → el marcador se mueve en tiempo real con trail
 *   3. Al registrar salida → vehículo desaparece del mapa y queda en el historial
 *
 * Capas del mapa:
 *   - Perímetro OSM del campus (Way 165843591, 42 nodos verificados)
 *   - Marcadores de porterías (9 PuntoAcceso con coordenadas GPS)
 *   - Vehículos: emoji + placa + badge fuente (QR/GPS)
 *   - Trail de movimiento (polyline con últimas posiciones)
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Wifi, WifiOff, Radio, Car, Clock, MapPin, Navigation, Activity, LogIn, LogOut } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useRastreoEnVivo, type VehiculoEnCampus, type EventoAcceso } from '../hooks/useRastreoEnVivo'
import { useCompartirUbicacion } from '../hooks/useCompartirUbicacion'
import { useQuery } from '@apollo/client'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'

// ── Constantes geográficas OSM verificadas ────────────────────────────────
const CAMPUS_CENTRO: [number, number] = [-17.775468, -63.196007]

const CAMPUS_PERIMETER: [number, number][] = [
  [-17.7793098,-63.1932882],[-17.7792576,-63.1933367],[-17.7792003,-63.1933659],
  [-17.7791426,-63.1933734],[-17.7790649,-63.1933689],[-17.7788301,-63.1932993],
  [-17.7785216,-63.1932072],[-17.7780892,-63.1930785],[-17.7780866,-63.1930777],
  [-17.7769272,-63.1927327],[-17.7768874,-63.1927209],[-17.7764950,-63.1926044],
  [-17.7762342,-63.1925265],[-17.7758219,-63.1924038],[-17.7755023,-63.1923071],
  [-17.7750132,-63.1921591],[-17.7751603,-63.1918238],[-17.7752126,-63.1917047],
  [-17.7753018,-63.1912720],[-17.7755238,-63.1910954],[-17.7755550,-63.1910707],
  [-17.7755827,-63.1910486],[-17.7757867,-63.1908186],[-17.7760476,-63.1906757],
  [-17.7764739,-63.1905661],[-17.7764645,-63.1905219],[-17.7765003,-63.1904663],
  [-17.7765677,-63.1905000],[-17.7765847,-63.1905128],[-17.7766889,-63.1905275],
  [-17.7776025,-63.1900856],[-17.7777751,-63.1901146],[-17.7778202,-63.1901222],
  [-17.7778519,-63.1901276],[-17.7792965,-63.1903963],[-17.7793016,-63.1909620],
  [-17.7797533,-63.1910161],[-17.7796485,-63.1914382],[-17.7796401,-63.1914776],
  [-17.7796329,-63.1915201],[-17.7795400,-63.1920671],[-17.7794861,-63.1923533],
]

// 9 porterías con coords GPS OSM verificadas
const PORTERIAS: { nombre: string; coords: [number, number]; tipo: string }[] = [
  { nombre: 'Entrada Principal',       coords: [-17.7780971, -63.1930738], tipo: 'ambos'   },
  { nombre: 'Entrada Principal Norte', coords: [-17.7762342, -63.1925265], tipo: 'entrada' },
  { nombre: 'Entrada Secundaria Sur',  coords: [-17.7796401, -63.1914776], tipo: 'entrada' },
  { nombre: 'Salida Principal Norte',  coords: [-17.7768874, -63.1927209], tipo: 'salida'  },
  { nombre: 'Salida Secundaria Sur',   coords: [-17.7796401, -63.1914776], tipo: 'salida'  },
  { nombre: 'Control Central',         coords: [-17.7778202, -63.1901222], tipo: 'ambos'   },
  { nombre: 'Portería Este',           coords: [-17.7776500, -63.1934400], tipo: 'ambos'   },
  { nombre: 'Portería Sur Central',    coords: [-17.7790100, -63.1948100], tipo: 'ambos'   },
  { nombre: 'Portería Av. Busch',      coords: [-17.7787700, -63.1966000], tipo: 'ambos'   },
]

const EMOJIS: Record<string, string> = {
  'Automóvil':   '🚗',
  'Motocicleta': '🏍️',
  'Camioneta':   '🚙',
  'Minibús':     '🚌',
  'Bicicleta':   '🚲',
}

// ── Mapa Leaflet ──────────────────────────────────────────────────────────
function MapaRastreo({
  vehiculos,
  vehiculoFoco,
  onVehiculoClick,
}: {
  vehiculos: VehiculoEnCampus[]
  vehiculoFoco: number | null
  onVehiculoClick: (id: number) => void
}) {
  const mapRef     = useRef<any>(null)
  const markersRef = useRef<Record<number, any>>({})
  const trailsRef  = useRef<Record<number, any>>({})
  const divRef     = useRef<HTMLDivElement>(null)

  // Init mapa — solo una vez
  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const t = setTimeout(() => {
      if (!divRef.current || mapRef.current) return
      import('leaflet').then(L => {
        delete (L.Icon.Default.prototype as any)._getIconUrl

        const map = L.map(divRef.current!, { center: CAMPUS_CENTRO, zoom: 17, zoomControl: true })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap · UAGRM Rastreo en Vivo',
          maxZoom: 19,
        }).addTo(map)

        // Perímetro OSM del campus
        L.polygon(CAMPUS_PERIMETER, {
          color: '#1e40af', weight: 2.5, opacity: 0.75,
          fillColor: '#3b82f6', fillOpacity: 0.05,
          dashArray: '7 4',
        }).addTo(map).bindPopup('<b>Campus UAGRM</b><br>Perímetro OSM · Way 165843591')

        // Marcadores de porterías
        PORTERIAS.forEach(p => {
          const color = p.tipo === 'entrada' ? '#16a34a' : p.tipo === 'salida' ? '#dc2626' : '#1e40af'
          const icon = L.divIcon({
            html: `<div style="background:${color};color:white;border-radius:8px;padding:2px 7px;
                     font-size:10px;font-weight:800;white-space:nowrap;
                     box-shadow:0 2px 6px rgba(0,0,0,0.45);border:2px solid white">
                     ${p.tipo === 'entrada' ? '↓' : p.tipo === 'salida' ? '↑' : '⇅'} ${p.nombre}
                   </div>`,
            className: '', iconSize: [160, 22], iconAnchor: [80, 11],
          })
          L.marker(p.coords, { icon, zIndexOffset: 200 }).addTo(map)
            .bindPopup(`<b>${p.nombre}</b><br>${p.coords[0].toFixed(5)}, ${p.coords[1].toFixed(5)}`)
        })

        setTimeout(() => map.invalidateSize(), 250)
        mapRef.current = map
      })
    }, 80)
    return () => {
      clearTimeout(t)
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualizar marcadores y trails cuando cambian los vehículos
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      const idsActivos = new Set(vehiculos.map(v => v.vehiculoId))

      vehiculos.forEach(v => {
        const emoji = EMOJIS[v.tipoVehiculo] ?? '🚗'
        const badgeColor = v.fuente === 'gps' ? '#16a34a' : '#f59e0b'
        const badgeLabel = v.fuente === 'gps' ? 'GPS' : 'QR'

        const html = `
          <div style="text-align:center;cursor:pointer">
            <div style="font-size:26px;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.6));
              animation:${v.fuente==='gps'?'none':'pulse 2s infinite'}">${emoji}</div>
            <div style="background:rgba(0,0,0,0.8);color:white;font-size:9px;font-weight:800;
              border-radius:4px;padding:1px 5px;margin-top:-3px;white-space:nowrap;
              border:1px solid rgba(255,255,255,0.3)">${v.placa}</div>
            <div style="background:${badgeColor};color:white;font-size:8px;font-weight:700;
              border-radius:3px;padding:0 4px;margin-top:1px;display:inline-block">${badgeLabel}</div>
          </div>`

        const icon = L.divIcon({
          html, className: '', iconSize: [52, 58], iconAnchor: [26, 50],
        })

        if (markersRef.current[v.vehiculoId]) {
          markersRef.current[v.vehiculoId].setLatLng([v.lat, v.lng])
          markersRef.current[v.vehiculoId].setIcon(icon)
        } else {
          const m = L.marker([v.lat, v.lng], { icon, zIndexOffset: 900 })
            .addTo(mapRef.current)
            .bindPopup(`
              <div style="min-width:160px">
                <b style="font-size:14px">${v.placa}</b>
                <p style="margin:2px 0;color:#555">${v.tipoVehiculo} · ${v.propietario}</p>
                <p style="margin:2px 0">
                  <span style="color:#16a34a;font-weight:700">${v.velocidadKmh.toFixed(0)} km/h</span>
                  · <span style="color:${badgeColor};font-weight:700">${badgeLabel} activo</span>
                </p>
                ${v.puntoAcceso ? `<p style="margin:2px 0;color:#888;font-size:11px">📍 Entró por: ${v.puntoAcceso}</p>` : ''}
              </div>
            `)
            .on('click', () => onVehiculoClick(v.vehiculoId))
          markersRef.current[v.vehiculoId] = m
        }

        // Trail de movimiento (polyline con historial de posiciones)
        if (v.historial.length > 1) {
          if (trailsRef.current[v.vehiculoId]) {
            trailsRef.current[v.vehiculoId].setLatLngs(v.historial)
          } else {
            trailsRef.current[v.vehiculoId] = L.polyline(v.historial, {
              color: v.fuente === 'gps' ? '#16a34a' : '#f59e0b',
              weight: 3, opacity: 0.6, dashArray: '5 3',
            }).addTo(mapRef.current)
          }
        }
      })

      // Eliminar marcadores y trails de vehículos que ya salieron
      Object.entries(markersRef.current).forEach(([id, m]) => {
        if (!idsActivos.has(parseInt(id))) {
          m.remove(); delete markersRef.current[parseInt(id)]
        }
      })
      Object.entries(trailsRef.current).forEach(([id, t]) => {
        if (!idsActivos.has(parseInt(id))) {
          t.remove(); delete trailsRef.current[parseInt(id)]
        }
      })
    })
  }, [vehiculos, onVehiculoClick])

  // Zoom al vehículo seleccionado
  useEffect(() => {
    if (!vehiculoFoco || !mapRef.current) return
    const v = vehiculos.find(v => v.vehiculoId === vehiculoFoco)
    if (v) mapRef.current.flyTo([v.lat, v.lng], 19, { duration: 1.2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiculoFoco])

  return <div ref={divRef} style={{ position: 'absolute', inset: 0 }} />
}

// ── Card de evento en el feed ─────────────────────────────────────────────
function EventoCard({ ev }: { ev: EventoAcceso }) {
  const hora = new Date(ev.timestamp).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-slate-100 ${ev.evento === 'entrada' ? 'bg-emerald-50/60' : 'bg-red-50/60'}`}>
      <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs ${ev.evento === 'entrada' ? 'bg-emerald-500' : 'bg-red-500'}`}>
        {ev.evento === 'entrada' ? <LogIn size={12} /> : <LogOut size={12} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-black text-slate-800 text-xs">{ev.placa}</span>
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${ev.evento === 'entrada' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {ev.evento.toUpperCase()}
          </span>
        </div>
        <p className="text-[10px] text-slate-500 truncate">{ev.puntoAcceso || '—'}</p>
        <p className="text-[9px] text-slate-400">{hora}</p>
      </div>
    </div>
  )
}

// ── Card de vehículo en campus ────────────────────────────────────────────
function VehiculoCard({ v, activo, onClick }: { v: VehiculoEnCampus; activo: boolean; onClick: () => void }) {
  const emoji = EMOJIS[v.tipoVehiculo] ?? '🚗'
  const badgeGps = v.fuente === 'gps'
  return (
    <button onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-3 transition-all ${activo ? 'border-blue-400 bg-blue-50 shadow-md' : 'border-slate-200 hover:border-slate-300 bg-white'}`}>
      <div className="flex items-center gap-2.5">
        <span className="text-2xl">{emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-mono font-black text-slate-800 text-sm">{v.placa}</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${badgeGps ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {badgeGps ? '📡 GPS' : '🔲 QR'}
            </span>
          </div>
          <p className="text-xs text-slate-500 truncate">{v.propietario}</p>
          {v.puntoAcceso && <p className="text-[10px] text-slate-400 truncate">↓ {v.puntoAcceso}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-emerald-600">{v.velocidadKmh.toFixed(0)}</p>
          <p className="text-[9px] text-slate-400">km/h</p>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-1.5 text-[9px] text-slate-400">
        <Clock size={9} />
        {v.segundosDesdeActualizacion < 5 ? 'Ahora' : `Hace ${v.segundosDesdeActualizacion}s`}
        <MapPin size={9} className="ml-1" />
        {v.lat.toFixed(4)}, {v.lng.toFixed(4)}
      </div>
    </button>
  )
}

// ── Componente principal ──────────────────────────────────────────────────
export default function RastreoEnVivo() {
  const { esAdmin, esGuardia, usuario } = useAuth()
  const esPersonal = esAdmin || esGuardia

  const { vehiculos, eventos, conectado, totalEnCampus } = useRastreoEnVivo()

  const [tab, setTab]               = useState<'vehiculos' | 'eventos'>('vehiculos')
  const [vehiculoFoco, setFoco]     = useState<number | null>(null)
  const [compartirActivo, setCompartir] = useState(false)
  const [vehiculoIdSel, setVehSel]  = useState<number | null>(null)

  const { data: vehData } = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: esPersonal ? undefined : usuario?.id, estado: 'activo', porPagina: 20 },
    skip: esPersonal,
  })
  const misVehiculos = vehData?.vehiculos?.items ?? []

  const { estado: gps } = useCompartirUbicacion(
    compartirActivo ? vehiculoIdSel : null,
    compartirActivo,
  )

  const handleVehiculoClick = useCallback((id: number) => {
    setFoco(prev => prev === id ? null : id)
  }, [])

  // Cuando llega un nuevo evento, cambiar al tab de eventos si es personal
  useEffect(() => {
    if (esPersonal && eventos.length > 0) {
      // No cambiar tab automáticamente — solo pulsar el badge
    }
  }, [eventos.length, esPersonal])

  const eventosNuevos = eventos.filter(e => {
    const diff = Date.now() - new Date(e.timestamp).getTime()
    return diff < 30_000
  }).length

  return (
    <div className="flex flex-col overflow-hidden bg-slate-900" style={{ height: '100%' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ background: 'linear-gradient(90deg,#061840 0%,#0a2a6e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="bg-red-500 p-2 rounded-xl"><Radio size={18} className="text-white animate-pulse" /></div>
          <div>
            <h1 className="font-bold text-white text-sm">Rastreo en Vivo — Campus UAGRM</h1>
            <p className="text-blue-300 text-xs flex items-center gap-2">
              {conectado
                ? <><Wifi size={10} className="text-emerald-400" /><span className="text-emerald-400">WebSocket conectado</span></>
                : <><WifiOff size={10} className="text-red-400" /><span className="text-red-400">Reconectando...</span></>}
              {esPersonal && totalEnCampus > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                  {totalEnCampus} en campus
                </span>
              )}
            </p>
          </div>
        </div>
        {esPersonal && (
          <div className="flex items-center gap-2 text-xs text-blue-200">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />GPS activo</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Solo QR</span>
          </div>
        )}
      </div>

      <div className="flex overflow-hidden" style={{ flex: 1 }}>

        {/* Panel lateral */}
        <div className="w-72 shrink-0 bg-white flex flex-col border-r border-slate-200">

          {/* Tabs — solo para admin/guardia */}
          {esPersonal && (
            <div className="flex border-b border-slate-200 shrink-0">
              {([
                { id: 'vehiculos', label: 'Vehículos', icon: Car, count: totalEnCampus },
                { id: 'eventos',   label: 'Eventos',   icon: Activity, count: eventosNuevos },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors border-b-2 ${tab === t.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                  <t.icon size={13} />
                  {t.label}
                  {t.count > 0 && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">

            {/* ── TAB VEHÍCULOS (admin/guardia) ── */}
            {esPersonal && tab === 'vehiculos' && (
              <div className="p-3 space-y-3">
                {/* Estadísticas */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-slate-800 text-white rounded-xl p-3 text-center">
                    <p className="text-2xl font-black">{totalEnCampus}</p>
                    <p className="text-[10px] text-slate-400">En campus</p>
                  </div>
                  <div className="bg-emerald-800 text-white rounded-xl p-3 text-center">
                    <p className="text-2xl font-black">{vehiculos.filter(v => v.fuente === 'gps').length}</p>
                    <p className="text-[10px] text-emerald-300">Con GPS</p>
                  </div>
                </div>

                {vehiculos.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <Car size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Sin vehículos en campus</p>
                    <p className="text-xs mt-1 text-slate-300">Aparecen al escanear QR en portería</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {vehiculos.map(v => (
                      <VehiculoCard key={v.vehiculoId} v={v}
                        activo={vehiculoFoco === v.vehiculoId}
                        onClick={() => handleVehiculoClick(v.vehiculoId)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── TAB EVENTOS (admin/guardia) ── */}
            {esPersonal && tab === 'eventos' && (
              <div>
                {eventos.length === 0 ? (
                  <div className="text-center py-10 text-slate-400 px-4">
                    <Activity size={32} className="mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Sin eventos registrados</p>
                    <p className="text-xs mt-1">Los accesos QR aparecen aquí en tiempo real</p>
                  </div>
                ) : (
                  eventos.map(ev => <EventoCard key={ev.id} ev={ev} />)
                )}
              </div>
            )}

            {/* ── PANEL PROPIETARIO ── */}
            {!esPersonal && (
              <div className="p-4 space-y-3">
                <div className={`rounded-2xl p-4 border ${compartirActivo ? 'bg-emerald-50 border-emerald-300' : 'bg-slate-50 border-slate-200'}`}>
                  <p className="font-bold text-slate-800 text-sm mb-1 flex items-center gap-2">
                    <Radio size={14} className={compartirActivo ? 'text-emerald-500 animate-pulse' : 'text-slate-400'} />
                    {compartirActivo ? 'Compartiendo GPS' : 'GPS no compartido'}
                  </p>
                  {compartirActivo && gps.compartiendo && (
                    <>
                      <p className="text-xs text-emerald-600">📍 {gps.lat?.toFixed(5)}, {gps.lng?.toFixed(5)}</p>
                      <p className="text-xs text-emerald-600">⚡ {gps.velocidadKmh?.toFixed(0) ?? 0} km/h</p>
                      <p className="text-xs text-emerald-600">🎯 ±{gps.precision?.toFixed(0) ?? '?'}m precisión</p>
                      <p className="text-xs text-slate-400 mt-1">{gps.ultimaActualizacion}</p>
                    </>
                  )}
                  {gps.error && <p className="text-xs text-red-600 mt-1">{gps.error}</p>}
                </div>

                {!compartirActivo && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Tu vehículo</label>
                    <select value={vehiculoIdSel ?? ''}
                      onChange={e => setVehSel(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
                      <option value="">Seleccionar...</option>
                      {misVehiculos.map((v: any) => (
                        <option key={v.id} value={v.id}>{v.placa} — {v.tipo?.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={() => setCompartir(a => !a)}
                  disabled={!compartirActivo && !vehiculoIdSel}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-colors disabled:opacity-40 shadow-lg ${
                    compartirActivo ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}>
                  <Radio size={16} className={compartirActivo ? 'animate-pulse' : ''} />
                  {compartirActivo ? 'Detener GPS' : 'Compartir mi ubicación'}
                </button>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold">¿Cómo funciona?</p>
                  <p>• Al escanear tu QR en portería, apareces en el mapa automáticamente.</p>
                  <p>• Activa el GPS para que el guardia vea tu posición exacta en tiempo real.</p>
                  <p>• Tu posición se envía cada 3 segundos mientras estés en el campus.</p>
                </div>

                {/* Mis accesos recientes en el feed */}
                {eventos.filter(e => e.vehiculoId === vehiculoIdSel).slice(0, 5).map(ev => (
                  <EventoCard key={ev.id} ev={ev} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mapa */}
        <div className="relative flex-1">
          <MapaRastreo
            vehiculos={vehiculos}
            vehiculoFoco={vehiculoFoco}
            onVehiculoClick={handleVehiculoClick}
          />

          {/* Overlay sin vehículos (admin/guardia) */}
          {esPersonal && vehiculos.length === 0 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-white/95 rounded-xl px-4 py-2 text-sm text-slate-600 shadow-md border border-slate-200 flex items-center gap-2">
              <Navigation size={14} className="text-slate-400" />
              Sin vehículos en campus — esperando escaneos QR
            </div>
          )}

          {/* Notificación de evento nuevo (últimos 10s) */}
          {esPersonal && eventos[0] && Date.now() - new Date(eventos[0].timestamp).getTime() < 10_000 && (
            <div className={`absolute bottom-12 left-1/2 -translate-x-1/2 z-[1000]
              rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-sm shadow-xl text-white
              ${eventos[0].evento === 'entrada' ? 'bg-emerald-600' : 'bg-red-600'}`}>
              {eventos[0].evento === 'entrada' ? <LogIn size={16} /> : <LogOut size={16} />}
              <span>
                <strong>{eventos[0].placa}</strong>{' '}
                {eventos[0].evento === 'entrada' ? 'entró por' : 'salió por'}{' '}
                <strong>{eventos[0].puntoAcceso}</strong>
              </span>
            </div>
          )}

          {/* Indicador de conexión */}
          <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 rounded-xl px-3 py-2 text-xs shadow-md border border-slate-200 flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${conectado ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-slate-600">{conectado ? 'WebSocket activo' : 'Reconectando...'}</span>
          </div>

          {/* Foco activo — instrucción */}
          {vehiculoFoco && (
            <div className="absolute top-3 right-4 z-[1000] bg-blue-600 text-white rounded-xl px-3 py-1.5 text-xs shadow-md">
              Siguiendo: {vehiculos.find(v => v.vehiculoId === vehiculoFoco)?.placa ?? '—'}
              <button onClick={() => setFoco(null)} className="ml-2 opacity-70 hover:opacity-100">✕</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
