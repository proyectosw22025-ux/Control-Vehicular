import { useState } from 'react'
import { useQuery, gql } from '@apollo/client'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts'
import { FileDown, Printer, BarChart2, AlertTriangle, ParkingSquare, Car, TrendingUp } from 'lucide-react'
import * as XLSX from 'xlsx'

// ── Queries ────────────────────────────────────────────────

const REPORTE_ACCESOS_QUERY = gql`
  query ReporteAccesos($dias: Int!) {
    reporteAccesos(dias: $dias) { fecha fechaIso entradas salidas total }
  }
`
const REPORTE_MULTAS_QUERY = gql`
  query ReporteMultas {
    reporteMultasPorTipo { tipoNombre cantidad montoTotal pagadas pendientes apeladas }
    reporteResumenMultas  { totalMultas montoTotalRecaudado montoTotalPendiente pagadas pendientes apeladas canceladas }
  }
`
const REPORTE_PARQUEOS_QUERY = gql`
  query ReporteParqueos {
    reporteOcupacionZonas { zonaNombre ubicacion totalEspacios disponibles ocupados reservados mantenimiento porcentajeOcupacion }
  }
`
const REPORTE_VEHICULOS_QUERY = gql`
  query ReporteVehiculos {
    reporteVehiculosPorTipo   { nombre cantidad }
    reporteVehiculosPorEstado { nombre cantidad }
  }
`

// ── Paleta de colores ──────────────────────────────────────
const COLORES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316']

// ── Helpers ────────────────────────────────────────────────
function bs(n: number) { return `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

function exportarExcel(datos: Record<string, unknown>[], nombre: string) {
  const ws = XLSX.utils.json_to_sheet(datos)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Reporte')
  XLSX.writeFile(wb, `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`)
}

// ── Componentes reutilizables ──────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-2xl" />)}
      </div>
      <div className="h-64 bg-slate-100 rounded-2xl" />
      <div className="h-48 bg-slate-100 rounded-2xl" />
    </div>
  )
}

function StatCard({ label, value, sub, color = 'border-slate-200' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border-l-4 ${color} p-5`}>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-sm font-medium text-slate-600 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">{children}</h3>
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition-all ${
        active
          ? 'bg-slate-800 text-white shadow-sm'
          : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  )
}

