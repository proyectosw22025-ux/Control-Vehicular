import { useQuery, gql } from '@apollo/client'
import { Link } from 'react-router-dom'
import {
  Car, ParkingSquare, AlertTriangle, UserCheck,
  Users, DoorOpen, Bell, TrendingUp, ShieldAlert,
  LayoutDashboard, Clock,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import Onboarding from '../components/Onboarding'

const DASHBOARD_QUERY = gql`
  query DashboardStats {
    dashboardStats {
      totalVehiculos
      vehiculosActivosHoy
      espaciosDisponibles
      totalEspacios
      multasPendientes
      montoMultasPendientes
      visitantesActivos
      accesosHoy
      totalUsuarios
      apelacionesPendientes
    }
    accesosUltimaSemana {
      fecha
      entradas
      salidas
    }
  }
`

// ── Tarjeta de estadística ────────────────────────────────
interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  accent: string
}
function StatCard({ label, value, sub, icon: Icon, accent }: StatCardProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm p-5 border-l-4 ${accent} flex items-center gap-4`}>
      <div className={`p-3 rounded-xl bg-slate-50`}>
        <Icon size={22} className="text-slate-600" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800">{value}</p>
        <p className="text-sm font-medium text-slate-600">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Gráfico de barras CSS ─────────────────────────────────
interface DiaStat { fecha: string; entradas: number; salidas: number }
function BarChart({ data }: { data: DiaStat[] }) {
  const maxVal = Math.max(...data.map(d => d.entradas + d.salidas), 1)
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
        <TrendingUp size={16} className="text-blue-500" />
        Accesos últimos 7 días
      </h3>
      <div className="flex items-end gap-3 h-32">
        {data.map(dia => {
          const total = dia.entradas + dia.salidas
          const pctTotal = Math.round((total / maxVal) * 100)
          const pctEntradas = total > 0 ? Math.round((dia.entradas / total) * 100) : 0
          return (
            <div key={dia.fecha} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-slate-500 font-medium">{total || ''}</span>
              <div className="w-full rounded-t overflow-hidden flex flex-col-reverse" style={{ height: `${Math.max(pctTotal, 4)}%`, minHeight: total ? '8px' : '4px' }}>
                <div className="bg-blue-500" style={{ height: `${pctEntradas}%` }} title={`Entradas: ${dia.entradas}`} />
                <div className="bg-blue-200" style={{ height: `${100 - pctEntradas}%` }} title={`Salidas: ${dia.salidas}`} />
              </div>
              <span className="text-xs text-slate-400">{dia.fecha}</span>
            </div>
          )
        })}
      </div>
      <div className="flex gap-4 mt-3">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-blue-500" /> Entradas
        </span>
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <span className="inline-block w-3 h-3 rounded-sm bg-blue-200" /> Salidas
        </span>
      </div>
    </div>
  )
}

// ── Módulos de acceso rápido ──────────────────────────────
const MODULOS_ADMIN = [
  { label: 'Usuarios',      icon: Users,         color: 'bg-blue-500',    href: '/usuarios' },
  { label: 'Vehículos',     icon: Car,           color: 'bg-emerald-500', href: '/vehiculos' },
  { label: 'Parqueos',      icon: ParkingSquare, color: 'bg-violet-500',  href: '/parqueos' },
  { label: 'Acceso',        icon: DoorOpen,      color: 'bg-orange-500',  href: '/acceso' },
  { label: 'Visitantes',    icon: UserCheck,     color: 'bg-cyan-500',    href: '/visitantes' },
  { label: 'Multas',        icon: AlertTriangle, color: 'bg-red-500',     href: '/multas' },
  { label: 'Notificaciones',icon: Bell,          color: 'bg-slate-500',   href: '/notificaciones' },
]
const MODULOS_GUARDIA = [
  { label: 'Acceso',        icon: DoorOpen,      color: 'bg-orange-500',  href: '/acceso' },
  { label: 'Visitantes',    icon: UserCheck,     color: 'bg-cyan-500',    href: '/visitantes' },
  { label: 'Multas',        icon: AlertTriangle, color: 'bg-red-500',     href: '/multas' },
  { label: 'Parqueos',      icon: ParkingSquare, color: 'bg-violet-500',  href: '/parqueos' },
]
const MODULOS_RESIDENTE = [
  { label: 'Mis Vehículos', icon: Car,           color: 'bg-emerald-500', href: '/vehiculos' },
  { label: 'Notificaciones',icon: Bell,          color: 'bg-slate-500',   href: '/notificaciones' },
]

// ── Componente principal ──────────────────────────────────
export default function Dashboard() {
  const { usuario, esAdmin, esGuardia, tieneRol } = useAuth()

  const mostrarStats = esAdmin || esGuardia
  const { data, loading } = useQuery(DASHBOARD_QUERY, { skip: !mostrarStats })

  const stats = data?.dashboardStats
  const semana: DiaStat[] = data?.accesosUltimaSemana ?? []

  const esResidente = tieneRol('Estudiante', 'Docente', 'Personal Administrativo')
  const modulos = esAdmin ? MODULOS_ADMIN : esGuardia ? MODULOS_GUARDIA : MODULOS_RESIDENTE

  const fechaHoy = new Date().toLocaleDateString('es-BO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="p-8 space-y-6">
      <Onboarding />

      {/* ── Encabezado ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Bienvenido, {usuario.nombreCompleto || 'Usuario'}
          </h1>
          <p className="text-slate-400 text-sm mt-1 capitalize">{fechaHoy}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400 bg-white rounded-lg px-3 py-2 shadow-sm border border-slate-100">
          <LayoutDashboard size={14} />
          Sistema Vehicular UAGRM
        </div>
      </div>

      {/* ── Stats Admin ── */}
      {esAdmin && (
        <>
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm p-5 h-24 animate-pulse bg-slate-100" />
              ))}
            </div>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Vehículos registrados"
                  value={stats.totalVehiculos}
                  sub="con estado activo"
                  icon={Car}
                  accent="border-emerald-400"
                />
                <StatCard
                  label="Accesos hoy"
                  value={stats.accesosHoy}
                  sub={`${stats.vehiculosActivosHoy} vehículos distintos`}
                  icon={DoorOpen}
                  accent="border-orange-400"
                />
                <StatCard
                  label="Espacios disponibles"
                  value={`${stats.espaciosDisponibles} / ${stats.totalEspacios}`}
                  sub="en todas las zonas"
                  icon={ParkingSquare}
                  accent="border-violet-400"
                />
                <StatCard
                  label="Multas pendientes"
                  value={stats.multasPendientes}
                  sub={`Bs ${stats.montoMultasPendientes.toFixed(2)} total`}
                  icon={AlertTriangle}
                  accent="border-red-400"
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Visitantes activos"
                  value={stats.visitantesActivos}
                  sub="visitas en curso ahora"
                  icon={UserCheck}
                  accent="border-cyan-400"
                />
                <StatCard
                  label="Usuarios del sistema"
                  value={stats.totalUsuarios}
                  sub="cuentas activas"
                  icon={Users}
                  accent="border-blue-400"
                />
                <StatCard
                  label="Apelaciones pendientes"
                  value={stats.apelacionesPendientes}
                  sub="requieren resolución"
                  icon={ShieldAlert}
                  accent={stats.apelacionesPendientes > 0 ? 'border-amber-400' : 'border-slate-200'}
                />
                <StatCard
                  label="Vehículos activos hoy"
                  value={stats.vehiculosActivosHoy}
                  sub="ingresaron al campus"
                  icon={TrendingUp}
                  accent="border-slate-300"
                />
              </div>

              {/* ── Gráfico + Alertas ── */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <BarChart data={semana} />
                </div>
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                    <Clock size={16} className="text-slate-400" />
                    Estado del sistema
                  </h3>
                  <div className="space-y-3">
                    <AlertRow
                      ok={stats.apelacionesPendientes === 0}
                      texto={stats.apelacionesPendientes > 0
                        ? `${stats.apelacionesPendientes} apelación(es) sin resolver`
                        : 'Sin apelaciones pendientes'}
                    />
                    <AlertRow
                      ok={stats.multasPendientes < 5}
                      texto={stats.multasPendientes > 0
                        ? `${stats.multasPendientes} multa(s) pendientes de pago`
                        : 'Sin multas pendientes'}
                    />
                    <AlertRow
                      ok={stats.espaciosDisponibles > 0}
                      texto={stats.espaciosDisponibles === 0
                        ? 'Parqueo al límite — sin espacios libres'
                        : `${stats.espaciosDisponibles} espacios libres disponibles`}
                    />
                    <AlertRow
                      ok={stats.visitantesActivos < 20}
                      texto={`${stats.visitantesActivos} visitante(s) activos en el campus`}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}

      {/* ── Stats Guardia ── */}
      {esGuardia && !esAdmin && (
        <>
          {loading ? (
            <div className="grid grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl shadow-sm p-5 h-24 animate-pulse bg-slate-100" />
              ))}
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Accesos hoy" value={stats.accesosHoy} sub="registros totales" icon={DoorOpen} accent="border-orange-400" />
              <StatCard label="Visitantes activos" value={stats.visitantesActivos} sub="en el campus ahora" icon={UserCheck} accent="border-cyan-400" />
              <StatCard label="Multas pendientes" value={stats.multasPendientes} sub="sin pagar" icon={AlertTriangle} accent="border-red-400" />
              <StatCard label="Espacios libres" value={`${stats.espaciosDisponibles}/${stats.totalEspacios}`} sub="en el parqueo" icon={ParkingSquare} accent="border-violet-400" />
            </div>
          ) : null}
        </>
      )}

      {/* ── Banner residente ── */}
      {esResidente && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-blue-700">
          <strong>¿Primera vez?</strong>{' '}
          Registra tu vehículo en <Link to="/vehiculos" className="underline font-medium">Mis Vehículos</Link>{' '}
          para poder acceder al estacionamiento de la UAGRM con tu QR personal.
        </div>
      )}

      {/* ── Acceso rápido a módulos ── */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Acceso rápido
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {modulos.map(({ label, icon: Icon, color, href }) => (
            <Link
              key={label}
              to={href}
              className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-3"
            >
              <div className={`${color} text-white p-2.5 rounded-lg`}>
                <Icon size={18} />
              </div>
              <span className="font-medium text-slate-700 text-sm">{label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Fila de alerta de estado ──────────────────────────────
function AlertRow({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <div className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
      <span className="mt-0.5 text-base leading-none">{ok ? '✓' : '⚠'}</span>
      <span>{texto}</span>
    </div>
  )
}
