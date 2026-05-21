/**
 * ParqueoDemo — Simulación interactiva del sistema de guía de parqueo UAGRM.
 *
 * Modo DEMO para defensa académica: simula el flujo completo sin necesidad
 * de estar físicamente en el campus ni tener QR reales instalados.
 *
 * Flujo simulado:
 *   1. Vehículo escanea QR en puerta de entrada
 *   2. Sistema muestra zonas disponibles en el mapa real de la UAGRM
 *   3. Se asigna zona y el marcador "navega" animado hasta ella (como Google Maps)
 *   4. Usuario confirma llegada (simula escaneo QR de zona)
 *   5. Espacio marcado como OCUPADO en tiempo real
 *   6. Simulación de salida y liberación del espacio
 *
 * Para producción real ver: /docs/PARQUEO_INTELIGENTE.md
 */
import { useEffect, useRef, useState } from 'react'
import { MapPin, Navigation, QrCode, CheckCircle2, Car, Clock, ArrowRight, RotateCcw, Wifi } from 'lucide-react'

// ── Coordenadas reales del campus UAGRM — Santa Cruz, Bolivia ─────────────
const CAMPUS = {
  center:   [-17.7897, -63.1869] as [number, number],
  zoom:     17,
  entrada:  { lat: -17.7885, lng: -63.1858, label: 'Entrada Principal Norte' },
  zonas: [
    {
      id: 'A', nombre: 'Zona A — Bloque Administrativo',
      lat: -17.7878, lng: -63.1872,
      capacidad: 40, libres: 8,
      color: '#3b82f6', colorBg: 'bg-blue-500',
      roles: ['Docente', 'Administrador'],
      descripcion: 'Reservada para docentes y personal administrativo',
      distancia: '3 min caminando',
    },
    {
      id: 'B', nombre: 'Zona B — Bloque Facultades',
      lat: -17.7901, lng: -63.1875,
      capacidad: 80, libres: 23,
      color: '#22c55e', colorBg: 'bg-green-500',
      roles: ['Estudiante', 'Docente', 'Personal Administrativo'],
      descripcion: 'Zona general, máxima disponibilidad',
      distancia: '5 min caminando',
    },
    {
      id: 'C', nombre: 'Zona C — Biblioteca Central',
      lat: -17.7915, lng: -63.1862,
      capacidad: 50, libres: 12,
      color: '#f59e0b', colorBg: 'bg-amber-500',
      roles: ['Estudiante', 'Docente', 'Personal Administrativo'],
      descripcion: 'Zona sur, próxima a biblioteca y laboratorios',
      distancia: '7 min caminando',
    },
  ],
}

// Pasos del marcador animado (puntos intermedios de la ruta)
function generarRuta(desde: [number, number], hasta: [number, number], pasos = 20): [number, number][] {
  return Array.from({ length: pasos + 1 }, (_, i) => {
    const t = i / pasos
    return [
      desde[0] + (hasta[0] - desde[0]) * t,
      desde[1] + (hasta[1] - desde[1]) * t,
    ] as [number, number]
  })
}

type Paso = 'inicio' | 'entrada' | 'seleccion' | 'navegando' | 'llegada' | 'parqueado' | 'salida'

const VEHICULO_DEMO = {
  placa: 'SCZ-3456',
  propietario: 'Marcos Justiniano López',
  rol: 'Estudiante',
  marca: 'Toyota Corolla 2021',
}