// ── Tab: Accesos ───────────────────────────────────────────
function TabAccesos() {
  const [dias, setDias] = useState(30)
  const { data, loading } = useQuery(REPORTE_ACCESOS_QUERY, { variables: { dias }, fetchPolicy: 'cache-and-network' })

  const filas: { fecha: string; fechaIso: string; entradas: number; salidas: number; total: number }[] = data?.reporteAccesos ?? []

  const totalEntradas = filas.reduce((s, f) => s + f.entradas, 0)
  const totalSalidas  = filas.reduce((s, f) => s + f.salidas, 0)
  const picoDia       = filas.reduce((max, f) => f.total > max.total ? f : max, { fecha: '—', total: 0, entradas: 0, salidas: 0, fechaIso: '' })

  function exportar() {
    exportarExcel(
      filas.map(f => ({ Fecha: f.fechaIso, Entradas: f.entradas, Salidas: f.salidas, Total: f.total })),
      'reporte_accesos'
    )
  }

  return (
    <div className="space-y-6">
      {/* Controles */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">Período:</span>
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setDias(d)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${dias === d ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {d} días
            </button>
          ))}
        </div>
        <button onClick={exportar} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl transition-colors">
          <FileDown size={15} /> Exportar Excel
        </button>
      </div>

      {loading ? <Skeleton /> : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total entradas" value={totalEntradas} sub={`en ${dias} días`} color="border-emerald-400" />
            <StatCard label="Total salidas"  value={totalSalidas}  sub={`en ${dias} días`} color="border-amber-400" />
            <StatCard label="Día con más actividad" value={picoDia.fecha} sub={`${picoDia.total} movimientos`} color="border-blue-400" />
          </div>

          {/* Gráfico */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <SectionTitle>Accesos por día</SectionTitle>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={filas} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} barSize={dias <= 7 ? 28 : dias <= 30 ? 12 : 6}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#94a3b8' }} interval={dias <= 7 ? 0 : dias <= 30 ? 4 : 9} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="salidas"  name="Salidas"  fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <SectionTitle><span className="px-6 pt-5 block">Detalle por día</span></SectionTitle>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  {['Fecha', 'Entradas', 'Salidas', 'Total'].map(h => (
                    <th key={h} className="px-6 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filas.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400">Sin registros en este período</td></tr>
                ) : filas.map(f => (
                  <tr key={f.fechaIso} className={`hover:bg-slate-50 transition-colors ${f.total === picoDia.total && f.total > 0 ? 'bg-blue-50/40' : ''}`}>
                    <td className="px-6 py-3 font-medium text-slate-700">{f.fechaIso}</td>
                    <td className="px-6 py-3 text-emerald-600 font-medium">{f.entradas}</td>
                    <td className="px-6 py-3 text-amber-600 font-medium">{f.salidas}</td>
                    <td className="px-6 py-3 font-bold text-slate-800">{f.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab: Multas ────────────────────────────────────────────
function TabMultas() {
  const { data, loading } = useQuery(REPORTE_MULTAS_QUERY, { fetchPolicy: 'cache-and-network' })

  const tipos  = data?.reporteMultasPorTipo  ?? []
  const resumen = data?.reporteResumenMultas

  function exportar() {
    exportarExcel(
      tipos.map((t: typeof tipos[0]) => ({
        'Tipo de multa': t.tipoNombre,
        'Cantidad':      t.cantidad,
        'Monto total (Bs)': t.montoTotal,
        'Pagadas':       t.pagadas,
        'Pendientes':    t.pendientes,
        'Apeladas':      t.apeladas,
      })),
      'reporte_multas'
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={exportar} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl transition-colors">
          <FileDown size={15} /> Exportar Excel
        </button>
      </div>

      {loading ? <Skeleton /> : (
        <>
          {/* Resumen */}
          {resumen && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total multas" value={resumen.totalMultas} color="border-slate-300" />
              <StatCard label="Recaudado"    value={bs(resumen.montoTotalRecaudado)} color="border-emerald-400" sub="pagado" />
              <StatCard label="Pendiente"    value={bs(resumen.montoTotalPendiente)} color="border-red-400" sub="por cobrar" />
              <StatCard label="En apelación" value={resumen.apeladas} color="border-amber-400" sub="sin resolver" />
            </div>
          )}

          {tipos.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <AlertTriangle size={40} className="mx-auto mb-3 opacity-20" />
              <p>Sin multas registradas en el sistema</p>
            </div>
          ) : (
            <>
              {/* Gráfico */}
              <div className="bg-white rounded-2xl shadow-sm p-6">
                <SectionTitle>Multas por tipo de infracción</SectionTitle>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={tipos} layout="vertical" margin={{ left: 20, right: 30, top: 5, bottom: 5 }} barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <YAxis type="category" dataKey="tipoNombre" tick={{ fontSize: 11, fill: '#64748b' }} width={200} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="pagadas"   name="Pagadas"   fill="#10b981" radius={[0, 4, 4, 0]} stackId="a" />
                    <Bar dataKey="pendientes" name="Pendientes" fill="#ef4444" radius={[0, 4, 4, 0]} stackId="a" />
                    <Bar dataKey="apeladas"  name="Apeladas"  fill="#f59e0b" radius={[0, 4, 4, 0]} stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabla */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      {['Infracción', 'Total', 'Monto total', 'Pagadas', 'Pendientes', 'Apeladas'].map(h => (
                        <th key={h} className="px-5 py-3 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tipos.map((t: any) => (
                      <tr key={t.tipoNombre} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-700 max-w-xs">{t.tipoNombre}</td>
                        <td className="px-5 py-3 font-bold text-slate-800">{t.cantidad}</td>
                        <td className="px-5 py-3 text-slate-700">{bs(t.montoTotal)}</td>
                        <td className="px-5 py-3 text-emerald-600 font-medium">{t.pagadas}</td>
                        <td className="px-5 py-3 text-red-600 font-medium">{t.pendientes}</td>
                        <td className="px-5 py-3 text-amber-600 font-medium">{t.apeladas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Tab: Parqueos ──────────────────────────────────────────
function TabParqueos() {
  const { data, loading } = useQuery(REPORTE_PARQUEOS_QUERY, { fetchPolicy: 'cache-and-network' })
  const zonas = data?.reporteOcupacionZonas ?? []
  const totalEspacios   = zonas.reduce((s: number, z: any) => s + z.totalEspacios, 0)
  const totalDisponibles = zonas.reduce((s: number, z: any) => s + z.disponibles, 0)
  const pctGlobal = totalEspacios > 0 ? Math.round(((totalEspacios - totalDisponibles) / totalEspacios) * 100) : 0

  function exportar() {
    exportarExcel(
      zonas.map((z: any) => ({
        'Zona': z.zonaNombre, 'Ubicación': z.ubicacion,
        'Total': z.totalEspacios, 'Disponibles': z.disponibles,
        'Ocupados': z.ocupados, 'Reservados': z.reservados,
        'Mantenimiento': z.mantenimiento, '% Ocupación': z.porcentajeOcupacion,
      })),
      'reporte_parqueos'
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={exportar} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl transition-colors">
          <FileDown size={15} /> Exportar Excel
        </button>
      </div>

      {loading ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total espacios" value={totalEspacios} color="border-violet-400" />
            <StatCard label="Disponibles ahora" value={totalDisponibles} sub="en todas las zonas" color="border-emerald-400" />
            <StatCard label="Ocupación global" value={`${pctGlobal}%`} sub={`${totalEspacios - totalDisponibles} ocupados`} color={pctGlobal > 80 ? 'border-red-400' : 'border-blue-400'} />
          </div>

          {/* Barras de ocupación por zona */}
          <div className="bg-white rounded-2xl shadow-sm p-6 space-y-5">
            <SectionTitle>Ocupación por zona</SectionTitle>
            {zonas.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">Sin zonas configuradas</p>
            ) : zonas.map((z: any) => (
              <div key={z.zonaNombre}>
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <span className="text-sm font-semibold text-slate-700">{z.zonaNombre}</span>
                    <span className="text-xs text-slate-400 ml-2">{z.ubicacion}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-800">{z.ocupados}/{z.totalEspacios}</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-red-400 transition-all"    style={{ width: `${(z.ocupados / z.totalEspacios) * 100}%` }} title={`Ocupados: ${z.ocupados}`} />
                  <div className="h-full bg-amber-300 transition-all"  style={{ width: `${(z.reservados / z.totalEspacios) * 100}%` }} title={`Reservados: ${z.reservados}`} />
                  <div className="h-full bg-slate-300 transition-all"  style={{ width: `${(z.mantenimiento / z.totalEspacios) * 100}%` }} title={`Mantenimiento: ${z.mantenimiento}`} />
                </div>
                <div className="flex gap-3 mt-1">
                  <span className="text-xs text-emerald-600">✓ {z.disponibles} libre{z.disponibles !== 1 ? 's' : ''}</span>
                  <span className="text-xs text-red-500">{z.ocupados} ocupado{z.ocupados !== 1 ? 's' : ''}</span>
                  {z.reservados > 0 && <span className="text-xs text-amber-500">{z.reservados} reservado{z.reservados !== 1 ? 's' : ''}</span>}
                  {z.mantenimiento > 0 && <span className="text-xs text-slate-400">{z.mantenimiento} en mant.</span>}
                </div>
              </div>
            ))}
            <div className="flex gap-4 pt-2 border-t border-slate-100">
              {[['bg-red-400','Ocupado'],['bg-amber-300','Reservado'],['bg-slate-300','Mantenimiento'],['bg-slate-100','Disponible']].map(([c,l]) => (
                <span key={l} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-3 h-3 rounded-sm ${c}`} />{l}
                </span>
              ))}
            </div>
          </div>

          {/* Gráfico */}
          <div className="bg-white rounded-2xl shadow-sm p-6">
            <SectionTitle>Distribución de espacios por zona</SectionTitle>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={zonas} barSize={32}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="zonaNombre" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="disponibles" name="Disponibles" fill="#10b981" radius={[4,4,0,0]} stackId="a" />
                <Bar dataKey="ocupados"    name="Ocupados"    fill="#ef4444" radius={[0,0,0,0]} stackId="a" />
                <Bar dataKey="reservados"  name="Reservados"  fill="#f59e0b" radius={[0,0,0,0]} stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab: Vehículos ─────────────────────────────────────────
function TabVehiculos() {
  const { data, loading } = useQuery(REPORTE_VEHICULOS_QUERY, { fetchPolicy: 'cache-and-network' })
  const porTipo   = data?.reporteVehiculosPorTipo   ?? []
  const porEstado = data?.reporteVehiculosPorEstado ?? []
  const totalVeh  = porTipo.reduce((s: number, t: any) => s + t.cantidad, 0)

  function exportar() {
    exportarExcel(
      porTipo.map((t: any) => ({ 'Tipo': t.nombre, 'Cantidad': t.cantidad })),
      'reporte_vehiculos'
    )
  }

  const COLORES_ESTADO: Record<string, string> = {
    'Activo': '#10b981', 'Inactivo': '#94a3b8', 'Sancionado': '#ef4444',
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button onClick={exportar} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-xl transition-colors">
          <FileDown size={15} /> Exportar Excel
        </button>
      </div>

      {loading ? <Skeleton /> : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total vehículos" value={totalVeh} color="border-emerald-400" />
            <StatCard label="Tipos registrados" value={porTipo.length} color="border-blue-400" sub="en el sistema" />
            <StatCard label="Sancionados" value={porEstado.find((e: any) => e.nombre === 'Sancionado')?.cantidad ?? 0} color="border-red-400" sub="acceso bloqueado" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pie: por tipo */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <SectionTitle>Por tipo de vehículo</SectionTitle>
              {porTipo.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Sin datos</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={porTipo} dataKey="cantidad" nameKey="nombre" cx="50%" cy="50%" outerRadius={80} label={({ nombre, percent }: any) => `${nombre} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {porTipo.map((_: any, i: number) => <Cell key={i} fill={COLORES[i % COLORES.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Pie: por estado */}
            <div className="bg-white rounded-2xl shadow-sm p-6">
              <SectionTitle>Por estado del vehículo</SectionTitle>
              {porEstado.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Sin datos</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={porEstado} dataKey="cantidad" nameKey="nombre" cx="50%" cy="50%" outerRadius={80} label={({ nombre, percent }: any) => `${nombre} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {porEstado.map((e: any) => <Cell key={e.nombre} fill={COLORES_ESTADO[e.nombre] ?? '#94a3b8'} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tabla */}
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Tipo de vehículo</th>
                  <th className="px-6 py-3 text-left">Cantidad</th>
                  <th className="px-6 py-3 text-left">% del total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {porTipo.length === 0 ? (
                  <tr><td colSpan={3} className="px-6 py-8 text-center text-slate-400">Sin vehículos registrados</td></tr>
                ) : porTipo.map((t: any, i: number) => (
                  <tr key={t.nombre} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: COLORES[i % COLORES.length] }} />
                      <span className="font-medium text-slate-700">{t.nombre}</span>
                    </td>
                    <td className="px-6 py-3 font-bold text-slate-800">{t.cantidad}</td>
                    <td className="px-6 py-3 text-slate-600">
                      {totalVeh > 0 ? `${((t.cantidad / totalVeh) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Página principal ───────────────────────────────────────
type TabKey = 'accesos' | 'multas' | 'parqueos' | 'vehiculos'

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: 'accesos',   label: 'Accesos',   icon: TrendingUp    },
  { key: 'multas',    label: 'Multas',    icon: AlertTriangle },
  { key: 'parqueos',  label: 'Parqueos',  icon: ParkingSquare },
  { key: 'vehiculos', label: 'Vehículos', icon: Car           },
]

export default function Reportes() {
  const [tab, setTab] = useState<TabKey>('accesos')

  return (
    <div className="p-8 bg-slate-50 min-h-full">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Encabezado */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="bg-slate-800 text-white p-2 rounded-xl">
                <BarChart2 size={20} />
              </div>
              <h1 className="text-2xl font-bold text-slate-800">Reportes</h1>
            </div>
            <p className="text-slate-400 text-sm ml-12">Análisis y exportación de datos del sistema vehicular UAGRM</p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 text-sm px-4 py-2 rounded-xl transition-colors"
          >
            <Printer size={15} /> Imprimir
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 bg-white rounded-2xl p-2 shadow-sm">
          {TABS.map(t => (
            <TabBtn key={t.key} active={tab === t.key} onClick={() => setTab(t.key)} icon={t.icon} label={t.label} />
          ))}
        </div>

        {/* Contenido del tab activo */}
        <div>
          {tab === 'accesos'   && <TabAccesos />}
          {tab === 'multas'    && <TabMultas />}
          {tab === 'parqueos'  && <TabParqueos />}
          {tab === 'vehiculos' && <TabVehiculos />}
        </div>

      </div>
    </div>
  )
}
