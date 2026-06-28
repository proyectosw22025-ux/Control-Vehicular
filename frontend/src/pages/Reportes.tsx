/**
 * Reportes — Dashboard analítico profesional UAGRM
 * Diseño inspirado en paneles de analytics modernos:
 *   - KPI cards con sparklines en tiempo real
 *   - Area chart con gradiente animado (tendencia de accesos)
 *   - Donut + Gauge para infracciones
 *   - Stacked area para parqueo por zona
 *   - Filtros de período interactivos
 */
import { useState, useMemo } from 'react'
import { useQuery, gql } from '@apollo/client'
import { API_BASE } from '../config/endpoints'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell,
  ComposedChart, Line, RadialBarChart, RadialBar,
} from 'recharts'
import {
  FileDown, TrendingUp, TrendingDown, DoorOpen, AlertTriangle,
  ParkingSquare, Car, Calendar, RefreshCw, Download,
} from 'lucide-react'
import * as XLSX from 'xlsx'

// ── Helpers ────────────────────────────────────────────────
function descargarPDF(path: string) {
  const token = localStorage.getItem('access_token') ?? ''
  window.open(`${API_BASE}${path}?token=${encodeURIComponent(token)}`, '_blank')
}
function exportarExcel(datos: Record<string, unknown>[], nombre: string) {
  const ws = XLSX.utils.json_to_sheet(datos)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
  XLSX.writeFile(wb, `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
function bs(n: number) {
  return `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Paleta UAGRM ───────────────────────────────────────────
const C = {
  navy:    '#0a2a6e',
  gold:    '#e8951a',
  emerald: '#10b981',
  red:     '#ef4444',
  blue:    '#3b82f6',
  violet:  '#8b5cf6',
  cyan:    '#06b6d4',
  amber:   '#f59e0b',
  slate:   '#64748b',
}
const GRADIENT_ENTRADAS = 'urlGradEntradas'
const GRADIENT_SALIDAS  = 'urlGradSalidas'

// ── Queries ────────────────────────────────────────────────
const ACCESOS_Q = gql`query RA($dias:Int!){ reporteAccesos(dias:$dias){ fecha fechaIso entradas salidas total } }`
const INFRACCIONES_Q = gql`query RI{ reporteInfraccionesPorTipo{ tipoNombre cantidad montoTotal confirmadas registradas apeladas } reporteResumenSanciones{ totalSanciones montoTotalRecaudado montoTotalPendiente cumplidas pendientes enRevision canceladas } }`
const PARQUEO_Q = gql`query RP{ reporteOcupacionZonas{ zonaNombre totalEspacios disponibles ocupados reservados porcentajeOcupacion } }`
const VEHICULOS_Q = gql`query RV{ reporteVehiculosPorEstado{ nombre cantidad } reporteVehiculosPorTipo{ nombre cantidad } }`
const STATS_Q   = gql`query RS{ dashboardStats{ accesosHoy espaciosDisponibles totalEspacios sancionesPendientes montoSancionesPendientes totalVehiculos visitantesActivos } }`

// ── Tooltip personalizado ──────────────────────────────────
function TooltipCustom({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900/95 backdrop-blur border border-slate-700 rounded-xl px-4 py-3 shadow-2xl text-xs">
      <p className="text-slate-300 font-semibold mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="text-white font-bold">{p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── KPI Card con sparkline ─────────────────────────────────
function KpiCard({
  label, value, sub, trend, trendUp, color, sparkData, sparkKey,
}: {
  label: string; value: string | number; sub?: string
  trend?: string; trendUp?: boolean; color: string
  sparkData?: any[]; sparkKey?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 text-white"
      style={{ background: `linear-gradient(135deg, ${color}dd 0%, ${color}99 100%)` }}>
      {/* Fondo decorativo */}
      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-10 bg-white" />
      <div className="absolute -right-2 -bottom-4 w-16 h-16 rounded-full opacity-10 bg-white" />

      <p className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-1">{label}</p>
      <p className="text-3xl font-black leading-none">{value}</p>
      {sub && <p className="text-white/70 text-xs mt-1">{sub}</p>}

      {trend && (
        <div className="flex items-center gap-1 mt-2">
          {trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span className="text-xs font-medium">{trend}</span>
        </div>
      )}

      {/* Sparkline */}
      {sparkData && sparkKey && (
        <div className="absolute bottom-0 right-0 w-28 h-12 opacity-60">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`spark-${sparkKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ffffff" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey={sparkKey} stroke="#ffffff" strokeWidth={1.5}
                fill={`url(#spark-${sparkKey})`} isAnimationActive={true} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Gauge circular para ocupación ─────────────────────────
function GaugeOcupacion({ pct, label }: { pct: number; label: string }) {
  const color = pct > 80 ? C.red : pct > 60 ? C.amber : C.emerald
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="50%" innerRadius="65%" outerRadius="100%"
            startAngle={225} endAngle={-45} data={[{ value: pct, fill: color }]}>
            <RadialBar dataKey="value" cornerRadius={6} background={{ fill: '#f1f5f9' }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-black" style={{ color }}>{pct}%</span>
        </div>
      </div>
      <p className="text-xs text-slate-500 text-center leading-tight max-w-[80px]">{label}</p>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────
export default function Reportes() {
  const [dias, setDias]     = useState(30)
  const [seccion, setSeccion] = useState<'accesos' | 'infracciones' | 'parqueo' | 'vehiculos'>('accesos')

  const { data: statsData } = useQuery(STATS_Q, { pollInterval: 60_000, fetchPolicy: 'cache-and-network' })
  const { data: accData, loading: accLoad, refetch: refetchAcc } = useQuery(ACCESOS_Q, { variables: { dias }, fetchPolicy: 'cache-and-network' })
  const { data: infData, loading: infLoad } = useQuery(INFRACCIONES_Q, { fetchPolicy: 'cache-and-network' })
  const { data: pqData,   loading: pqLoad   } = useQuery(PARQUEO_Q, { fetchPolicy: 'cache-and-network' })
  const { data: vehData,  loading: vehLoad  } = useQuery(VEHICULOS_Q, { fetchPolicy: 'cache-and-network' })

  const stats  = statsData?.dashboardStats
  const accesos = accData?.reporteAccesos ?? []
  const resumen = infData?.reporteResumenSanciones
  const infraccionesTipo = infData?.reporteInfraccionesPorTipo ?? []
  const zonas  = pqData?.reporteOcupacionZonas ?? []
  const porEstado = vehData?.reporteVehiculosPorEstado ?? []
  const porTipo   = vehData?.reporteVehiculosPorTipo ?? []

  const totalEntradas = useMemo(() => accesos.reduce((s: number, f: any) => s + f.entradas, 0), [accesos])
  const totalSalidas  = useMemo(() => accesos.reduce((s: number, f: any) => s + f.salidas, 0), [accesos])
  const pctOcupGlobal = useMemo(() => {
    if (!zonas.length) return 0
    const tot = zonas.reduce((s: number, z: any) => s + z.totalEspacios, 0)
    const ocu = zonas.reduce((s: number, z: any) => s + z.ocupados, 0)
    return tot > 0 ? Math.round(ocu / tot * 100) : 0
  }, [zonas])

  const SECCIONES = [
    { id: 'accesos',  icon: DoorOpen,      label: 'Accesos' },
    { id: 'infracciones', icon: AlertTriangle, label: 'Infracciones' },
    { id: 'parqueo',  icon: ParkingSquare,  label: 'Parqueos' },
    { id: 'vehiculos',icon: Car,            label: 'Vehículos' },
  ] as const

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            <TrendingUp size={24} className="text-blue-600" />
            Analytics
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Panel de análisis — Sistema Vehicular UAGRM
          </p>
        </div>

        {/* Controles globales */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
            <Calendar size={14} className="text-slate-400 ml-2" />
            {[
              { v: 7, l: '7D' }, { v: 30, l: '30D' }, { v: 90, l: '90D' },
            ].map(({ v, l }) => (
              <button key={v} onClick={() => { setDias(v); refetchAcc() }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  dias === v ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => refetchAcc()}
            className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors">
            <RefreshCw size={15} />
          </button>
          <button onClick={() => descargarPDF('/api/pdf/sesiones/')}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs px-3 py-2 rounded-xl transition-colors font-medium">
            <Download size={13} /> PDF
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Accesos en el período"
          value={totalEntradas.toLocaleString()}
          sub={`${totalSalidas.toLocaleString()} salidas registradas`}
          trend={`${dias} días analizados`}
          trendUp
          color={C.navy}
          sparkData={accesos.slice(-10)}
          sparkKey="entradas"
        />
        <KpiCard
          label="Ocupación del parqueo"
          value={`${pctOcupGlobal}%`}
          sub={`${stats?.espaciosDisponibles ?? '—'} / ${stats?.totalEspacios ?? '—'} disponibles`}
          trend={pctOcupGlobal > 80 ? 'Parqueo casi lleno' : 'Capacidad disponible'}
          trendUp={pctOcupGlobal <= 80}
          color={pctOcupGlobal > 80 ? C.red : C.emerald}
          sparkData={zonas.map((z: any) => ({ v: z.porcentajeOcupacion }))}
          sparkKey="v"
        />
        <KpiCard
          label="Sanciones pendientes"
          value={bs(resumen?.montoTotalPendiente ?? 0)}
          sub={`${resumen?.pendientes ?? 0} sanciones sin pagar`}
          trend={`${resumen?.cumplidas ?? 0} cumplidas | ${resumen?.enRevision ?? 0} en revisión`}
          trendUp={false}
          color={C.gold}
          sparkData={infraccionesTipo.map((m: any) => ({ v: m.registradas }))}
          sparkKey="v"
        />
        <KpiCard
          label="Vehículos activos"
          value={stats?.totalVehiculos ?? '—'}
          sub={`${stats?.visitantesActivos ?? 0} visitantes en campus`}
          trend="Total en el sistema"
          trendUp
          color={C.violet}
          sparkData={porEstado.map((e: any) => ({ v: e.cantidad }))}
          sparkKey="v"
        />
      </div>

      {/* ── Selector de sección ── */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {SECCIONES.map(({ id, icon: Icon, label }) => (
          <button key={id}
            onClick={() => setSeccion(id as typeof seccion)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
              seccion === id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* ══ SECCIÓN: ACCESOS ══ */}
      {seccion === 'accesos' && (
        <div className="space-y-5 animate-fade-slide-up">

          {/* Gráfico de área principal */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-bold text-slate-800">Tendencia de Accesos</h2>
                <p className="text-xs text-slate-400 mt-0.5">Entradas y salidas vehiculares al campus</p>
              </div>
              <button onClick={() => exportarExcel(
                accesos.map((f: any) => ({ Fecha: f.fechaIso, Entradas: f.entradas, Salidas: f.salidas, Total: f.total })),
                'accesos'
              )} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                <Download size={12} /> Excel
              </button>
            </div>
            {accLoad ? <div className="h-72 bg-slate-50 rounded-xl animate-pulse" /> : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={accesos} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradEntradas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.navy}  stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.navy}  stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradSalidas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={C.gold}  stopOpacity={0.25} />
                      <stop offset="95%" stopColor={C.gold}  stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <Tooltip content={<TooltipCustom />} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
                  <Area type="monotone" dataKey="entradas" name="Entradas" stroke={C.navy} strokeWidth={2.5}
                    fill="url(#gradEntradas)" isAnimationActive dot={false} activeDot={{ r: 5, fill: C.navy }} />
                  <Area type="monotone" dataKey="salidas" name="Salidas" stroke={C.gold} strokeWidth={2}
                    fill="url(#gradSalidas)" isAnimationActive dot={false} activeDot={{ r: 5, fill: C.gold }} />
                  <Line type="monotone" dataKey="total" name="Total" stroke={C.cyan} strokeWidth={1.5}
                    strokeDasharray="4 3" dot={false} isAnimationActive />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stats de accesos */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { l: 'Total entradas', v: totalEntradas.toLocaleString(), c: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
              { l: 'Total salidas',  v: totalSalidas.toLocaleString(),  c: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
              { l: 'Pico del período', v: accesos.reduce((m: any, f: any) => f.total > (m?.total ?? 0) ? f : m, null)?.total?.toLocaleString() ?? '—', c: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
            ].map(({ l, v, c, bg }) => (
              <div key={l} className={`${bg} border rounded-2xl p-4`}>
                <p className="text-xs text-slate-500 font-medium">{l}</p>
                <p className={`text-2xl font-black ${c} mt-1`}>{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ SECCIÓN: INFRACCIONES ══ */}
      {seccion === 'infracciones' && (
        <div className="space-y-5 animate-fade-slide-up">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

            {/* Barras horizontales por tipo */}
            <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-slate-800">Infracciones por tipo</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Cantidad y monto recaudado por categoría</p>
                </div>
                <button onClick={() => exportarExcel(
                  infraccionesTipo.map((m: any) => ({ Tipo: m.tipoNombre, Total: m.cantidad, Monto: m.montoTotal, Confirmadas: m.confirmadas, Registradas: m.registradas, Apeladas: m.apeladas })),
                  'infracciones_tipo'
                )} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                  <Download size={12} /> Excel
                </button>
              </div>
              {infLoad ? <div className="h-64 bg-slate-50 rounded-xl animate-pulse" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={infraccionesTipo} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="tipoNombre" width={140}
                      tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<TooltipCustom />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="confirmadas" name="Confirmadas" fill={C.emerald} radius={[0, 4, 4, 0]} stackId="a" isAnimationActive />
                    <Bar dataKey="registradas" name="Registradas" fill={C.amber} radius={[0, 0, 0, 0]} stackId="a" isAnimationActive />
                    <Bar dataKey="apeladas" name="Apeladas" fill={C.blue} radius={[0, 4, 4, 0]} stackId="a" isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Donut + resumen */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <h2 className="font-bold text-slate-800 mb-1">Estado de sanciones</h2>
              <p className="text-xs text-slate-400 mb-4">Distribución de {resumen?.totalSanciones ?? 0} sanciones</p>
              {infLoad ? <div className="h-48 bg-slate-50 rounded-xl animate-pulse" /> : (
                <>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Cumplidas', value: resumen?.cumplidas  ?? 0, fill: C.emerald },
                          { name: 'Pendientes',value: resumen?.pendientes ?? 0, fill: C.amber },
                          { name: 'En revisión', value: resumen?.enRevision ?? 0, fill: C.blue },
                          { name: 'Canceladas',value: resumen?.canceladas ?? 0, fill: C.slate },
                        ]}
                        cx="50%" cy="50%"
                        innerRadius={50} outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                        isAnimationActive
                      >
                        {[C.emerald, C.amber, C.blue, C.slate].map((c, i) => (
                          <Cell key={i} fill={c} />
                        ))}
                      </Pie>
                      <Tooltip content={<TooltipCustom />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-3 space-y-2">
                    {[
                      { l: 'Recaudado', v: bs(resumen?.montoTotalRecaudado ?? 0), c: 'text-emerald-600' },
                      { l: 'Pendiente', v: bs(resumen?.montoTotalPendiente ?? 0), c: 'text-amber-600' },
                    ].map(({ l, v, c }) => (
                      <div key={l} className="flex justify-between text-xs">
                        <span className="text-slate-500">{l}</span>
                        <span className={`font-bold ${c}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ SECCIÓN: PARQUEO ══ */}
      {seccion === 'parqueo' && (
        <div className="space-y-5 animate-fade-slide-up">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Gauges de ocupación */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <h2 className="font-bold text-slate-800 mb-1">Ocupación por zona</h2>
              <p className="text-xs text-slate-400 mb-5">Estado actual del parqueo universitario</p>
              {pqLoad ? <div className="h-48 bg-slate-50 rounded-xl animate-pulse" /> : (
                <div className="flex flex-wrap gap-6 justify-center">
                  {zonas.map((z: any) => (
                    <GaugeOcupacion key={z.zonaNombre} pct={z.porcentajeOcupacion} label={z.zonaNombre.split('—')[0].trim()} />
                  ))}
                </div>
              )}
            </div>

            {/* Stacked bar por zona */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-slate-800">Distribución de espacios</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Disponibles · Ocupados · Reservados</p>
                </div>
                <button onClick={() => exportarExcel(
                  zonas.map((z: any) => ({ Zona: z.zonaNombre, Total: z.totalEspacios, Disponibles: z.disponibles, Ocupados: z.ocupados, Reservados: z.reservados })),
                  'parqueo_zonas'
                )} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                  <Download size={12} /> Excel
                </button>
              </div>
              {pqLoad ? <div className="h-48 bg-slate-50 rounded-xl animate-pulse" /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={zonas.map((z: any) => ({ ...z, zona: z.zonaNombre.split('—')[0].trim().replace('Zona ', 'Z') }))}
                    margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="zona" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<TooltipCustom />} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    <Bar dataKey="disponibles" name="Disponibles" fill={C.emerald} radius={[0,0,0,0]} stackId="a" isAnimationActive />
                    <Bar dataKey="reservados"  name="Reservados"  fill={C.blue}    radius={[0,0,0,0]} stackId="a" isAnimationActive />
                    <Bar dataKey="ocupados"    name="Ocupados"    fill={C.red}     radius={[4,4,0,0]} stackId="a" isAnimationActive />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tabla de zonas */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">Detalle por zona</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  {['Zona', 'Total', 'Disponibles', 'Ocupados', 'Reservados', 'Ocupación'].map(h => (
                    <th key={h} className="px-5 py-3 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {zonas.map((z: any) => (
                  <tr key={z.zonaNombre} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-700">{z.zonaNombre.split('—')[0].trim()}</td>
                    <td className="px-5 py-3 text-slate-600">{z.totalEspacios}</td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">{z.disponibles}</span></td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-xs font-medium">{z.ocupados}</span></td>
                    <td className="px-5 py-3"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">{z.reservados}</span></td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${z.porcentajeOcupacion}%`, background: z.porcentajeOcupacion > 80 ? C.red : z.porcentajeOcupacion > 60 ? C.amber : C.emerald }} />
                        </div>
                        <span className="text-xs font-bold text-slate-700 w-9 text-right">{z.porcentajeOcupacion}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ SECCIÓN: VEHÍCULOS ══ */}
      {seccion === 'vehiculos' && (
        <div className="space-y-5 animate-fade-slide-up">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Por estado */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <h2 className="font-bold text-slate-800 mb-1">Por estado</h2>
              <p className="text-xs text-slate-400 mb-5">Distribución por estado en el sistema</p>
              {vehLoad ? <div className="h-56 bg-slate-50 rounded-xl animate-pulse" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={porEstado} cx="50%" cy="50%"
                      innerRadius={60} outerRadius={90}
                      paddingAngle={4} dataKey="cantidad" nameKey="nombre"
                      label={({ nombre, percent }: any) => `${nombre} ${(percent * 100).toFixed(0)}%`}
                      labelLine={{ stroke: '#cbd5e1' }}
                      isAnimationActive>
                      {porEstado.map((_: any, i: number) => (
                        <Cell key={i} fill={[C.emerald, C.slate, C.red, C.amber][i % 4]} />
                      ))}
                    </Pie>
                    <Tooltip content={<TooltipCustom />} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Por tipo */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-bold text-slate-800">Por tipo de vehículo</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Flota vehicular registrada</p>
                </div>
                <button onClick={() => exportarExcel(
                  [...porEstado.map((e: any) => ({ Tipo: 'Estado', Nombre: e.nombre, Cantidad: e.cantidad })),
                   ...porTipo.map((t: any) => ({ Tipo: 'Vehículo', Nombre: t.nombre, Cantidad: t.cantidad }))],
                  'vehiculos'
                )} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                  <Download size={12} /> Excel
                </button>
              </div>
              {vehLoad ? <div className="h-48 bg-slate-50 rounded-xl animate-pulse" /> : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={porTipo} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradVeh" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.navy} stopOpacity={0.9} />
                        <stop offset="95%" stopColor={C.blue} stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="nombre" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<TooltipCustom />} />
                    <Bar dataKey="cantidad" name="Vehículos" fill="url(#gradVeh)" radius={[6, 6, 0, 0]} isAnimationActive>
                      {porTipo.map((_: any, i: number) => (
                        <Cell key={i} fill={[C.navy, C.blue, C.cyan, C.violet, C.emerald][i % 5]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Cards de resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {porEstado.map((e: any, i: number) => {
              const colores = [
                { bg: 'bg-emerald-50 border-emerald-200', t: 'text-emerald-700' },
                { bg: 'bg-slate-50 border-slate-200', t: 'text-slate-700' },
                { bg: 'bg-red-50 border-red-200', t: 'text-red-700' },
                { bg: 'bg-amber-50 border-amber-200', t: 'text-amber-700' },
              ]
              const { bg, t } = colores[i % 4]
              return (
                <div key={e.nombre} className={`${bg} border rounded-2xl p-4`}>
                  <p className="text-xs text-slate-500 font-medium capitalize">{e.nombre}</p>
                  <p className={`text-2xl font-black ${t} mt-1`}>{e.cantidad}</p>
                  <p className="text-xs text-slate-400 mt-0.5">vehículos</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Export footer ── */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <p className="text-xs text-slate-400">
          Datos actualizados en tiempo real · UAGRM Control Vehicular 2026
        </p>
        <div className="flex gap-2">
          {[
            { l: 'PDF Accesos',    fn: () => descargarPDF('/api/pdf/sesiones/') },
            { l: 'PDF Infracciones', fn: () => descargarPDF('/api/pdf/infracciones/') },
            { l: 'PDF Visitantes', fn: () => descargarPDF('/api/pdf/visitas/') },
            { l: 'PDF Vehículos',  fn: () => descargarPDF('/api/pdf/vehiculos/') },
          ].map(({ l, fn }) => (
            <button key={l} onClick={fn}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
              <FileDown size={11} /> {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