export default function ParqueoDemo() {
  const mapRef     = useRef<any>(null)
  const markerRef  = useRef<any>(null)
  const lineaRef   = useRef<any>(null)
  const zonaMarks  = useRef<any[]>([])
  const mapDiv     = useRef<HTMLDivElement>(null)

  const [paso, setPaso]               = useState<Paso>('inicio')
  const [zonaSeleccionada, setZona]   = useState<typeof CAMPUS.zonas[0] | null>(null)
  const [progreso, setProgreso]       = useState(0)    // 0-100% de la ruta
  const [tiempoEstancia, setTiempo]   = useState(0)    // segundos estacionado
  const [horaEntrada, setHoraEntrada] = useState('')
  const [horaSalida, setHoraSalida]   = useState('')

  // ── Inicializar Leaflet ───────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapDiv.current) return

    import('leaflet').then(L => {
      // Fix iconos de Leaflet en Vite
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(mapDiv.current!, {
        center: CAMPUS.center,
        zoom:   CAMPUS.zoom,
        zoomControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      // Marcador de entrada
      const iconEntrada = L.divIcon({
        html: `<div style="background:#ef4444;color:white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:36px;height:36px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.4)">
                 <div style="transform:rotate(45deg);display:flex;align-items:center;justify-content:center;height:100%;font-size:14px">🏫</div>
               </div>`,
        className: '', iconSize: [36, 36], iconAnchor: [18, 36],
      })
      L.marker([CAMPUS.entrada.lat, CAMPUS.entrada.lng], { icon: iconEntrada })
        .addTo(map)
        .bindPopup(`<b>Entrada Principal Norte</b><br>Punto de control QR`)

      // Marcadores de zonas
      CAMPUS.zonas.forEach(zona => {
        const iconZona = L.divIcon({
          html: `<div style="background:${zona.color};color:white;border-radius:8px;padding:4px 8px;font-weight:bold;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,0.3);white-space:nowrap;border:2px solid white">
                   🅿 Zona ${zona.id} · ${zona.libres} libres
                 </div>`,
          className: '', iconSize: [120, 30], iconAnchor: [60, 15],
        })
        const m = L.marker([zona.lat, zona.lng], { icon: iconZona })
          .addTo(map)
          .bindPopup(`<b>${zona.nombre}</b><br>${zona.descripcion}<br><span style="color:green">${zona.libres} espacios libres</span>`)
        zonaMarks.current.push(m)
      })

      mapRef.current = map
    })

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // ── Animación del vehículo navegando ─────────────────────────────────────
  useEffect(() => {
    if (paso !== 'navegando' || !zonaSeleccionada || !mapRef.current) return

    import('leaflet').then(L => {
      const desde: [number, number] = [CAMPUS.entrada.lat, CAMPUS.entrada.lng]
      const hasta: [number, number] = [zonaSeleccionada.lat, zonaSeleccionada.lng]
      const ruta  = generarRuta(desde, hasta, 30)

      // Dibujar línea de ruta
      if (lineaRef.current) lineaRef.current.remove()
      lineaRef.current = L.polyline(ruta, {
        color: '#3b82f6', weight: 5, opacity: 0.8, dashArray: '10, 8',
      }).addTo(mapRef.current)

      // Icono del vehículo
      const iconCar = L.divIcon({
        html: `<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">🚗</div>`,
        className: '', iconSize: [32, 32], iconAnchor: [16, 16],
      })

      if (markerRef.current) markerRef.current.remove()
      markerRef.current = L.marker(ruta[0], { icon: iconCar }).addTo(mapRef.current)
      mapRef.current.flyTo(CAMPUS.center, 17, { duration: 1 })

      // Animar por los puntos de la ruta
      let idx = 0
      const intervalo = setInterval(() => {
        if (idx >= ruta.length) {
          clearInterval(intervalo)
          setPaso('llegada')
          return
        }
        markerRef.current?.setLatLng(ruta[idx])
        setProgreso(Math.round((idx / ruta.length) * 100))
        idx++
      }, 120)

      return () => clearInterval(intervalo)
    })
  }, [paso, zonaSeleccionada])

  // ── Contador de tiempo estacionado ────────────────────────────────────────
  useEffect(() => {
    if (paso !== 'parqueado') return
    const t = setInterval(() => setTiempo(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [paso])

  // ── Handlers ──────────────────────────────────────────────────────────────
  function simularEntrada() {
    const ahora = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
    setHoraEntrada(ahora)
    setPaso('entrada')
    setTimeout(() => setPaso('seleccion'), 1800)
  }

  function seleccionarZona(zona: typeof CAMPUS.zonas[0]) {
    setZona(zona)
    setPaso('navegando')
    setProgreso(0)
    mapRef.current?.flyTo([zona.lat, zona.lng], 18, { duration: 1.5 })
  }

  function confirmarLlegada() {
    setPaso('parqueado')
    setTiempo(0)
    if (markerRef.current && zonaSeleccionada) {
      mapRef.current?.flyTo([zonaSeleccionada.lat, zonaSeleccionada.lng], 19, { duration: 1 })
    }
  }

  function simularSalida() {
    const ahora = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
    setHoraSalida(ahora)
    markerRef.current?.remove()
    lineaRef.current?.remove()
    setPaso('salida')
  }

  function reiniciar() {
    markerRef.current?.remove()
    lineaRef.current?.remove()
    markerRef.current = null
    lineaRef.current  = null
    setPaso('inicio')
    setZona(null)
    setProgreso(0)
    setTiempo(0)
    setHoraEntrada('')
    setHoraSalida('')
    mapRef.current?.flyTo(CAMPUS.center, 17, { duration: 1 })
  }

  const minutos = Math.floor(tiempoEstancia / 60)
  const segundos = tiempoEstancia % 60

  return (
    <div className="flex flex-col h-full bg-slate-50">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 text-white shrink-0"
        style={{ background: 'linear-gradient(90deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-xl">
            <Navigation size={20} />
          </div>
          <div>
            <h1 className="font-bold text-sm sm:text-base">Guía de Parqueo UAGRM</h1>
            <p className="text-blue-200 text-xs flex items-center gap-1">
              <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">DEMO</span>
              Simulación para defensa académica
            </p>
          </div>
        </div>
        <button onClick={reiniciar}
          className="flex items-center gap-1.5 text-xs text-blue-200 hover:text-white border border-blue-400 px-3 py-1.5 rounded-lg transition-colors">
          <RotateCcw size={13} /> Reiniciar demo
        </button>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">

        {/* ── Panel izquierdo: flujo de pasos ── */}
        <div className="w-full lg:w-80 shrink-0 overflow-y-auto bg-white border-r border-slate-200 p-4 space-y-3">

          {/* Indicador de pasos */}
          <div className="flex items-center gap-1 mb-4">
            {(['inicio','entrada','seleccion','navegando','llegada','parqueado','salida'] as Paso[]).map((p, i) => (
              <div key={p} className={`flex-1 h-1.5 rounded-full transition-all ${
                ['inicio','entrada','seleccion','navegando','llegada','parqueado','salida'].indexOf(paso) >= i
                  ? 'bg-emerald-500' : 'bg-slate-200'
              }`} />
            ))}
          </div>

          {/* ── PASO: INICIO ── */}
          {paso === 'inicio' && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Vehículo demo</p>
                <p className="font-bold text-lg font-mono text-slate-800">{VEHICULO_DEMO.placa}</p>
                <p className="text-sm text-slate-600">{VEHICULO_DEMO.propietario}</p>
                <p className="text-xs text-slate-400">{VEHICULO_DEMO.marca} · {VEHICULO_DEMO.rol}</p>
              </div>
              <button onClick={simularEntrada}
                className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-2xl transition-colors shadow-lg shadow-orange-200 text-sm">
                <QrCode size={20} />
                Simular escaneo QR en entrada
              </button>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-semibold mb-1">¿Cómo funciona este demo?</p>
                <p>Toca el botón para simular que tu vehículo acaba de escanear el QR en la Entrada Principal Norte de la UAGRM.</p>
              </div>
            </div>
          )}

          {/* ── PASO: ENTRADA REGISTRADA ── */}
          {paso === 'entrada' && (
            <div className="space-y-3 animate-pulse">
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={24} className="text-white" />
                </div>
                <p className="font-bold text-emerald-800">¡Acceso autorizado!</p>
                <p className="text-sm text-emerald-600 mt-1">SCZ-3456 · {horaEntrada}</p>
                <p className="text-xs text-emerald-500 mt-1">Buscando zonas disponibles...</p>
              </div>
            </div>
          )}

          {/* ── PASO: SELECCIÓN DE ZONA ── */}
          {paso === 'seleccion' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <MapPin size={16} className="text-orange-500" />
                <p className="font-semibold text-slate-700 text-sm">Zonas disponibles para ti</p>
              </div>
              {CAMPUS.zonas.map(zona => (
                <button key={zona.id} onClick={() => seleccionarZona(zona)}
                  className="w-full text-left rounded-2xl border-2 border-slate-200 hover:border-emerald-400 p-3 transition-all hover:shadow-md group">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 ${zona.colorBg} rounded-xl flex items-center justify-center text-white font-black text-lg shrink-0`}>
                      {zona.id}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-xs leading-tight">{zona.nombre}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{zona.descripcion}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs text-emerald-600 font-semibold">{zona.libres} libres</span>
                        <span className="text-xs text-slate-400">{zona.distancia}</span>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 shrink-0 mt-2 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ── PASO: NAVEGANDO ── */}
          {paso === 'navegando' && zonaSeleccionada && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-300 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Navigation size={16} className="text-blue-600 animate-pulse" />
                  <p className="font-bold text-blue-800 text-sm">Navegando...</p>
                </div>
                <p className="text-xs text-blue-600 font-medium mb-3">Destino: {zonaSeleccionada.nombre}</p>
                <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                  <div className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progreso}%` }} />
                </div>
                <p className="text-xs text-blue-500 text-right">{progreso}% del recorrido</p>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-500 space-y-1">
                <p className="flex items-center gap-1.5"><span className="w-2 h-2 bg-green-500 rounded-full" /> Toma la vía principal hacia el Bloque Sur</p>
                <p className="flex items-center gap-1.5"><span className="w-2 h-2 bg-green-500 rounded-full" /> Gira a la izquierda en el edificio de Ingeniería</p>
                <p className="flex items-center gap-1.5"><span className="w-2 h-2 bg-amber-400 rounded-full" /> El parqueo estará a tu derecha</p>
              </div>
              <div className="text-center text-xs text-slate-400 flex items-center justify-center gap-1">
                <Wifi size={12} /> Guía en tiempo real activa
              </div>
            </div>
          )}

          {/* ── PASO: LLEGADA ── */}
          {paso === 'llegada' && zonaSeleccionada && (
            <div className="space-y-3">
              <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-4 text-center">
                <p className="text-3xl mb-2">📍</p>
                <p className="font-bold text-emerald-800">¡Llegaste a tu destino!</p>
                <p className="text-sm text-emerald-600 mt-1">{zonaSeleccionada.nombre}</p>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                <p className="font-semibold mb-1">Instrucción para el driver:</p>
                <p>Escanea el QR de la Zona {zonaSeleccionada.id} ubicado en el panel de entrada para confirmar tu espacio.</p>
              </div>
              <button onClick={confirmarLlegada}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-4 rounded-2xl transition-colors shadow-lg">
                <QrCode size={18} />
                Simular escaneo QR de Zona {zonaSeleccionada.id}
              </button>
            </div>
          )}

          {/* ── PASO: PARQUEADO ── */}
          {paso === 'parqueado' && zonaSeleccionada && (
            <div className="space-y-3">
              <div className="bg-slate-800 text-white rounded-2xl p-4">
                <p className="text-xs text-slate-400 uppercase mb-1">Vehículo parqueado</p>
                <p className="font-black text-2xl font-mono">{VEHICULO_DEMO.placa}</p>
                <p className="text-sm text-slate-300 mt-0.5">{zonaSeleccionada.nombre}</p>
                <div className="flex items-center gap-2 mt-3 bg-slate-700 rounded-xl p-2">
                  <Clock size={14} className="text-orange-400" />
                  <p className="font-mono text-orange-400 font-bold">
                    {String(minutos).padStart(2,'0')}:{String(segundos).padStart(2,'0')} estacionado
                  </p>
                </div>
                <p className="text-xs text-slate-400 mt-2">Entrada: {horaEntrada}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs">
                <p className="font-semibold text-emerald-700 mb-1">Notificación enviada al propietario:</p>
                <p className="text-emerald-600">"Tu vehículo {VEHICULO_DEMO.placa} está registrado en {zonaSeleccionada.nombre} desde las {horaEntrada}. Te avisaremos cuando debas salir."</p>
              </div>
              <button onClick={simularSalida}
                className="w-full flex items-center justify-center gap-2 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-2xl transition-colors">
                <Car size={18} />
                Simular salida del campus
              </button>
            </div>
          )}

          {/* ── PASO: SALIDA ── */}
          {paso === 'salida' && zonaSeleccionada && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-center">
                <p className="text-4xl mb-3">✅</p>
                <p className="font-bold text-slate-800">Sesión completada</p>
                <p className="text-sm text-slate-500 mt-1">Resumen de tu estadía</p>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Vehículo</span>
                  <span className="font-mono font-bold">{VEHICULO_DEMO.placa}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Zona</span>
                  <span className="font-medium">Zona {zonaSeleccionada.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Entrada</span>
                  <span className="font-medium text-emerald-600">{horaEntrada}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Salida</span>
                  <span className="font-medium text-red-500">{horaSalida}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-2">
                  <span className="text-slate-500">Duración</span>
                  <span className="font-bold text-orange-500">
                    {String(minutos).padStart(2,'0')}:{String(segundos).padStart(2,'0')} min
                  </span>
                </div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700">
                Zona {zonaSeleccionada.id} liberada automáticamente. {zonaSeleccionada.libres + 1} espacios disponibles.
              </div>
              <button onClick={reiniciar}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-2xl transition-colors">
                <RotateCcw size={16} /> Repetir demostración
              </button>
            </div>
          )}
        </div>

        {/* ── Mapa Leaflet (OpenStreetMap real) ── */}
        <div className="flex-1 relative min-h-64">
          <div ref={mapDiv} className="w-full h-full" style={{ minHeight: '400px' }} />

          {/* Overlay de estado sobre el mapa */}
          {paso === 'parqueado' && zonaSeleccionada && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-slate-900/90 text-white rounded-2xl px-4 py-2 flex items-center gap-2 text-sm backdrop-blur-sm">
              <Car size={16} className="text-orange-400" />
              <span className="font-mono font-bold">{VEHICULO_DEMO.placa}</span>
              <span className="text-slate-400">·</span>
              <span>Zona {zonaSeleccionada.id}</span>
              <span className="text-orange-400 font-mono">
                {String(minutos).padStart(2,'0')}:{String(segundos).padStart(2,'0')}
              </span>
            </div>
          )}

          {paso === 'navegando' && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]
              bg-blue-600 text-white rounded-2xl px-4 py-2 flex items-center gap-2 text-sm">
              <Navigation size={14} className="animate-pulse" />
              Navegando · {progreso}% del recorrido
            </div>
          )}

          {/* Leyenda */}
          <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 rounded-xl shadow-lg p-2.5 text-xs space-y-1 border border-slate-200">
            <p className="font-semibold text-slate-600 mb-1.5">Leyenda</p>
            {CAMPUS.zonas.map(z => (
              <div key={z.id} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: z.color }} />
                <span className="text-slate-600">Zona {z.id} · {z.libres} libres</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-1 border-t mt-1">
              <span className="text-red-500">📍</span>
              <span className="text-slate-600">Entrada Principal</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
