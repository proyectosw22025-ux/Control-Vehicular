/**
 * ParqueoDemo — Guía de parqueo con mapa REAL del campus UAGRM.
 *
 * v3 — Fixes:
 *   1. Coordenadas GPS recalibradas dentro del campus (2da imagen oficial)
 *   2. Routing real via OSRM (Open Source Routing Machine, API pública, sin key)
 *      → el vehículo sigue calles reales, no línea recta a través de edificios
 *   3. Fallback a interpolación si OSRM no responde
 *
 * Stack: Leaflet + OpenStreetMap (sin API key) + OSRM routing API (sin API key)
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { Navigation, RotateCcw, CheckCircle2, XCircle, Clock, Car, Wifi, Loader2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ZONAS_QUERY, ESPACIOS_POR_ZONA_QUERY } from '../graphql/queries/parqueos'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { INICIAR_SESION_MUTATION } from '../graphql/mutations/parqueos'

// ── Coordenadas GPS reales UAGRM — calibradas desde imagen oficial ─────────
// Fuente: uagrm.edu.bo/udigital/localizacion (Leaflet/OSM)
// Campus: Av. Busch (norte) | Av. 26 de Febrero (este) |
//         Av. Dr. Rómulo Herrera (sur) | Calle Raúl Bascopé (oeste)
const UAGRM = {
  centro:  [-17.7905, -63.1862] as [number, number],
  zoom:    16,   // zoom 16 muestra ~1km² — campus completo visible

  entrada: {
    // Portería principal sobre Av. Busch (norte del campus)
    coords: [-17.7858, -63.1848] as [number, number],
    label:  'Entrada Principal — Av. Busch',
  },

  zonas: [
    {
      id: 'A', nombre: 'Zona A', sub: 'Módulo 250-251 — Norte',
      // P visible al norte del campus, próximo a Av. Busch e INEGAS
      coords: [-17.7878, -63.1845] as [number, number],
      color: '#3b82f6', libres: 12, total: 40,
      roles: 'Docentes / Administrativos',
    },
    {
      id: 'B', nombre: 'Zona B', sub: 'La Poza — Bloque Central',
      // P al oeste/central, zona de La Poza de las Antas (Módulo 254 área)
      coords: [-17.7908, -63.1878] as [number, number],
      color: '#22c55e', libres: 25, total: 80,
      roles: 'Todos los usuarios',
    },
    {
      id: 'C', nombre: 'Zona C', sub: 'Facultad Politécnica / Contaduría',
      // P al sur, entre Módulo 248 y Facultad de Ciencias Jurídicas
      coords: [-17.7938, -63.1855] as [number, number],
      color: '#f59e0b', libres: 8, total: 50,
      roles: 'Todos los usuarios',
    },
  ],
}

// ── OSRM routing — Open Source Routing Machine (sin API key, gratuito) ────
// Devuelve ruta real por calles. OSRM usa los mismos datos que OpenStreetMap.
async function obtenerRutaOSRM(
  desde: [number, number],
  hasta:  [number, number],
): Promise<[number, number][]> {
  // OSRM espera [lng, lat] — invertido respecto a Leaflet [lat, lng]
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${desde[1]},${desde[0]};${hasta[1]},${hasta[0]}` +
    `?geometries=geojson&overview=full&steps=false`

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!resp.ok) throw new Error(`OSRM ${resp.status}`)
    const data  = await resp.json()
    const coords = data?.routes?.[0]?.geometry?.coordinates
    if (data.code === 'Ok' && coords?.length) {
      // Convertir [[lng,lat],...] → [[lat,lng],...] para Leaflet
      return coords.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number])
    }
  } catch (e) {
    console.warn('[ParqueoDemo] OSRM falló, usando línea recta:', e)
  }

  // Fallback: interpolación lineal si OSRM no responde
  return Array.from({ length: 61 }, (_, i) => [
    desde[0] + (hasta[0] - desde[0]) * i / 60,
    desde[1] + (hasta[1] - desde[1]) * i / 60,
  ] as [number, number])
}

type FlowState = 'inicio' | 'cargando_ruta' | 'en_ruta' | 'confirmando' | 'parqueado' | 'completado'

// ── Componente de mapa (Leaflet imperativo) ───────────────────────────────
function MapaLeaflet({
  zonaDestino, flowState, rutaPuntos, onZonaClick, onLlegada,
}: {
  zonaDestino:  typeof UAGRM.zonas[0] | null
  flowState:    FlowState
  rutaPuntos:   [number,number][]
  onZonaClick:  (z: typeof UAGRM.zonas[0]) => void
  onLlegada:    () => void
}) {
  const mapRef     = useRef<any>(null)
  const vehicleRef = useRef<any>(null)
  const lineaRef   = useRef<any>(null)
  const animRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const divRef     = useRef<HTMLDivElement>(null)

  // ── Inicializar mapa ──────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !divRef.current) return

    const t = setTimeout(() => {
      if (!divRef.current || mapRef.current) return
      import('leaflet').then(L => {
        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        const map = L.map(divRef.current!, {
          center: UAGRM.centro, zoom: UAGRM.zoom, zoomControl: true,
        })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors — Campus UAGRM Santa Cruz',
          maxZoom: 19,
        }).addTo(map)
        setTimeout(() => map.invalidateSize(), 200)

        // Marcador de entrada
        const iconEntrada = L.divIcon({
          html: `<div style="background:#1e40af;color:white;border-radius:50%;width:36px;height:36px;
                             display:flex;align-items:center;justify-content:center;font-size:18px;
                             border:3px solid white;box-shadow:0 3px 10px rgba(0,0,0,0.4)">🏫</div>`,
          className: '', iconSize: [36,36], iconAnchor: [18,18],
        })
        L.marker(UAGRM.entrada.coords, { icon: iconEntrada })
          .addTo(map)
          .bindPopup(`<b>${UAGRM.entrada.label}</b><br>Control de acceso QR`)

        // Marcadores de zonas de parqueo
        UAGRM.zonas.forEach(zona => {
          const iconZona = L.divIcon({
            html: `<div style="background:${zona.color};color:white;border-radius:12px;
                               padding:5px 10px;font-weight:900;font-size:12px;
                               box-shadow:0 3px 12px rgba(0,0,0,0.4);cursor:pointer;
                               white-space:nowrap;border:2px solid rgba(255,255,255,0.8)">
                     🅿 Zona ${zona.id} · ${zona.libres} libres
                   </div>`,
            className: '', iconSize: [130,30], iconAnchor: [65,15],
          })
          L.marker(zona.coords, { icon: iconZona })
            .addTo(map)
            .on('click', () => onZonaClick(zona))
            .bindPopup(`<b>${zona.nombre}</b><br>${zona.sub}<br>
                        <span style="color:green">${zona.libres} espacios libres</span><br>
                        <small>${zona.roles}</small>`)
        })

        // Vehículo inicial en la entrada
        const iconCar = L.divIcon({
          html: `<div style="font-size:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6))">🚗</div>`,
          className: '', iconSize: [32,32], iconAnchor: [16,16],
        })
        vehicleRef.current = L.marker(UAGRM.entrada.coords, {
          icon: iconCar, zIndexOffset: 1000,
        }).addTo(map)

        mapRef.current = map
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

  // ── Dibujar ruta y animar cuando llegan los puntos OSRM ──────────────
  useEffect(() => {
    if (!rutaPuntos.length || flowState !== 'en_ruta' || !mapRef.current || !vehicleRef.current) return

    import('leaflet').then(L => {
      // Limpiar ruta anterior
      if (lineaRef.current) { lineaRef.current.remove(); lineaRef.current = null }
      if (animRef.current)  { clearInterval(animRef.current); animRef.current = null }

      // Dibujar ruta OSRM real
      lineaRef.current = L.polyline(rutaPuntos, {
        color:  zonaDestino?.color ?? '#3b82f6',
        weight: 5, opacity: 0.85, dashArray: '12 6',
      }).addTo(mapRef.current)

      // Ajustar vista para mostrar toda la ruta
      mapRef.current.flyToBounds(
        L.latLngBounds([UAGRM.entrada.coords, ...(zonaDestino ? [zonaDestino.coords] : [])]),
        { padding: [50, 50], duration: 1.2, maxZoom: 17 }
      )

      // Animar vehículo a lo largo de la ruta
      let idx = 0
      const paso = Math.max(1, Math.floor(rutaPuntos.length / 80)) // ~80 frames

      animRef.current = setInterval(() => {
        if (idx >= rutaPuntos.length) {
          clearInterval(animRef.current!)
          animRef.current = null
          // Zoom al destino
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
    <div
      ref={divRef}
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        minHeight: 400,
      }}
    />
  )
}

// ── Componente principal ───────────────────────────────────────────────────
export default function ParqueoDemo() {
  const { usuario, esAdmin } = useAuth()
  const navigate = useNavigate()

  const [flow, setFlow]           = useState<FlowState>('inicio')
  const [zonaDestino, setZonaD]   = useState<typeof UAGRM.zonas[0] | null>(null)
  const [rutaPuntos, setRuta]     = useState<[number,number][]>([])
  const [vehiculoSelId, setVehId] = useState<number | null>(null)
  const [segundos, setSegundos]   = useState(0)
  const [horaEntrada, setHoraE]   = useState('')
  const [horaSalida, setHoraS]    = useState('')
  const [mensajeExito, setMsg]    = useState('')
  const [tiempoRuta, setTiempoR]  = useState<number | null>(null)  // seg estimados OSRM

  const { data: zonasData }  = useQuery(ZONAS_QUERY, { variables: { soloActivas: true } })
  const { data: vehData }    = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: esAdmin ? undefined : usuario.id, estado: 'activo', porPagina: 50 },
  })
  const { data: espData }    = useQuery(ESPACIOS_POR_ZONA_QUERY, {
    variables: { zonaId: (() => {
      if (!zonaDestino || !zonasData?.zonas) return null
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
      setMsg(`✅ ${s.placaVehiculo} asignado al espacio #${s.espacio.numero} — ${s.espacio.zona.nombre}`)
    },
    onError(e) { setMsg(`❌ ${e.message}`) },
  })

  const vehiculos   = vehData?.vehiculos?.items ?? []
  const espaciosDisp = (espData?.espaciosPorZona ?? []).filter((e: any) => e.estado === 'disponible')
  const primerEsp   = espaciosDisp[0]

  // Contador parqueado
  useEffect(() => {
    if (flow !== 'parqueado') return
    const t = setInterval(() => setSegundos(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [flow])

  // ── Seleccionar zona: iniciar ruta OSRM ──────────────────────────────
  const handleZonaClick = useCallback(async (zona: typeof UAGRM.zonas[0]) => {
    if (flow === 'confirmando' || flow === 'parqueado' || flow === 'completado') return

    const hora = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
    if (!horaEntrada) setHoraE(hora)
    setZonaD(zona)
    setFlow('cargando_ruta')
    setRuta([])
    setTiempoR(null)

    // Llamar OSRM para ruta real por calles
    try {
      // Estimar tiempo desde OSRM también
      const url = `https://router.project-osrm.org/route/v1/driving/${UAGRM.entrada.coords[1]},${UAGRM.entrada.coords[0]};${zona.coords[1]},${zona.coords[0]}?geometries=geojson&overview=full&steps=false`
      const resp = await fetch(url, { signal: AbortSignal.timeout(6000) })
      const data = await resp.json()
      if (data.code === 'Ok' && data.routes?.[0]) {
        const coords = data.routes[0].geometry.coordinates.map(
          ([lng, lat]: [number,number]) => [lat, lng] as [number,number]
        )
        setTiempoR(Math.round(data.routes[0].duration))  // segundos estimados
        setRuta(coords)
      } else throw new Error('sin ruta')
    } catch {
      // Fallback: línea recta
      setRuta(Array.from({ length: 61 }, (_, i) => [
        UAGRM.entrada.coords[0] + (zona.coords[0] - UAGRM.entrada.coords[0]) * i / 60,
        UAGRM.entrada.coords[1] + (zona.coords[1] - UAGRM.entrada.coords[1]) * i / 60,
      ] as [number,number]))
    }

    setFlow('en_ruta')
  }, [flow, horaEntrada])

  const handleLlegada = useCallback(() => setFlow('confirmando'), [])

  function confirmarParqueo() {
    if (!vehiculoSelId || !primerEsp) { setMsg('Selecciona tu vehículo para confirmar'); return }
    iniciarSesion({ variables: { input: { espacioId: primerEsp.id, vehiculoId: vehiculoSelId } } })
  }

  function completarDemo() {
    setHoraS(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    setFlow('completado')
  }

  function reiniciar() {
    setFlow('inicio'); setZonaD(null); setRuta([]); setVehId(null)
    setSegundos(0); setHoraE(''); setHoraS(''); setMsg(''); setTiempoR(null)
  }

  const min = Math.floor(segundos / 60)
  const sec = segundos % 60
  const vehSel = vehiculos.find((v: any) => v.id === vehiculoSelId)

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
              <Wifi size={10} /> OpenStreetMap + OSRM routing — Santa Cruz, Bolivia
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/parqueos')}
            className="text-xs text-blue-300 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg">
            Ver parqueo →
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

          {/* Estado */}
          <div className={`rounded-2xl p-3 text-xs border ${
            flow === 'parqueado'      ? 'bg-emerald-50 border-emerald-300' :
            flow === 'confirmando'    ? 'bg-amber-50 border-amber-300' :
            flow === 'en_ruta'        ? 'bg-blue-50 border-blue-300' :
            flow === 'cargando_ruta'  ? 'bg-slate-50 border-slate-200' :
            flow === 'completado'     ? 'bg-slate-50 border-slate-200' :
            'bg-violet-50 border-violet-200'
          }`}>
            <p className="font-bold text-sm mb-0.5">
              {flow === 'inicio'         && '🏫 Listo — toca una zona en el mapa'}
              {flow === 'cargando_ruta'  && '🗺 Calculando ruta por calles reales...'}
              {flow === 'en_ruta'        && '🚗 Navegando al campus UAGRM'}
              {flow === 'confirmando'    && '📍 ¡Llegaste a la zona!'}
              {flow === 'parqueado'      && '✅ Vehículo parqueado'}
              {flow === 'completado'     && '🏁 Demo completado'}
            </p>
            {horaEntrada && <p className="text-slate-500">Entrada: {horaEntrada}</p>}
            {zonaDestino && flow !== 'inicio' && (
              <p className="text-slate-600">→ {zonaDestino.nombre} — {zonaDestino.sub}</p>
            )}
            {flow === 'en_ruta' && tiempoRuta && (
              <p className="text-blue-600 font-medium mt-0.5">
                ⏱ ~{Math.ceil(tiempoRuta / 60)} min estimados (OSRM)
              </p>
            )}
            {flow === 'parqueado' && (
              <p className="text-orange-500 font-mono text-base font-bold mt-1">
                ⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')} parqueado
              </p>
            )}
          </div>

          {/* Instrucciones iniciales */}
          {flow === 'inicio' && (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 border border-slate-200">
                <p className="font-semibold mb-1">¿Cómo funciona?</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Toca una zona 🅿 en el mapa del campus</li>
                  <li>OSRM calcula la ruta real por calles</li>
                  <li>El vehículo 🚗 navega por las calles reales</li>
                  <li>Confirma con tu vehículo → espacio se ocupa en el sistema</li>
                </ol>
              </div>
              <button onClick={() => handleZonaClick(UAGRM.zonas[1])}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-2xl transition-colors text-sm">
                🏫 Simular entrada — Av. Busch
              </button>
            </div>
          )}

          {/* Cargando ruta */}
          {flow === 'cargando_ruta' && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <Loader2 size={20} className="text-blue-500 animate-spin shrink-0" />
              <div>
                <p className="text-sm font-semibold text-blue-800">Calculando ruta</p>
                <p className="text-xs text-blue-600">Consultando OSRM (calles reales de Santa Cruz)</p>
              </div>
            </div>
          )}

          {/* Selector de zonas (inicio / en_ruta) */}
          {(flow === 'inicio' || flow === 'en_ruta') && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Zonas del campus</p>
              {UAGRM.zonas.map(zona => (
                <button key={zona.id} onClick={() => handleZonaClick(zona)}
                  className={`w-full text-left rounded-xl border-2 p-3 transition-all hover:shadow-md ${
                    zonaDestino?.id === zona.id
                      ? 'shadow-md'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                  style={{ borderColor: zonaDestino?.id === zona.id ? zona.color : undefined }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                      style={{ background: zona.color }}>{zona.id}</div>
                    <span className="font-semibold text-slate-800 text-sm">{zona.nombre}</span>
                    <span className="ml-auto text-xs font-bold" style={{ color: zona.color }}>{zona.libres} libres</span>
                  </div>
                  <p className="text-xs text-slate-500 pl-8">{zona.sub}</p>
                </button>
              ))}
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

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Selecciona tu vehículo</label>
                <select value={vehiculoSelId ?? ''} onChange={e => setVehId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="">Seleccionar...</option>
                  {vehiculos.map((v: any) => (
                    <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                  ))}
                </select>
              </div>

              {primerEsp ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs">
                  <p className="text-emerald-700 font-semibold">Espacio disponible: #{primerEsp.numero}</p>
                  <p className="text-emerald-600">{primerEsp.categoria?.nombre} · {primerEsp.zona?.nombre}</p>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">
                  Sin espacios disponibles en esta zona actualmente
                </div>
              )}

              {mensajeExito && (
                <div className={`rounded-xl p-3 text-xs ${mensajeExito.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {mensajeExito}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => { setZonaD(null); setRuta([]); setFlow('en_ruta') }}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors">
                  <XCircle size={14} /> Cambiar
                </button>
                <button onClick={confirmarParqueo}
                  disabled={lSesion || !vehiculoSelId || !primerEsp}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-40 shadow-lg">
                  {lSesion ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {lSesion ? 'Confirmando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          )}

          {/* Parqueado */}
          {flow === 'parqueado' && (
            <div className="space-y-3">
              <div className="bg-slate-800 text-white rounded-2xl p-4">
                <p className="text-xs text-slate-400 uppercase">Vehículo parqueado</p>
                <p className="font-mono font-black text-xl mt-0.5">{vehSel?.placa ?? '—'}</p>
                <p className="text-slate-300 text-sm">{zonaDestino?.nombre} · {zonaDestino?.sub}</p>
                <div className="flex items-center gap-2 mt-2 bg-slate-700 rounded-xl px-3 py-2">
                  <Clock size={14} className="text-orange-400" />
                  <span className="font-mono text-orange-400 font-bold text-base">
                    {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Entrada: {horaEntrada}</p>
              </div>
              {mensajeExito && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
                  {mensajeExito}
                </div>
              )}
              <button onClick={() => navigate('/parqueos')}
                className="w-full py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-bold text-sm transition-colors">
                Ver en módulo Parqueos →
              </button>
              <button onClick={completarDemo}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors">
                <Car size={14} /> Simular salida del campus
              </button>
            </div>
          )}

          {/* Completado */}
          {flow === 'completado' && (
            <div className="space-y-3">
              <div className="text-center p-4">
                <p className="text-4xl mb-2">✅</p>
                <p className="font-bold text-slate-800">Demo completado</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-sm">
                {[
                  ['Vehículo', vehSel?.placa ?? '—', 'font-mono font-bold'],
                  ['Zona', `${zonaDestino?.nombre}`, 'font-medium'],
                  ['Entrada', horaEntrada, 'text-emerald-600 font-medium'],
                  ['Salida', horaSalida, 'text-red-500 font-medium'],
                  ['Duración', `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} min`, 'text-orange-500 font-bold'],
                ].map(([k, v, cls]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-500">{k}</span><span className={cls}>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={reiniciar}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm">
                <RotateCcw size={14} /> Repetir
              </button>
            </div>
          )}
        </div>

        {/* Mapa */}
        <div className="relative" style={{ flex: 1 }}>
          <MapaLeaflet
            zonaDestino={zonaDestino}
            flowState={flow}
            rutaPuntos={rutaPuntos}
            onZonaClick={handleZonaClick}
            onLlegada={handleLlegada}
          />

          {/* Overlays sobre el mapa */}
          {flow === 'cargando_ruta' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-white/95 rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <Loader2 size={14} className="animate-spin text-blue-500" />
              Calculando ruta OSRM...
            </div>
          )}
          {flow === 'en_ruta' && zonaDestino && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]
              bg-blue-700/90 text-white rounded-xl px-4 py-2 flex items-center gap-2 text-sm backdrop-blur-sm shadow-lg">
              <Navigation size={13} className="animate-pulse" />
              Hacia Zona {zonaDestino.id}
              {tiempoRuta && <span className="text-blue-200">· ~{Math.ceil(tiempoRuta / 60)} min</span>}
            </div>
          )}
          {flow === 'parqueado' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-emerald-700/90 text-white rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <CheckCircle2 size={14} className="text-emerald-300" />
              Zona {zonaDestino?.id} · {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
            </div>
          )}
          {flow === 'inicio' && (
            <div className="absolute top-3 left-3 z-[1000]
              bg-white/90 rounded-xl px-3 py-2 text-xs shadow-md border border-slate-200 max-w-[210px]">
              <p className="font-semibold text-slate-800">🗺 Campus UAGRM — Santa Cruz</p>
              <p className="text-slate-500 mt-0.5">Toca un marcador 🅿 para iniciar la guía</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
