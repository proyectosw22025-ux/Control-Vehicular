/**
 * ParqueoDemo v4 — Guía de parqueo con mapa REAL del campus UAGRM.
 *
 * Solución definitiva para coordenadas:
 *   - Modo ⚙ Configurar Zonas: el admin hace clic en el mapa real
 *     para posicionar cada zona P exactamente donde aparece en el campus.
 *   - Las posiciones se guardan en localStorage y persisten entre sesiones.
 *   - Al abrir, el mapa se centra automáticamente en la UAGRM vía Nominatim.
 *   - Routing real por calles via OSRM (sin API key).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import {
  Navigation, RotateCcw, CheckCircle2, XCircle, Clock,
  Car, Wifi, Loader2, Settings, MapPin, Save, X,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ZONAS_QUERY, ESPACIOS_POR_ZONA_QUERY } from '../graphql/queries/parqueos'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { INICIAR_SESION_MUTATION } from '../graphql/mutations/parqueos'

// ── Zonas con posiciones por defecto (se sobreescriben desde localStorage) ─
const ZONAS_DEFAULT = [
  {
    id: 'A', nombre: 'Zona A', sub: 'Bloque Norte (Módulo 250)',
    // Ajustar desde el modo ⚙ Configurar
    coords: [-17.7878, -63.1845] as [number, number],
    color: '#3b82f6', libres: 12, total: 40,
    roles: 'Docentes / Administrativos',
  },
  {
    id: 'B', nombre: 'Zona B', sub: 'Bloque Central (La Poza)',
    coords: [-17.7908, -63.1878] as [number, number],
    color: '#22c55e', libres: 25, total: 80,
    roles: 'Todos los usuarios',
  },
  {
    id: 'C', nombre: 'Zona C', sub: 'Bloque Sur (Fac. Politécnica)',
    coords: [-17.7938, -63.1855] as [number, number],
    color: '#f59e0b', libres: 8, total: 50,
    roles: 'Todos los usuarios',
  },
] as const

type Zona = { id: string; nombre: string; sub: string; coords: [number,number]; color: string; libres: number; total: number; roles: string }

const LS_KEY = 'uagrm_zonas_coords_v1'

function cargarZonas(): Zona[] {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (!saved) return ZONAS_DEFAULT.map(z => ({ ...z }))
    const parsed = JSON.parse(saved) as Record<string, [number,number]>
    return ZONAS_DEFAULT.map(z => ({
      ...z,
      coords: parsed[z.id] ?? z.coords,
    }))
  } catch { return ZONAS_DEFAULT.map(z => ({ ...z })) }
}

function guardarZonas(zonas: Zona[]) {
  const obj: Record<string, [number,number]> = {}
  zonas.forEach(z => { obj[z.id] = z.coords })
  localStorage.setItem(LS_KEY, JSON.stringify(obj))
}

// ── OSRM — routing real por calles (sin API key) ─────────────────────────
async function obtenerRutaOSRM(
  entrada: [number,number],
  destino: [number,number],
): Promise<{ puntos: [number,number][]; duracionSeg: number | null }> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${entrada[1]},${entrada[0]};${destino[1]},${destino[0]}` +
    `?geometries=geojson&overview=full&steps=false`
  try {
    const resp  = await fetch(url, { signal: AbortSignal.timeout(6000) })
    const data  = await resp.json()
    const ruta  = data?.routes?.[0]
    if (data.code === 'Ok' && ruta?.geometry?.coordinates?.length) {
      return {
        puntos: ruta.geometry.coordinates.map(
          ([lng, lat]: [number,number]) => [lat, lng] as [number,number]
        ),
        duracionSeg: Math.round(ruta.duration),
      }
    }
  } catch { /* fallback */ }
  // Fallback lineal
  return {
    puntos: Array.from({ length: 61 }, (_, i) => [
      entrada[0] + (destino[0] - entrada[0]) * i / 60,
      entrada[1] + (destino[1] - entrada[1]) * i / 60,
    ] as [number,number]),
    duracionSeg: null,
  }
}

