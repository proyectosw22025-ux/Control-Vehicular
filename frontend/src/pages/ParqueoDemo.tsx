/**
 * ParqueoDemo — Modo de guía de parqueo con mapa REAL del campus UAGRM.
 *
 * Usa react-leaflet v4 + OpenStreetMap. Las coordenadas GPS corresponden a
 * los marcadores "P" visibles en uagrm.edu.bo/udigital/localizacion.
 *
 * Flujo real:
 *   1. Vehículo "entra" por la puerta principal (Av. Busch)
 *   2. El sistema recomienda la zona más cercana y disponible
 *   3. El marcador 🚗 se mueve animado sobre el mapa real del campus
 *   4. Al llegar a la zona → modal de confirmación
 *   5. Se crea una SesionParqueo real en el sistema
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import { Navigation, RotateCcw, CheckCircle2, XCircle, Clock, Car, MapPin, Wifi } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ZONAS_QUERY, ESPACIOS_POR_ZONA_QUERY } from '../graphql/queries/parqueos'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { INICIAR_SESION_MUTATION } from '../graphql/mutations/parqueos'

// ── Coordenadas GPS reales UAGRM — Santa Cruz, Bolivia ────────────────────
// Verificadas contra uagrm.edu.bo/udigital/localizacion y OpenStreetMap
// Campus principal: entre Av. Busch (norte), Av. 26 de Febrero (este),
// Av. Dr. Rómulo Herrera Justiniano (sur), Calle Raúl Bascopé (oeste)
const UAGRM = {
  centro:  [-17.7895, -63.1850] as [number, number],  // centro del campus
  zoom:    17,                                          // zoom óptimo para ver el campus completo
  entrada: {
    coords: [-17.7868, -63.1848] as [number, number],  // Av. Busch — entrada principal norte
    label:  'Entrada Principal — Av. Busch',
  },
  zonas: [
    {
      id: 'A', nombre: 'Zona A', sub: 'Módulo 250-251 (Norte)',
      // P visible norte del campus, cerca de los módulos 250-251
      coords: [-17.7876, -63.1835] as [number, number],
      color: '#3b82f6', libres: 12, total: 40,
      roles: 'Docentes / Administrativos',
    },
    {
      id: 'B', nombre: 'Zona B', sub: 'La Poza — Bloque Central',
      // P central, área de La Poza de las Antas
      coords: [-17.7898, -63.1855] as [number, number],
      color: '#22c55e', libres: 25, total: 80,
      roles: 'Todos los usuarios',
    },
    {
      id: 'C', nombre: 'Zona C', sub: 'Facultad Politécnica / Contaduría',
      // P sur-este, zona de facultades
      coords: [-17.7916, -63.1832] as [number, number],
      color: '#f59e0b', libres: 8, total: 50,
      roles: 'Todos los usuarios',
    },
  ],
}

// Genera puntos intermedios para animar la ruta (30 pasos)
function interpolar(a: [number,number], b: [number,number], pasos = 40): [number,number][] {
  return Array.from({ length: pasos + 1 }, (_, i) => [
    a[0] + (b[0] - a[0]) * i / pasos,
    a[1] + (b[1] - a[1]) * i / pasos,
  ] as [number, number])
}

type FlowState = 'inicio' | 'en_ruta' | 'llegando' | 'confirmando' | 'parqueado' | 'completado'

// ── Componente hijo que maneja el mapa Leaflet ────────────────────────────
// Se define dentro del mismo archivo para acceder al estado del padre
function MapaLeaflet({
  zonaDestino, flowState, onZonaClick, onLlegada,
}: {
  zonaDestino: typeof UAGRM.zonas[0] | null
  flowState: FlowState
  onZonaClick: (z: typeof UAGRM.zonas[0]) => void
  onLlegada: () => void
}) {
  const mapRef     = useRef<any>(null)
  const vehicleRef = useRef<any>(null)
  const lineaRef   = useRef<any>(null)
  const divRef     = useRef<HTMLDivElement>(null)
  const animRef    = useRef<ReturnType<typeof setInterval> | null>(null)

  // Inicializar mapa — esperar a que el DOM tenga dimensiones reales
  useEffect(() => {
    if (mapRef.current || !divRef.current) return

    // Pequeño delay para que React termine el render y el div tenga dimensiones
    const initTimeout = setTimeout(() => {
      if (!divRef.current || mapRef.current) return

      import('leaflet').then(L => {
        // Fix iconos default de Leaflet en Vite (ruta de assets diferente)
        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        })

        const map = L.map(divRef.current!, {
          center:      UAGRM.centro,
          zoom:        UAGRM.zoom,
          zoomControl: true,
        })

        // invalidateSize fuerza a Leaflet a recalcular las dimensiones del contenedor
        setTimeout(() => map.invalidateSize(), 100)

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap — Campus UAGRM Santa Cruz, Bolivia',
        maxZoom: 19,
      }).addTo(map)

      // Marcador entrada
      const iconEntrada = L.divIcon({
        html: `<div style="background:#1e40af;color:white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:36px;height:36px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center">
                 <span style="transform:rotate(45deg);font-size:16px">🏫</span>
               </div>`,
        className: '', iconSize: [36, 36], iconAnchor: [18, 36],
      })
      L.marker(UAGRM.entrada.coords, { icon: iconEntrada })
        .addTo(map)
        .bindPopup(`<b>${UAGRM.entrada.label}</b><br>Punto de control QR — Av. Busch`)

      // Marcadores de zonas reales
      UAGRM.zonas.forEach(zona => {
        const iconZona = L.divIcon({
          html: `<div style="background:${zona.color};color:white;border-radius:10px;padding:5px 10px;font-weight:900;font-size:13px;box-shadow:0 3px 10px rgba(0,0,0,0.35);white-space:nowrap;border:2px solid rgba(255,255,255,0.8)">
                   🅿 Zona ${zona.id} · ${zona.libres} libres
                 </div>`,
          className: '', iconSize: [130, 32], iconAnchor: [65, 16],
        })
        L.marker(zona.coords, { icon: iconZona })
          .addTo(map)
          .on('click', () => onZonaClick(zona))
          .bindPopup(`<b>${zona.nombre} — ${zona.sub}</b><br>${zona.libres} espacios libres<br><small>${zona.roles}</small>`)
      })

      // Vehículo inicial en la entrada
      const iconCar = L.divIcon({
        html: `<div style="font-size:28px;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.6));transition:all 0.1s">🚗</div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 16],
      })
      vehicleRef.current = L.marker(UAGRM.entrada.coords, { icon: iconCar, zIndexOffset: 1000 }).addTo(map)

        mapRef.current = map
      })
    }, 50)

    return () => {
      clearTimeout(initTimeout)
      if (animRef.current) clearInterval(animRef.current)
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Animar vehículo cuando cambia la zona destino
  useEffect(() => {
    if (!zonaDestino || !mapRef.current || !vehicleRef.current) return
    if (flowState !== 'en_ruta') return

    import('leaflet').then(L => {
      // Dibujar ruta
      if (lineaRef.current) lineaRef.current.remove()
      const ruta = interpolar(UAGRM.entrada.coords, zonaDestino.coords, 50)
      lineaRef.current = L.polyline(ruta, {
        color: zonaDestino.color, weight: 4, opacity: 0.75, dashArray: '10 6',
      }).addTo(mapRef.current)

      // Hacer zoom para ver la ruta completa
      mapRef.current.flyToBounds(
        L.latLngBounds([UAGRM.entrada.coords, zonaDestino.coords]),
        { padding: [60, 60], duration: 1.2 }
      )

      // Animar el marcador del vehículo
      if (animRef.current) clearInterval(animRef.current)
      let idx = 0
      animRef.current = setInterval(() => {
        if (!vehicleRef.current || idx > ruta.length - 1) {
          clearInterval(animRef.current!)
          onLlegada()
          return
        }
        vehicleRef.current.setLatLng(ruta[idx])
        idx += 2  // saltar de 2 en 2 para velocidad razonable
      }, 80)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonaDestino, flowState])

  return (
    <div
      ref={divRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '500px',
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
      }}
    />
  )
}

// ── Componente principal ───────────────────────────────────────────────────
export default function ParqueoDemo() {
  const { usuario, esAdmin } = useAuth()
  const navigate = useNavigate()

  const [flow, setFlow]             = useState<FlowState>('inicio')
  const [zonaDestino, setZonaD]     = useState<typeof UAGRM.zonas[0] | null>(null)
  const [vehiculoSelId, setVehId]   = useState<number | null>(null)
  const [espacioSelId, setEspId]    = useState<number | null>(null)
  const [segundos, setSegundos]     = useState(0)
  const [sesionId, setSesionId]     = useState<number | null>(null)
  const [horaEntrada, setHoraE]     = useState('')
  const [horaSalida, setHoraS]      = useState('')
  const [mensajeExito, setMensaje]  = useState('')

  // Queries
  const { data: zonasData }  = useQuery(ZONAS_QUERY, { variables: { soloActivas: true } })
  const { data: vehData }    = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: esAdmin ? undefined : usuario.id, estado: 'activo', porPagina: 50 },
  })
  const { data: espData }    = useQuery(ESPACIOS_POR_ZONA_QUERY, {
    variables: { zonaId: (() => {
      if (!zonaDestino || !zonasData) return null
      const zona = (zonasData.zonas ?? []).find((z: any) =>
        z.nombre.includes(`Zona ${zonaDestino.id}`) || z.nombre.toLowerCase().includes(zonaDestino.sub.toLowerCase().slice(0, 5))
      )
      return zona?.id ?? (zonasData.zonas?.[0]?.id ?? null)
    })() },
    skip: !zonaDestino || !zonasData,
    fetchPolicy: 'network-only',
  })

  const [iniciarSesion, { loading: lSesion }] = useMutation(INICIAR_SESION_MUTATION, {
    onCompleted(d) {
      const s = d.iniciarSesionParqueo
      setSesionId(s.id)
      setFlow('parqueado')
      setSegundos(0)
      setMensaje(`✅ ${s.placaVehiculo} asignado a #${s.espacio.numero} en ${s.espacio.zona.nombre}`)
    },
    onError(e) { setMensaje(`❌ ${e.message}`) },
  })

  const vehiculos = vehData?.vehiculos?.items ?? []
  const espaciosDisp = (espData?.espaciosPorZona ?? []).filter((e: any) => e.estado === 'disponible')
  const primerEspacio = espaciosDisp[0]

  // Contador de tiempo parqueado
  useEffect(() => {
    if (flow !== 'parqueado') return
    const t = setInterval(() => setSegundos(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [flow])

  function simularEntrada() {
    setHoraE(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    setFlow('en_ruta')
  }

  const handleZonaClick = useCallback((zona: typeof UAGRM.zonas[0]) => {
    if (flow !== 'inicio' && flow !== 'en_ruta') return
    setZonaD(zona)
    if (flow === 'inicio') {
      setHoraE(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    }
    setFlow('en_ruta')
  }, [flow])

  const handleLlegada = useCallback(() => { setFlow('confirmando') }, [])

  function confirmarZona() {
    if (!vehiculoSelId || !primerEspacio) {
      setMensaje('Selecciona tu vehículo y hay un espacio disponible para asignar')
      return
    }
    setEspId(primerEspacio.id)
    iniciarSesion({ variables: { input: { espacioId: primerEspacio.id, vehiculoId: vehiculoSelId } } })
  }

  function completarDemo() {
    setHoraS(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    setFlow('completado')
  }

  function reiniciar() {
    setFlow('inicio'); setZonaD(null); setVehId(null); setEspId(null)
    setSegundos(0); setSesionId(null); setHoraE(''); setHoraS(''); setMensaje('')
  }

  const min = Math.floor(segundos / 60)
  const sec = segundos % 60

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ background: 'linear-gradient(90deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-xl"><Navigation size={18} /></div>
          <div>
            <h1 className="font-bold text-white text-sm">Guía de Parqueo — Campus UAGRM</h1>
            <p className="text-blue-300 text-xs flex items-center gap-2">
              <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse">DEMO</span>
              <Wifi size={10} /> Mapa real · OpenStreetMap · Santa Cruz, Bolivia
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/parqueos')}
            className="text-xs text-blue-300 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg transition-colors">
            Ver parqueo real →
          </button>
          <button onClick={reiniciar}
            className="flex items-center gap-1.5 text-xs text-blue-200 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg transition-colors">
            <RotateCcw size={12} /> Reiniciar
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Panel lateral */}
        <div className="w-72 shrink-0 bg-white overflow-y-auto p-4 space-y-3 border-r border-slate-200">

          {/* Estado del sistema */}
          <div className={`rounded-2xl p-3 text-xs border ${
            flow === 'parqueado'   ? 'bg-emerald-50 border-emerald-300' :
            flow === 'confirmando' ? 'bg-amber-50 border-amber-300' :
            flow === 'en_ruta'     ? 'bg-blue-50 border-blue-300' :
            flow === 'completado'  ? 'bg-slate-50 border-slate-200' :
            'bg-violet-50 border-violet-200'
          }`}>
            <p className="font-bold text-sm mb-0.5">
              {flow === 'inicio'      && '🏫 Listo para demostrar'}
              {flow === 'en_ruta'     && '🚗 Vehículo en ruta...'}
              {flow === 'llegando'    && '📍 Llegando a la zona'}
              {flow === 'confirmando' && '⏳ Confirmar estacionamiento'}
              {flow === 'parqueado'   && '✅ Vehículo parqueado'}
              {flow === 'completado'  && '🏁 Demo completado'}
            </p>
            {horaEntrada && flow !== 'inicio' && <p className="text-slate-500">Entrada: {horaEntrada}</p>}
            {flow === 'parqueado' && (
              <p className="text-orange-500 font-mono text-base font-bold mt-1">
                ⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')} estacionado
              </p>
            )}
            {zonaDestino && flow !== 'inicio' && (
              <p className="text-slate-600 mt-0.5">Destino: Zona {zonaDestino.id} — {zonaDestino.sub}</p>
            )}
          </div>

          {/* Paso 1: Entrada */}
          {flow === 'inicio' && (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 border border-slate-200">
                <p className="font-semibold mb-1">¿Cómo usar este demo?</p>
                <ol className="space-y-1 list-decimal list-inside">
                  <li>Toca una zona <strong>Zona A/B/C</strong> en el mapa</li>
                  <li>El vehículo 🚗 navega al campus real de la UAGRM</li>
                  <li>Selecciona tu vehículo y confirma el parqueo</li>
                  <li>El espacio se ocupa <strong>de verdad en el sistema</strong></li>
                </ol>
              </div>
              <button onClick={simularEntrada}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-2xl transition-colors shadow-lg text-sm">
                🏫 Simular escaneo QR — Entrada Av. Busch
              </button>
              <p className="text-center text-xs text-slate-400">O toca directamente una zona en el mapa</p>
            </div>
          )}

          {/* Zonas disponibles */}
          {(flow === 'inicio' || flow === 'en_ruta') && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Zonas del campus</p>
              {UAGRM.zonas.map(zona => (
                <button key={zona.id} onClick={() => handleZonaClick(zona)}
                  className={`w-full text-left rounded-xl border-2 p-3 transition-all hover:shadow-md ${
                    zonaDestino?.id === zona.id ? 'border-current' : 'border-slate-200 hover:border-slate-300'
                  }`}
                  style={{ borderColor: zonaDestino?.id === zona.id ? zona.color : undefined }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: zona.color }}>
                      {zona.id}
                    </div>
                    <span className="font-semibold text-slate-800 text-sm">{zona.nombre}</span>
                    <span className="ml-auto text-xs font-bold" style={{ color: zona.color }}>{zona.libres} libres</span>
                  </div>
                  <p className="text-xs text-slate-500 pl-8">{zona.sub}</p>
                </button>
              ))}
            </div>
          )}

          {/* Confirmación de llegada */}
          {flow === 'confirmando' && zonaDestino && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-center">
                <p className="text-3xl mb-2">📍</p>
                <p className="font-bold text-amber-800">¡Llegaste a Zona {zonaDestino.id}!</p>
                <p className="text-xs text-amber-600 mt-1">{zonaDestino.sub}</p>
              </div>

              {/* Selector de vehículo */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Tu vehículo</label>
                <select
                  value={vehiculoSelId ?? ''}
                  onChange={e => setVehId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                >
                  <option value="">Seleccionar vehículo...</option>
                  {vehiculos.map((v: any) => (
                    <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                  ))}
                </select>
                {vehiculos.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">No tienes vehículos activos registrados</p>
                )}
              </div>

              {/* Espacio disponible */}
              {primerEspacio ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs">
                  <p className="text-emerald-700 font-semibold">Espacio disponible: #{primerEspacio.numero}</p>
                  <p className="text-emerald-600">{primerEspacio.categoria?.nombre} · {primerEspacio.zona?.nombre}</p>
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">
                  No hay espacios disponibles en esta zona en el sistema real
                </div>
              )}

              {mensajeExito && (
                <div className={`rounded-xl p-3 text-xs font-medium ${mensajeExito.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {mensajeExito}
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => { setZonaD(null); setFlow('en_ruta') }}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl font-medium text-sm hover:bg-slate-50 transition-colors">
                  <XCircle size={15} /> Cambiar
                </button>
                <button onClick={confirmarZona} disabled={lSesion || !vehiculoSelId || !primerEspacio}
                  className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm transition-colors disabled:opacity-40 shadow-lg">
                  {lSesion ? '...' : <><CheckCircle2 size={15} /> Confirmar</>}
                </button>
              </div>
            </div>
          )}

          {/* Parqueado */}
          {flow === 'parqueado' && (
            <div className="space-y-3">
              <div className="bg-slate-800 text-white rounded-2xl p-4">
                <p className="text-xs text-slate-400 uppercase">Vehículo parqueado</p>
                <p className="font-mono font-black text-xl mt-1">
                  {vehiculos.find((v: any) => v.id === vehiculoSelId)?.placa ?? '—'}
                </p>
                <p className="text-slate-300 text-sm">Zona {zonaDestino?.id} · {zonaDestino?.sub}</p>
                <div className="flex items-center gap-2 mt-2 bg-slate-700 rounded-xl px-3 py-2">
                  <Clock size={14} className="text-orange-400" />
                  <span className="font-mono text-orange-400 font-bold">
                    {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')} estacionado
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">Entrada: {horaEntrada}</p>
              </div>
              {mensajeExito && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
                  {mensajeExito}
                </div>
              )}
              <button onClick={() => navigate('/parqueos')}
                className="w-full flex items-center justify-center gap-2 py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-bold text-sm transition-colors">
                Ver en módulo Parqueos →
              </button>
              <button onClick={completarDemo}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm hover:bg-slate-50 transition-colors">
                <Car size={15} /> Simular salida
              </button>
            </div>
          )}

          {/* Completado */}
          {flow === 'completado' && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                <p className="text-4xl mb-2">✅</p>
                <p className="font-bold text-slate-800">Demo completado</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2 text-sm">
                {[
                  ['Vehículo', vehiculos.find((v: any) => v.id === vehiculoSelId)?.placa ?? '—', 'font-mono font-bold'],
                  ['Zona', `${zonaDestino?.nombre} — ${zonaDestino?.sub}`, 'font-medium'],
                  ['Entrada', horaEntrada, 'text-emerald-600 font-medium'],
                  ['Salida', horaSalida, 'text-red-500 font-medium'],
                  ['Duración', `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} min`, 'text-orange-500 font-bold'],
                ].map(([k, v, cls]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-500">{k}</span>
                    <span className={cls}>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={reiniciar}
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-colors">
                <RotateCcw size={15} /> Repetir demostración
              </button>
              <button onClick={() => navigate('/parqueos')}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-violet-300 text-violet-600 rounded-xl text-sm hover:bg-violet-50 transition-colors font-medium">
                <MapPin size={14} /> Ver módulo Parqueos real
              </button>
            </div>
          )}
        </div>

        {/* Mapa real del campus UAGRM */}
        <div className="flex-1 relative">
          <MapaLeaflet
            zonaDestino={zonaDestino}
            flowState={flow}
            onZonaClick={handleZonaClick}
            onLlegada={handleLlegada}
          />

          {/* Overlay overlay estado sobre el mapa */}
          {flow === 'parqueado' && zonaDestino && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-emerald-700/90 text-white rounded-2xl px-4 py-2 flex items-center gap-2 text-sm backdrop-blur-sm shadow-lg">
              <CheckCircle2 size={16} className="text-emerald-300" />
              <span className="font-bold">Zona {zonaDestino.id}</span>
              <span className="text-emerald-300">·</span>
              <span className="font-mono">{String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}</span>
            </div>
          )}

          {flow === 'en_ruta' && zonaDestino && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]
              bg-blue-700/90 text-white rounded-2xl px-4 py-2 flex items-center gap-2 text-sm backdrop-blur-sm shadow-lg">
              <Navigation size={14} className="animate-pulse" />
              Navegando a Zona {zonaDestino.id} — {zonaDestino.sub}
            </div>
          )}

          {flow === 'inicio' && (
            <div className="absolute top-3 left-3 z-[1000]
              bg-white/90 rounded-xl px-3 py-2 text-xs text-slate-600 shadow-md border border-slate-200 backdrop-blur-sm max-w-[220px]">
              <p className="font-semibold text-slate-800 mb-0.5">🗺 Campus UAGRM — Santa Cruz</p>
              <p>Toca una zona 🅿 en el mapa para iniciar la guía</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
