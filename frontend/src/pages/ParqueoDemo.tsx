/**
 * ParqueoDemo — Demo interactivo de guía de parqueo para defensa académica.
 *
 * Mapa ficticio del campus UAGRM con:
 *   - Vehículo arrastrable (mouse / dedo en tablet)
 *   - 3 zonas de parqueo con disponibilidad en tiempo real
 *   - Detección de proximidad: cuando el vehículo llega a la zona → pregunta si entra
 *   - Simulación completa: entrada → ruta → zona → confirmación → parqueado → salida
 *
 * Sin GPS real, sin mapa de internet — funciona 100% offline para la defensa.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Car, Navigation, CheckCircle2, XCircle, Clock,
  RotateCcw, Wifi, WifiOff, MapPin, Shield,
} from 'lucide-react'

// ── Geometría del campus ficticio ─────────────────────────────────────────
const W = 900  // ancho del canvas
const H = 580  // alto del canvas

const ENTRADA  = { x: 60,  y: 290, label: 'Entrada' }
const SALIDA   = { x: 840, y: 290, label: 'Salida'  }

const ZONAS = [
  {
    id: 'A', x: 160, y: 130, w: 130, h: 90,
    nombre: 'Zona A', sub: 'Bloque Administrativo',
    color: '#3b82f6', colorLight: '#dbeafe', colorBorder: '#93c5fd',
    libres: 8, total: 40,
    roles: 'Docentes / Admin',
    icono: '🏢',
  },
  {
    id: 'B', x: 160, y: 380, w: 130, h: 90,
    nombre: 'Zona B', sub: 'Bloque Facultades',
    color: '#22c55e', colorLight: '#dcfce7', colorBorder: '#86efac',
    libres: 23, total: 80,
    roles: 'Todos los usuarios',
    icono: '🎓',
  },
  {
    id: 'C', x: 640, y: 380, w: 130, h: 90,
    nombre: 'Zona C', sub: 'Biblioteca Central',
    color: '#f59e0b', colorLight: '#fef3c7', colorBorder: '#fcd34d',
    libres: 12, total: 50,
    roles: 'Todos los usuarios',
    icono: '📚',
  },
] as const

type ZonaId = 'A' | 'B' | 'C'
type ZonaEstado = 'libre' | 'recomendada' | 'ocupada'
type FlowState = 'esperando_entrada' | 'en_campus' | 'cerca_zona' | 'confirmando' | 'parqueado' | 'saliendo' | 'completado'

const RADIO_DETECCION = 70  // px — distancia para activar la detección

function distancia(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)
}

function centroDe(zona: typeof ZONAS[number]) {
  return { x: zona.x + zona.w / 2, y: zona.y + zona.h / 2 }
}

// Edificios del campus ficticio
const EDIFICIOS = [
  { x: 330, y:  80, w: 180, h: 100, label: 'Rectorado',   color: '#e2e8f0' },
  { x: 550, y:  80, w: 200, h: 100, label: 'Ing. Sistemas', color: '#e0f2fe' },
  { x: 330, y: 220, w: 180, h: 100, label: 'Medicina',     color: '#fce7f3' },
  { x: 550, y: 220, w: 200, h: 100, label: 'Derecho',      color: '#f0fdf4' },
  { x: 380, y: 380, w: 180, h: 100, label: 'Biblioteca',   color: '#fefce8' },
]

export default function ParqueoDemo() {
  const svgRef   = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Posición del vehículo (en coordenadas del SVG)
  const [car, setCar]             = useState({ x: ENTRADA.x + 20, y: ENTRADA.y })
  const [dragging, setDragging]   = useState(false)
  const [flow, setFlow]           = useState<FlowState>('esperando_entrada')
  const [zonaProxima, setZona]    = useState<ZonaId | null>(null)
  const [zonaParqueado, setZonaP] = useState<ZonaId | null>(null)
  const [estados, setEstados]     = useState<Record<ZonaId, ZonaEstado>>({
    A: 'libre', B: 'recomendada', C: 'libre',
  })
  const [segundos, setSegundos]   = useState(0)
  const [horaEntrada, setHoraE]   = useState('')
  const [horaSalida, setHoraS]    = useState('')

  // Conversión de coordenadas pantalla → SVG
  function screenToSvg(clientX: number, clientY: number) {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top)  * scaleY,
    }
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const startDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (flow === 'parqueado' || flow === 'completado') return
    e.preventDefault()
    setDragging(true)
    if (flow === 'esperando_entrada') {
      setFlow('en_campus')
      setHoraE(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    }
  }, [flow])

  const onMove = useCallback((clientX: number, clientY: number) => {
    if (!dragging) return
    const pos = screenToSvg(clientX, clientY)
    // Limitar dentro del canvas con margen
    const nx = Math.max(30, Math.min(W - 30, pos.x))
    const ny = Math.max(30, Math.min(H - 30, pos.y))
    setCar({ x: nx, y: ny })

    // Detectar zona próxima
    let cercana: ZonaId | null = null
    for (const z of ZONAS) {
      const c = centroDe(z)
      if (distancia(nx, ny, c.x, c.y) < RADIO_DETECCION) {
        cercana = z.id as ZonaId
        break
      }
    }

    // Detectar salida
    if (distancia(nx, ny, SALIDA.x, SALIDA.y) < 50 && flow === 'parqueado') {
      setFlow('saliendo')
    }

    if (cercana && flow === 'en_campus') {
      setZona(cercana)
      setFlow('cerca_zona')
    } else if (!cercana && flow === 'cerca_zona') {
      setZona(null)
      setFlow('en_campus')
    }
  }, [dragging, flow])

  const stopDrag = useCallback(() => { setDragging(false) }, [])

  // Mouse events
  const onMouseMove = useCallback((e: React.MouseEvent) => onMove(e.clientX, e.clientY), [onMove])
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    onMove(e.touches[0].clientX, e.touches[0].clientY)
  }, [onMove])

  // ── Confirmar entrada a zona ──────────────────────────────────────────────
  function confirmarZona() {
    if (!zonaProxima) return
    const centro = centroDe(ZONAS.find(z => z.id === zonaProxima)!)
    setCar({ x: centro.x, y: centro.y })
    setZonaP(zonaProxima)
    setEstados(e => ({ ...e, [zonaProxima]: 'ocupada' }))
    setFlow('parqueado')
    setSegundos(0)
  }

  function rechazarZona() {
    setZona(null)
    setFlow('en_campus')
  }

  // ── Salida del campus ─────────────────────────────────────────────────────
  function confirmarSalida() {
    if (!zonaParqueado) return
    setHoraS(new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' }))
    setEstados(e => ({ ...e, [zonaParqueado]: 'libre' }))
    setFlow('completado')
  }

  function reiniciar() {
    setCar({ x: ENTRADA.x + 20, y: ENTRADA.y })
    setFlow('esperando_entrada')
    setZona(null)
    setZonaP(null)
    setEstados({ A: 'libre', B: 'recomendada', C: 'libre' })
    setSegundos(0)
    setHoraE('')
    setHoraS('')
    setDragging(false)
  }

  // Contador de tiempo parqueado
  useEffect(() => {
    if (flow !== 'parqueado') return
    const t = setInterval(() => setSegundos(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [flow])

  const min = Math.floor(segundos / 60)
  const sec = segundos % 60

  // Color del vehículo según estado
  const carColor = flow === 'parqueado' ? '#22c55e' : flow === 'cerca_zona' ? '#f59e0b' : '#3b82f6'

  // Zona actualmente cerca
  const zonaCercaDatos = zonaProxima ? ZONAS.find(z => z.id === zonaProxima) : null
  const zonaParq       = zonaParqueado ? ZONAS.find(z => z.id === zonaParqueado) : null

  return (
    <div className="flex flex-col h-full bg-slate-900 overflow-hidden select-none">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ background: 'linear-gradient(90deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-xl"><Navigation size={18} /></div>
          <div>
            <h1 className="font-bold text-white text-sm">Guía de Parqueo Inteligente · UAGRM</h1>
            <p className="text-blue-300 text-xs flex items-center gap-1.5">
              <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse">DEMO</span>
              Arrastra el vehículo 🚗 hacia una zona de parqueo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1 text-xs text-emerald-400">
            <Wifi size={12} /> <span>Offline ready</span>
          </div>
          <button onClick={reiniciar}
            className="flex items-center gap-1.5 text-xs text-blue-200 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg transition-colors">
            <RotateCcw size={12} /> Reiniciar
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Mapa SVG interactivo ── */}
        <div
          ref={containerRef}
          className="flex-1 relative cursor-grab active:cursor-grabbing overflow-hidden"
          onMouseMove={onMouseMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          onTouchMove={onTouchMove}
          onTouchEnd={stopDrag}
          style={{ touchAction: 'none' }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-full"
            style={{ background: '#f8fafc' }}
          >
            {/* Fondo del campus */}
            <rect x={0} y={0} width={W} height={H} fill="#f1f5f9" />

            {/* Áreas verdes */}
            <rect x={310} y={60} width={560} height={460} rx={12} fill="#dcfce7" opacity={0.5} />
            <rect x={60}  y={60} width={230} height={460} rx={12} fill="#e0f2fe" opacity={0.4} />

            {/* Carreteras principales */}
            {/* Horizontal principal */}
            <rect x={0}   y={265} width={W}   height={50} fill="#94a3b8" rx={4} />
            {/* Vertical central */}
            <rect x={310} y={0}   width={50}  height={H}  fill="#94a3b8" rx={4} />
            {/* Vertical derecha */}
            <rect x={620} y={0}   width={50}  height={H}  fill="#94a3b8" rx={4} />
            {/* Horizontal superior */}
            <rect x={0}   y={60}  width={W}   height={30} fill="#cbd5e1" rx={2} />
            {/* Horizontal inferior */}
            <rect x={0}   y={490} width={W}   height={30} fill="#cbd5e1" rx={2} />

            {/* Líneas de carretera (centro) */}
            {[120, 240, 360, 480, 600, 720].map(x => (
              <rect key={x} x={x} y={286} width={60} height={8} rx={4} fill="white" opacity={0.7} />
            ))}

            {/* Edificios */}
            {EDIFICIOS.map((ed, i) => (
              <g key={i}>
                <rect x={ed.x} y={ed.y} width={ed.w} height={ed.h} rx={8} fill={ed.color} stroke="#cbd5e1" strokeWidth={1.5} />
                <text x={ed.x + ed.w / 2} y={ed.y + ed.h / 2 - 6} textAnchor="middle" fontSize={11} fill="#475569" fontWeight="600">{ed.label}</text>
                <text x={ed.x + ed.w / 2} y={ed.y + ed.h / 2 + 10} textAnchor="middle" fontSize={9} fill="#94a3b8">Edificio</text>
              </g>
            ))}

            {/* Zonas de parqueo */}
            {ZONAS.map(zona => {
              const est    = estados[zona.id as ZonaId]
              const ocup   = est === 'ocupada'
              const recom  = est === 'recomendada'
              const bgFill = ocup ? '#fee2e2' : recom ? '#dcfce7' : zona.colorLight
              const border = ocup ? '#ef4444' : recom ? '#22c55e' : zona.colorBorder
              const c      = centroDe(zona)
              const esProx = zonaProxima === zona.id && flow === 'cerca_zona'

              return (
                <g key={zona.id}>
                  {/* Círculo de detección pulsante */}
                  {esProx && (
                    <circle cx={c.x} cy={c.y} r={RADIO_DETECCION}
                      fill="none" stroke={zona.color} strokeWidth={2} strokeDasharray="8 4" opacity={0.6}>
                      <animate attributeName="r" values={`${RADIO_DETECCION};${RADIO_DETECCION + 10};${RADIO_DETECCION}`} dur="1.2s" repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.2s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Rectángulo de la zona */}
                  <rect x={zona.x} y={zona.y} width={zona.w} height={zona.h}
                    rx={10} fill={bgFill}
                    stroke={esProx ? zona.color : border}
                    strokeWidth={esProx ? 3 : 2}
                    style={{ filter: esProx ? 'drop-shadow(0 0 8px ' + zona.color + '80)' : 'none' }}
                  />

                  {/* Contenido de la zona */}
                  <text x={c.x} y={zona.y + 22} textAnchor="middle" fontSize={13} fill={zona.color} fontWeight="800">
                    {zona.icono} Zona {zona.id}
                  </text>
                  <text x={c.x} y={zona.y + 38} textAnchor="middle" fontSize={9} fill="#64748b">
                    {zona.sub}
                  </text>
                  {/* Badge disponibilidad */}
                  <rect x={c.x - 30} y={zona.y + 50} width={60} height={18} rx={9}
                    fill={ocup ? '#ef4444' : recom ? '#22c55e' : zona.color} />
                  <text x={c.x} y={zona.y + 63} textAnchor="middle" fontSize={10} fill="white" fontWeight="700">
                    {ocup ? 'OCUPADO' : `${zona.libres} libres`}
                  </text>
                  {/* Badge recomendado */}
                  {recom && !ocup && (
                    <>
                      <rect x={c.x - 38} y={zona.y + 72} width={76} height={14} rx={7} fill="#16a34a" />
                      <text x={c.x} y={zona.y + 82} textAnchor="middle" fontSize={9} fill="white" fontWeight="700">
                        ⭐ RECOMENDADA
                      </text>
                    </>
                  )}
                </g>
              )
            })}

            {/* Entrada del campus */}
            <g>
              <rect x={ENTRADA.x - 25} y={ENTRADA.y - 30} width={50} height={60} rx={6} fill="#1e40af" />
              <text x={ENTRADA.x} y={ENTRADA.y - 8}  textAnchor="middle" fontSize={16} fill="white">🏫</text>
              <text x={ENTRADA.x} y={ENTRADA.y + 8}  textAnchor="middle" fontSize={8}  fill="#93c5fd" fontWeight="700">ENTRADA</text>
              <text x={ENTRADA.x} y={ENTRADA.y + 18} textAnchor="middle" fontSize={7}  fill="#bfdbfe">Principal</text>
            </g>

            {/* Salida del campus */}
            <g>
              <rect x={SALIDA.x - 25} y={SALIDA.y - 30} width={50} height={60} rx={6} fill="#7f1d1d" />
              <text x={SALIDA.x} y={SALIDA.y - 8}  textAnchor="middle" fontSize={16} fill="white">🚪</text>
              <text x={SALIDA.x} y={SALIDA.y + 8}  textAnchor="middle" fontSize={8}  fill="#fca5a5" fontWeight="700">SALIDA</text>
              <text x={SALIDA.x} y={SALIDA.y + 18} textAnchor="middle" fontSize={7}  fill="#fecaca">Campus</text>
            </g>

            {/* Línea guía punteada hacia zona recomendada (solo cuando en campus) */}
            {(flow === 'en_campus' || flow === 'esperando_entrada') && (() => {
              const rec = ZONAS.find(z => estados[z.id as ZonaId] === 'recomendada')
              if (!rec) return null
              const c = centroDe(rec)
              return (
                <line x1={car.x} y1={car.y} x2={c.x} y2={c.y}
                  stroke="#22c55e" strokeWidth={2} strokeDasharray="12 6" opacity={0.5} />
              )
            })()}

            {/* Vehículo arrastrable */}
            <g
              transform={`translate(${car.x}, ${car.y})`}
              onMouseDown={startDrag}
              onTouchStart={startDrag}
              style={{ cursor: dragging ? 'grabbing' : 'grab' }}
            >
              {/* Sombra */}
              <ellipse cx={0} cy={14} rx={20} ry={6} fill="rgba(0,0,0,0.2)" />
              {/* Círculo de fondo */}
              <circle cx={0} cy={0} r={22} fill="white" stroke={carColor} strokeWidth={3}
                style={{ filter: `drop-shadow(0 2px 8px ${carColor}60)` }}>
                {dragging && <animate attributeName="r" values="22;24;22" dur="0.8s" repeatCount="indefinite" />}
              </circle>
              <text x={0} y={7} textAnchor="middle" fontSize={22}>🚗</text>
              {/* Placa */}
              <rect x={-28} y={24} width={56} height={14} rx={7} fill={carColor} />
              <text x={0} y={34} textAnchor="middle" fontSize={8} fill="white" fontWeight="800">SCZ-3456</text>
            </g>

            {/* Leyenda */}
            <g transform={`translate(${W - 145}, 10)`}>
              <rect x={0} y={0} width={135} height={80} rx={8} fill="white" opacity={0.9} stroke="#e2e8f0" />
              <text x={10} y={18} fontSize={9} fill="#475569" fontWeight="700">LEYENDA</text>
              {[
                { color: '#22c55e', label: 'Zona libre / Recomendada' },
                { color: '#ef4444', label: 'Zona ocupada' },
                { color: '#3b82f6', label: 'Zona disponible' },
              ].map((item, i) => (
                <g key={i} transform={`translate(10, ${28 + i * 17})`}>
                  <circle cx={6} cy={0} r={5} fill={item.color} />
                  <text x={16} y={4} fontSize={8} fill="#64748b">{item.label}</text>
                </g>
              ))}
            </g>
          </svg>

          {/* ── Overlay: modal de confirmación de zona ── */}
          {flow === 'cerca_zona' && zonaCercaDatos && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', zIndex: 10 }}>
              <div className="bg-white rounded-3xl shadow-2xl p-6 mx-4 max-w-sm w-full animate-bounce-top">
                <div className="text-center mb-4">
                  <span className="text-5xl">{zonaCercaDatos.icono}</span>
                  <h2 className="font-black text-xl text-slate-800 mt-2">{zonaCercaDatos.nombre}</h2>
                  <p className="text-slate-500 text-sm">{zonaCercaDatos.sub}</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-3 mb-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Espacios libres</span>
                    <span className="font-bold text-emerald-600">{zonaCercaDatos.libres} disponibles</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Para</span>
                    <span className="font-medium text-slate-700">{zonaCercaDatos.roles}</span>
                  </div>
                  {estados[zonaCercaDatos.id as ZonaId] === 'recomendada' && (
                    <div className="flex items-center gap-2 bg-emerald-50 rounded-xl px-3 py-2">
                      <span className="text-emerald-600 text-xs font-bold">⭐ Zona recomendada para tu perfil</span>
                    </div>
                  )}
                </div>
                <p className="text-center text-slate-600 text-sm mb-4 font-medium">
                  ¿Deseas estacionarte en esta zona?
                </p>
                <div className="flex gap-3">
                  <button onClick={rechazarZona}
                    className="flex-1 flex items-center justify-center gap-2 py-3 border-2 border-slate-200 text-slate-600 rounded-2xl font-semibold hover:bg-slate-50 transition-colors">
                    <XCircle size={18} /> No, seguir
                  </button>
                  <button onClick={confirmarZona}
                    className="flex-1 flex items-center justify-center gap-2 py-3 text-white rounded-2xl font-bold transition-colors shadow-lg"
                    style={{ background: zonaCercaDatos.color }}>
                    <CheckCircle2 size={18} /> Sí, estacionar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Overlay: parqueado — confirmar salida ── */}
          {flow === 'saliendo' && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(2px)', zIndex: 10 }}>
              <div className="bg-white rounded-3xl shadow-2xl p-6 mx-4 max-w-sm w-full">
                <div className="text-center mb-4">
                  <span className="text-5xl">🚪</span>
                  <h2 className="font-black text-xl text-slate-800 mt-2">¿Salir del campus?</h2>
                  <p className="text-slate-500 text-sm mt-1">El guardia registrará tu salida</p>
                </div>
                <div className="bg-slate-50 rounded-2xl p-3 mb-4 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Vehículo</span>
                    <span className="font-mono font-bold">SCZ-3456</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Zona usada</span>
                    <span className="font-medium">Zona {zonaParqueado}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tiempo</span>
                    <span className="font-bold text-orange-500">{String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}</span>
                  </div>
                </div>
                <button onClick={confirmarSalida}
                  className="w-full flex items-center justify-center gap-2 py-4 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold transition-colors">
                  <Car size={20} /> Confirmar salida
                </button>
              </div>
            </div>
          )}

          {/* ── Overlay: sesión completada ── */}
          {flow === 'completado' && (
            <div className="absolute inset-0 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', zIndex: 10 }}>
              <div className="bg-white rounded-3xl shadow-2xl p-6 mx-4 max-w-sm w-full text-center">
                <div className="text-5xl mb-3">✅</div>
                <h2 className="font-black text-2xl text-slate-800">Sesión completada</h2>
                <p className="text-slate-500 text-sm mt-1 mb-4">Resumen de tu estadía en el campus</p>
                <div className="bg-slate-50 rounded-2xl p-4 text-sm space-y-2 text-left mb-4">
                  {[
                    ['Vehículo', 'SCZ-3456', 'font-mono font-bold'],
                    ['Propietario', 'Marcos Justiniano', ''],
                    ['Zona utilizada', `Zona ${zonaParqueado} — ${zonaParq?.sub}`, 'font-medium'],
                    ['Entrada', horaEntrada, 'text-emerald-600 font-medium'],
                    ['Salida', horaSalida,  'text-red-500 font-medium'],
                    ['Duración', `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} min`, 'text-orange-500 font-bold'],
                  ].map(([k, v, cls]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-slate-500">{k}</span>
                      <span className={cls}>{v}</span>
                    </div>
                  ))}
                </div>
                <button onClick={reiniciar}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold transition-colors">
                  <RotateCcw size={16} /> Repetir demostración
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Panel lateral de instrucciones ── */}
        <div className="w-64 shrink-0 bg-slate-800 text-white overflow-y-auto p-4 hidden lg:flex flex-col gap-3">
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">Estado actual</p>

          {/* Estado del sistema */}
          <div className={`rounded-2xl p-3 text-xs ${
            flow === 'parqueado' ? 'bg-emerald-900 border border-emerald-700' :
            flow === 'cerca_zona' ? 'bg-amber-900 border border-amber-700' :
            'bg-slate-700 border border-slate-600'
          }`}>
            <p className="font-bold mb-1 text-sm">
              {flow === 'esperando_entrada' && '🏫 Esperando entrada'}
              {flow === 'en_campus'         && '🚗 En ruta — arrastra el vehículo'}
              {flow === 'cerca_zona'        && '📍 Zona detectada'}
              {flow === 'confirmando'       && '⏳ Confirmando...'}
              {flow === 'parqueado'         && '✅ Vehículo parqueado'}
              {flow === 'saliendo'          && '🚪 Hacia la salida'}
              {flow === 'completado'        && '🏁 Sesión completada'}
            </p>
            {horaEntrada && <p className="text-slate-300">Entrada: {horaEntrada}</p>}
            {flow === 'parqueado' && (
              <p className="text-orange-400 font-mono text-base font-bold mt-1">
                ⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
              </p>
            )}
          </div>

          {/* Zonas */}
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider">Zonas</p>
          {ZONAS.map(zona => {
            const est = estados[zona.id as ZonaId]
            return (
              <div key={zona.id} className="bg-slate-700 rounded-xl p-2.5 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold">{zona.icono} Zona {zona.id}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    est === 'ocupada'    ? 'bg-red-500'   :
                    est === 'recomendada'? 'bg-emerald-500':
                    'bg-slate-500'
                  }`}>
                    {est === 'ocupada' ? 'OCUPADA' : est === 'recomendada' ? 'REC.' : 'LIBRE'}
                  </span>
                </div>
                <p className="text-slate-400">{zona.sub}</p>
                <p className="text-slate-300 mt-0.5">{zona.libres} espacios libres</p>
              </div>
            )
          })}

          {/* Instrucciones */}
          <p className="text-xs font-bold uppercase text-slate-400 tracking-wider mt-1">Cómo usar</p>
          <div className="text-xs text-slate-400 space-y-2">
            {[
              '1. Arrastra el 🚗 desde la entrada',
              '2. Sigue la línea verde punteada hacia la zona recomendada',
              '3. Acércate a una zona — aparecerá el modal de confirmación',
              '4. Acepta o rechaza entrar',
              '5. Cuando quieras salir, arrastra el vehículo hacia la 🚪 Salida',
            ].map((t, i) => <p key={i}>{t}</p>)}
          </div>
          <div className="mt-auto pt-2 border-t border-slate-700 flex items-center gap-1.5 text-[10px] text-slate-500">
            <WifiOff size={10} /> Funciona sin internet · OpenStreetMap no requerido
          </div>
        </div>
      </div>
    </div>
  )
}