type FlowState = 'inicio' | 'cargando_ruta' | 'en_ruta' | 'confirmando' | 'parqueado' | 'completado'
type ConfigZona = 'A' | 'B' | 'C' | null

// ── Mapa Leaflet ─────────────────────────────────────────────────────────
function MapaLeaflet({
  zonas, entrada, zonaDestino, flowState, rutaPuntos,
  modoConfig, zonaConfig,
  onZonaClick, onLlegada, onMapClick,
}: {
  zonas:       Zona[]
  entrada:     [number,number]
  zonaDestino: Zona | null
  flowState:   FlowState
  rutaPuntos:  [number,number][]
  modoConfig:  boolean
  zonaConfig:  ConfigZona
  onZonaClick: (z: Zona) => void
  onLlegada:   () => void
  onMapClick:  (lat: number, lng: number) => void
}) {
  const mapRef     = useRef<any>(null)
  const vehicleRef = useRef<any>(null)
  const lineaRef   = useRef<any>(null)
  const zonaMarksRef = useRef<Record<string, any>>({})
  const animRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const divRef     = useRef<HTMLDivElement>(null)

  // Inicializar mapa + Nominatim para centrar en UAGRM real
  useEffect(() => {
    if (mapRef.current || !divRef.current) return

    const t = setTimeout(() => {
      if (!divRef.current || mapRef.current) return

      import('leaflet').then(async L => {
        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        // Centro inicial estimado mientras Nominatim responde
        const map = L.map(divRef.current!, { center: [-17.791, -63.185], zoom: 16, zoomControl: true })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap · © UAGRM Santa Cruz',
          maxZoom: 19,
        }).addTo(map)
        setTimeout(() => map.invalidateSize(), 200)

        // Nominatim: busca la UAGRM y centra el mapa exactamente
        try {
          const r = await fetch(
            'https://nominatim.openstreetmap.org/search' +
            '?q=Universidad+Aut%C3%B3noma+Gabriel+Ren%C3%A9+Moreno+Santa+Cruz+Bolivia' +
            '&format=json&limit=1&addressdetails=0',
            { headers: { 'Accept-Language': 'es' } }
          )
          const [res] = await r.json()
          if (res) {
            const lat = parseFloat(res.lat)
            const lon = parseFloat(res.lon)
            map.setView([lat, lon], 16)
          }
        } catch { /* usa el centro inicial */ }

        // Marcador de entrada
        const iconEntrada = L.divIcon({
          html: `<div style="background:#1e40af;color:white;border-radius:50%;width:40px;height:40px;
                   display:flex;align-items:center;justify-content:center;font-size:20px;
                   border:3px solid white;box-shadow:0 3px 12px rgba(0,0,0,0.5)">🏫</div>`,
          className: '', iconSize: [40,40], iconAnchor: [20,20],
        })
        L.marker(entrada, { icon: iconEntrada })
          .addTo(map)
          .bindPopup('<b>Entrada Principal — Av. Busch</b><br>Control de acceso QR')

        // Vehículo
        const iconCar = L.divIcon({
          html: `<div style="font-size:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6))">🚗</div>`,
          className: '', iconSize: [32,32], iconAnchor: [16,16],
        })
        vehicleRef.current = L.marker(entrada, { icon: iconCar, zIndexOffset: 1000 }).addTo(map)

        // Click en el mapa (modo configuración)
        map.on('click', (e: any) => {
          onMapClick(e.latlng.lat, e.latlng.lng)
        })

        mapRef.current = map

        // Dibujar marcadores de zonas
        dibujarZonas(L, map, zonas, zonaMarksRef, onZonaClick)
      })
    }, 80)

    return () => {
      clearTimeout(t)
      if (animRef.current) clearInterval(animRef.current)
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redibujar zonas cuando cambien (modo config las mueve)
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      // Remover marcadores anteriores
      Object.values(zonaMarksRef.current).forEach((m: any) => m.remove())
      zonaMarksRef.current = {}
      dibujarZonas(L, mapRef.current, zonas, zonaMarksRef, onZonaClick)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonas])

  // Cursor de configuración
  useEffect(() => {
    if (!mapRef.current) return
    const c = mapRef.current.getContainer()
    if (modoConfig && zonaConfig) {
      c.style.cursor = 'crosshair'
    } else {
      c.style.cursor = ''
    }
  }, [modoConfig, zonaConfig])

  // Animar ruta
  useEffect(() => {
    if (!rutaPuntos.length || flowState !== 'en_ruta' || !mapRef.current || !vehicleRef.current) return
    import('leaflet').then(L => {
      if (lineaRef.current) { lineaRef.current.remove(); lineaRef.current = null }
      if (animRef.current)  { clearInterval(animRef.current); animRef.current = null }

      lineaRef.current = L.polyline(rutaPuntos, {
        color: zonaDestino?.color ?? '#3b82f6', weight: 5, opacity: 0.85, dashArray: '12 6',
      }).addTo(mapRef.current)

      if (zonaDestino) {
        mapRef.current.flyToBounds(
          L.latLngBounds([entrada, zonaDestino.coords]),
          { padding: [60,60], duration: 1.2, maxZoom: 17 }
        )
      }

      let idx = 0
      const paso = Math.max(1, Math.floor(rutaPuntos.length / 80))
      animRef.current = setInterval(() => {
        if (idx >= rutaPuntos.length) {
          clearInterval(animRef.current!)
          if (zonaDestino) mapRef.current?.flyTo(zonaDestino.coords, 18, { duration: 1 })
          onLlegada()
          return
        }
        vehicleRef.current?.setLatLng(rutaPuntos[idx])
        idx += paso
      }, 60)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaPuntos, flowState])

  return (
    <div ref={divRef} style={{ position: 'absolute', inset: 0, minHeight: 400 }} />
  )
}

function dibujarZonas(
  L: any, map: any, zonas: Zona[],
  marksRef: React.MutableRefObject<Record<string, any>>,
  onZonaClick: (z: Zona) => void,
) {
  zonas.forEach(zona => {
    const icon = L.divIcon({
      html: `<div style="background:${zona.color};color:white;border-radius:12px;
               padding:5px 10px;font-weight:900;font-size:12px;cursor:pointer;
               box-shadow:0 3px 12px rgba(0,0,0,0.4);white-space:nowrap;
               border:2px solid rgba(255,255,255,0.9)">
               🅿 Zona ${zona.id} · ${zona.libres} libres
             </div>`,
      className: '', iconSize: [130,30], iconAnchor: [65,15],
    })
    const marker = L.marker(zona.coords, { icon, zIndexOffset: 500 })
      .addTo(map)
      .on('click', () => onZonaClick(zona))
      .bindPopup(`<b>${zona.nombre}</b><br>${zona.sub}<br>
                  <span style="color:green">${zona.libres} libres</span><br>
                  <small>${zona.roles}</small>`)
    marksRef.current[zona.id] = marker
  })
}

// ── Componente principal ───────────────────────────────────────────────────
export default function ParqueoDemo() {
  const { esAdmin } = useAuth()
  const navigate    = useNavigate()

  const [zonas, setZonas]         = useState<Zona[]>(cargarZonas)
  const [entrada]                 = useState<[number,number]>([-17.7858, -63.1848])
  const [flow, setFlow]           = useState<FlowState>('inicio')
  const [zonaDestino, setZonaD]   = useState<Zona | null>(null)
  const [rutaPuntos, setRuta]     = useState<[number,number][]>([])
  const [vehiculoSelId, setVehId] = useState<number | null>(null)
  const [segundos, setSegundos]   = useState(0)
  const [horaEntrada, setHoraE]   = useState('')
  const [horaSalida, setHoraS]    = useState('')
  const [msg, setMsg]             = useState('')
  const [tiempoRuta, setTiempoR]  = useState<number | null>(null)

  // ── Modo configuración ────────────────────────────────────────────────
  const [modoConfig, setModoConfig] = useState(false)
  const [zonaConfig, setZonaConfig] = useState<ConfigZona>(null)
  const [zonasTmp, setZonasTmp]     = useState<Zona[]>([])
  const [guardado, setGuardado]     = useState(false)

  function entrarConfig() {
    setModoConfig(true)
    setZonasTmp(zonas.map(z => ({ ...z })))
    setZonaConfig('A')
  }

  function salirConfig(guardar: boolean) {
    if (guardar) {
      guardarZonas(zonasTmp)
      setZonas(zonasTmp)
      setGuardado(true)
      setTimeout(() => setGuardado(false), 3000)
    }
    setModoConfig(false)
    setZonaConfig(null)
  }

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (!modoConfig || !zonaConfig) return
    setZonasTmp(prev => prev.map(z =>
      z.id === zonaConfig ? { ...z, coords: [lat, lng] as [number,number] } : z
    ))
    // Avanzar automáticamente a la siguiente zona
    const ids = ['A','B','C']
    const idx = ids.indexOf(zonaConfig)
    setZonaConfig(idx < ids.length - 1 ? ids[idx+1] as ConfigZona : null)
  }, [modoConfig, zonaConfig])

  // ── Queries ───────────────────────────────────────────────────────────
  const { data: zonasData } = useQuery(ZONAS_QUERY, { variables: { soloActivas: true } })
  const { data: vehData }   = useQuery(VEHICULOS_QUERY, { variables: { estado: 'activo', porPagina: 50 } })
  const { data: espData }   = useQuery(ESPACIOS_POR_ZONA_QUERY, {
    variables: { zonaId: (() => {
      if (!zonaDestino || !zonasData?.zonas?.length) return null
      const z = (zonasData.zonas as any[]).find(z =>
        z.nombre.includes(`Zona ${zonaDestino.id}`) || z.nombre.toLowerCase().includes('bloque')
      )
      return z?.id ?? zonasData.zonas[0]?.id ?? null
    })() },
    skip: !zonaDestino || !zonasData,
    fetchPolicy: 'network-only',
  })

  const [iniciarSesion, { loading: lSesion }] = useMutation(INICIAR_SESION_MUTATION, {
    onCompleted(d) {
      const s = d.iniciarSesionParqueo
      setFlow('parqueado'); setSegundos(0)
      setMsg(`✅ ${s.placaVehiculo} → #${s.espacio.numero} — ${s.espacio.zona.nombre}`)
    },
    onError(e) { setMsg(`❌ ${e.message}`) },
  })

  const vehiculos  = vehData?.vehiculos?.items ?? []
  const primerEsp  = (espData?.espaciosPorZona ?? []).find((e: any) => e.estado === 'disponible')
  const vehSel     = vehiculos.find((v: any) => v.id === vehiculoSelId)

  useEffect(() => {
    if (flow !== 'parqueado') return
    const t = setInterval(() => setSegundos(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [flow])

  const handleZonaClick = useCallback(async (zona: Zona) => {
    if (modoConfig) return // en modo config el click va al mapa
    if (flow === 'confirmando' || flow === 'parqueado' || flow === 'completado') return
    if (!horaEntrada) setHoraE(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    setZonaD(zona); setFlow('cargando_ruta'); setRuta([]); setTiempoR(null)

    const { puntos, duracionSeg } = await obtenerRutaOSRM(entrada, zona.coords)
    setTiempoR(duracionSeg)
    setRuta(puntos)
    setFlow('en_ruta')
  }, [flow, horaEntrada, modoConfig, entrada])

  const handleLlegada = useCallback(() => setFlow('confirmando'), [])

  function confirmar() {
    if (!vehiculoSelId || !primerEsp) { setMsg('Selecciona tu vehículo'); return }
    iniciarSesion({ variables: { input: { espacioId: primerEsp.id, vehiculoId: vehiculoSelId } } })
  }

  function simularSalida() {
    setHoraS(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    setFlow('completado')
  }

  function reiniciar() {
    setFlow('inicio'); setZonaD(null); setRuta([]); setVehId(null)
    setSegundos(0); setHoraE(''); setHoraS(''); setMsg(''); setTiempoR(null)
  }

  const min = Math.floor(segundos / 60)
  const sec = segundos % 60
  const zonasActivas = modoConfig ? zonasTmp : zonas

  return (
    <div className="flex flex-col bg-slate-900 overflow-hidden" style={{ height: '100%' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ background: 'linear-gradient(90deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-xl"><Navigation size={18} /></div>
          <div>
            <h1 className="font-bold text-white text-sm">Guía de Parqueo — Campus UAGRM</h1>
            <p className="text-blue-300 text-xs flex items-center gap-2">
              <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse">DEMO</span>
              <Wifi size={10} /> OpenStreetMap + OSRM · Santa Cruz, Bolivia
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {guardado && <span className="text-xs text-emerald-400 font-medium">✓ Zonas guardadas</span>}
          {!modoConfig && esAdmin && (
            <button onClick={entrarConfig}
              className="flex items-center gap-1 text-xs text-amber-300 hover:text-white border border-amber-600 px-3 py-1.5 rounded-lg transition-colors">
              <Settings size={12} /> Configurar zonas
            </button>
          )}
          <button onClick={() => navigate('/parqueos')}
            className="text-xs text-blue-300 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg">
            Parqueos →
          </button>
          <button onClick={reiniciar}
            className="flex items-center gap-1 text-xs text-blue-200 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg">
            <RotateCcw size={12} /> Reiniciar
          </button>
        </div>
      </div>

      <div className="flex overflow-hidden" style={{ flex: 1 }}>

        {/* Panel lateral */}
        <div className="w-72 shrink-0 bg-white overflow-y-auto border-r border-slate-200 p-4 space-y-3">

          {/* ── MODO CONFIGURACIÓN ─────────────────────────────────── */}
          {modoConfig ? (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
                <p className="font-bold text-amber-800 text-sm flex items-center gap-2">
                  <Settings size={14} /> Configurar Zonas de Parqueo
                </p>
                <p className="text-xs text-amber-700 mt-1">
                  Haz clic en el mapa <strong>exactamente donde está el parqueo P</strong> del campus UAGRM.
                </p>
              </div>

              {/* Selector de zona a configurar */}
              <div className="space-y-2">
                {(['A','B','C'] as const).map(id => {
                  const z = zonasTmp.find(z => z.id === id)!
                  const activa = zonaConfig === id
                  return (
                    <button key={id} onClick={() => setZonaConfig(id)}
                      className={`w-full text-left rounded-xl p-3 border-2 transition-all ${
                        activa ? 'border-current shadow-md' : 'border-slate-200 hover:border-slate-300'
                      }`}
                      style={{ borderColor: activa ? z.color : undefined, background: activa ? z.color + '15' : undefined }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                          style={{ background: z.color }}>{id}</div>
                        <div className="flex-1">
                          <p className="font-semibold text-slate-800 text-xs">{z.nombre}</p>
                          <p className="text-[10px] text-slate-500">
                            {activa ? '👆 Toca en el mapa para posicionar' : `${z.coords[0].toFixed(4)}, ${z.coords[1].toFixed(4)}`}
                          </p>
                        </div>
                        {activa && <span className="text-xs bg-amber-400 text-white px-2 py-0.5 rounded-full font-bold">ACTIVA</span>}
                      </div>
                    </button>
                  )
                })}
              </div>

              {!zonaConfig && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
                  ✅ Las 3 zonas están posicionadas. Guarda los cambios.
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => salirConfig(false)}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm hover:bg-slate-50">
                  <X size={13} /> Cancelar
                </button>
                <button onClick={() => salirConfig(true)}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm">
                  <Save size={13} /> Guardar
                </button>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-semibold mb-1">¿Cómo encontrar la ubicación exacta?</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Abre Google Maps → busca UAGRM Santa Cruz</li>
                  <li>Clic derecho en la zona P → "¿Qué hay aquí?"</li>
                  <li>Copia las coordenadas</li>
                  <li>O simplemente haz clic en este mapa donde están los P</li>
                </ol>
              </div>
            </div>

          ) : (
            /* ── MODO DEMO NORMAL ─────────────────────────────────── */
            <>
              {/* Estado */}
              <div className={`rounded-2xl p-3 text-xs border ${
                flow === 'parqueado'     ? 'bg-emerald-50 border-emerald-300' :
                flow === 'confirmando'   ? 'bg-amber-50 border-amber-300' :
                flow === 'en_ruta'       ? 'bg-blue-50 border-blue-300' :
                flow === 'cargando_ruta' ? 'bg-slate-50 border-slate-200' :
                'bg-violet-50 border-violet-200'
              }`}>
                <p className="font-bold text-sm mb-0.5">
                  {flow === 'inicio'         && '🏫 Toca una zona en el mapa'}
                  {flow === 'cargando_ruta'  && '🗺 Calculando ruta OSRM...'}
                  {flow === 'en_ruta'        && '🚗 Navegando al campus'}
                  {flow === 'confirmando'    && '📍 ¡Llegaste a la zona!'}
                  {flow === 'parqueado'      && '✅ Vehículo parqueado'}
                  {flow === 'completado'     && '🏁 Demo completado'}
                </p>
                {horaEntrada && <p className="text-slate-500">Entrada: {horaEntrada}</p>}
                {zonaDestino && <p className="text-slate-600">→ {zonaDestino.nombre}</p>}
                {flow === 'en_ruta' && tiempoRuta && (
                  <p className="text-blue-600 font-medium">⏱ ~{Math.ceil(tiempoRuta/60)} min (OSRM)</p>
                )}
                {flow === 'parqueado' && (
                  <p className="font-mono text-orange-500 font-bold text-base mt-1">
                    ⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
                  </p>
                )}
              </div>

              {/* Cargando */}
              {flow === 'cargando_ruta' && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <Loader2 size={18} className="text-blue-500 animate-spin shrink-0" />
                  <p className="text-sm text-blue-700">Calculando ruta por calles reales...</p>
                </div>
              )}

              {/* Zonas */}
              {(flow === 'inicio' || flow === 'en_ruta') && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Zonas del campus</p>
                  {zonas.map(zona => (
                    <button key={zona.id} onClick={() => handleZonaClick(zona)}
                      className={`w-full text-left rounded-xl border-2 p-3 transition-all hover:shadow-md ${
                        zonaDestino?.id === zona.id ? 'shadow-md' : 'border-slate-200'
                      }`}
                      style={{ borderColor: zonaDestino?.id === zona.id ? zona.color : undefined }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                          style={{ background: zona.color }}>{zona.id}</div>
                        <span className="font-semibold text-slate-800 text-sm">{zona.nombre}</span>
                        <span className="ml-auto text-xs font-bold" style={{ color: zona.color }}>{zona.libres} libres</span>
                      </div>
                      <p className="text-xs text-slate-500 pl-8">{zona.sub}</p>
                    </button>
                  ))}
                  {flow === 'inicio' && (
                    <button onClick={() => handleZonaClick(zonas[1])}
                      className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl text-sm mt-2">
                      🏫 Simular entrada — Av. Busch
                    </button>
                  )}
                </div>
              )}

              {/* Confirmación */}
              {flow === 'confirmando' && zonaDestino && (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-center">
                    <p className="text-2xl mb-1">📍</p>
                    <p className="font-bold text-amber-800">¡Llegaste a Zona {zonaDestino.id}!</p>
                    <p className="text-xs text-amber-600">{zonaDestino.sub}</p>
                  </div>
                  <select value={vehiculoSelId ?? ''} onChange={e => setVehId(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                    <option value="">Selecciona tu vehículo...</option>
                    {vehiculos.map((v: any) => <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>)}
                  </select>
                  {primerEsp ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 text-xs text-emerald-700">
                      Espacio disponible: <strong>#{primerEsp.numero}</strong> · {primerEsp.zona?.nombre}
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-2 text-xs text-red-600">Sin espacios disponibles en esta zona</div>
                  )}
                  {msg && <div className={`rounded-xl p-2 text-xs ${msg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg}</div>}
                  <div className="flex gap-2">
                    <button onClick={() => { setZonaD(null); setRuta([]); setFlow('en_ruta') }}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl text-sm">
                      <XCircle size={13} /> Cambiar
                    </button>
                    <button onClick={confirmar} disabled={lSesion || !vehiculoSelId || !primerEsp}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm disabled:opacity-40">
                      {lSesion ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      Confirmar
                    </button>
                  </div>
                </div>
              )}

              {/* Parqueado */}
              {flow === 'parqueado' && (
                <div className="space-y-3">
                  <div className="bg-slate-800 text-white rounded-2xl p-4">
                    <p className="font-mono font-black text-xl">{vehSel?.placa ?? '—'}</p>
                    <p className="text-slate-300 text-sm">{zonaDestino?.nombre}</p>
                    <p className="font-mono text-orange-400 font-bold text-lg mt-2">
                      ⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
                    </p>
                  </div>
                  {msg && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 text-xs text-emerald-700">{msg}</div>}
                  <button onClick={() => navigate('/parqueos')} className="w-full py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-bold text-sm">Ver en Parqueos →</button>
                  <button onClick={simularSalida} className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm">
                    <Car size={13} /> Simular salida
                  </button>
                </div>
              )}

              {/* Completado */}
              {flow === 'completado' && (
                <div className="space-y-3">
                  <div className="text-center py-4"><p className="text-4xl">✅</p><p className="font-bold text-slate-800 mt-1">Demo completado</p></div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1.5 text-sm">
                    {[['Vehículo', vehSel?.placa, 'font-mono font-bold'], ['Zona', zonaDestino?.nombre, ''], ['Entrada', horaEntrada, 'text-emerald-600'], ['Salida', horaSalida, 'text-red-500'], ['Tiempo', `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} min`, 'text-orange-500 font-bold']].map(([k,v,cls]) => (
                      <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className={String(cls)}>{String(v ?? '—')}</span></div>
                    ))}
                  </div>
                  <button onClick={reiniciar} className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm">
                    <RotateCcw size={13} /> Repetir demo
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mapa */}
        <div className="relative" style={{ flex: 1 }}>
          <MapaLeaflet
            zonas={zonasActivas}
            entrada={entrada}
            zonaDestino={zonaDestino}
            flowState={flow}
            rutaPuntos={rutaPuntos}
            modoConfig={modoConfig}
            zonaConfig={zonaConfig}
            onZonaClick={handleZonaClick}
            onLlegada={handleLlegada}
            onMapClick={handleMapClick}
          />

          {/* Overlays */}
          {modoConfig && zonaConfig && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-amber-500 text-white rounded-xl px-4 py-2 text-sm font-bold shadow-lg flex items-center gap-2">
              <MapPin size={14} className="animate-bounce" />
              Haz clic donde está la Zona {zonaConfig} en el campus
            </div>
          )}
          {flow === 'cargando_ruta' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-white/95 rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <Loader2 size={13} className="animate-spin text-blue-500" /> Calculando ruta OSRM...
            </div>
          )}
          {flow === 'en_ruta' && zonaDestino && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]
              bg-blue-700/90 text-white rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <Navigation size={13} className="animate-pulse" />
              Zona {zonaDestino.id}
              {tiempoRuta && <span className="text-blue-200">· ~{Math.ceil(tiempoRuta/60)} min</span>}
            </div>
          )}
          {flow === 'parqueado' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-emerald-700/90 text-white rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <CheckCircle2 size={13} /> Zona {zonaDestino?.id} · {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
            </div>
          )}
          {flow === 'inicio' && (
            <div className="absolute top-3 left-3 z-[1000]
              bg-white/90 rounded-xl px-3 py-2 text-xs shadow-md border border-slate-200 max-w-[220px]">
              <p className="font-semibold">🗺 Campus UAGRM — Santa Cruz</p>
              <p className="text-slate-500 mt-0.5">Toca 🅿 para guiar al parqueo</p>
              {esAdmin && <p className="text-amber-600 mt-1">⚙ Usa "Configurar zonas" para ajustar posiciones</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
