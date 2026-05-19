import { useQuery, useMutation, gql } from '@apollo/client'
import { Link } from 'react-router-dom'
import {
  Car, ParkingSquare, AlertTriangle, UserCheck,
  Users, DoorOpen, Bell, TrendingUp, ShieldAlert,
  LayoutDashboard, Clock, ShieldCheck, ArrowRight,
  CheckCircle2, XCircle, AlertCircle, QrCode,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import Onboarding from '../components/Onboarding'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'

const ALERTAS_ACCESO_QUERY = gql`
  query AlertasDashboard {
    conteoAlertasAcceso
    alertasAcceso(revisadas: false, limite: 5) {
      id tipoAnomalia severidad descripcion vehiculoPlaca
    }
  }
`

const MARCAR_ALERTA = gql`
  mutation MarcarAlerta($id: Int!) {
    marcarAlertaRevisada(alertaId: $id) { id revisada }
  }
`

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
function StatCard({ label, value, sub, icon: Icon, accent, idx = 0 }: StatCardProps & { idx?: number }) {
  const stagger = ['stagger-1','stagger-2','stagger-3','stagger-4','stagger-5']
  return (
    <div className={`bg-white rounded-xl shadow-sm p-5 border-l-4 ${accent} flex items-center gap-4 animate-fade-bottom ${stagger[idx % 5] ?? ''}`}>
      <div className="p-3 rounded-xl bg-slate-50">
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

// ── Tarjeta de vehículo para residentes ───────────────────
const ESTADO_CONFIG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  activo:     { label: 'Activo — puede ingresar', icon: CheckCircle2, cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  sancionado: { label: 'Sancionado — acceso bloqueado', icon: XCircle, cls: 'text-red-600 bg-red-50 border-red-200' },
  pendiente:  { label: 'Pendiente de aprobación', icon: AlertCircle, cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  inactivo:   { label: 'Inactivo', icon: XCircle, cls: 'text-slate-500 bg-slate-50 border-slate-200' },
}

function VehiculoCard({ v }: { v: any }) {
  const cfg = ESTADO_CONFIG[v.estado] ?? ESTADO_CONFIG.inactivo
  const Icon = cfg.icon
  return (
    <div className={`rounded-xl border p-4 flex items-center gap-3 ${cfg.cls}`}>
      <div className="shrink-0">
        <Car size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm font-mono tracking-wide">{v.placa}</p>
        <p className="text-xs opacity-80 truncate">{v.marca} {v.modelo} · {v.anio}</p>
        <p className="text-xs font-medium mt-0.5 flex items-center gap-1">
          <Icon size={11} /> {cfg.label}
        </p>
      </div>
      <Link to="/vehiculos" className="shrink-0 p-2 rounded-lg hover:bg-white/60 transition-colors" title="Ver QR y detalles">
        <QrCode size={18} />
      </Link>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────
export default function Dashboard() {
  const { usuario, esAdmin, esGuardia, tieneRol } = useAuth()

  const mostrarStats = esAdmin || esGuardia
  const { data, loading } = useQuery(DASHBOARD_QUERY, { skip: !mostrarStats })

  const { data: alertasData, refetch: refetchAlertas } = useQuery(ALERTAS_ACCESO_QUERY, {
    skip: !esAdmin,
    fetchPolicy: 'cache-and-network',
    pollInterval: 120_000,
  })
  const [marcarAlerta] = useMutation(MARCAR_ALERTA, {
    onCompleted: () => refetchAlertas(),
  })
  const conteoAlertas: number = alertasData?.conteoAlertasAcceso ?? 0
  const alertasPendientes: any[] = alertasData?.alertasAcceso ?? []

  const esResidente = tieneRol('Estudiante', 'Docente', 'Personal Administrativo')

  // Query de vehículos propios — solo para residentes
  const { data: misVehiculosData } = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: usuario.id, porPagina: 5 },
    skip: !esResidente || !usuario.id,
    fetchPolicy: 'cache-and-network',
  })
  const misVehiculos: any[] = misVehiculosData?.vehiculos?.items ?? []

  const stats = data?.dashboardStats
  const semana: DiaStat[] = data?.accesosUltimaSemana ?? []

  const modulos = esAdmin ? MODULOS_ADMIN : esGuardia ? MODULOS_GUARDIA : MODULOS_RESIDENTE

  const fechaHoy = new Date().toLocaleDateString('es-BO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="p-4 sm:p-8 space-y-4 sm:space-y-6">
      <Onboarding />

      {/* ── Encabezado ── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-slate-800 animate-text-pop-up-l">
            Bienvenido, {usuario.nombreCompleto?.split(' ')[0] || 'Usuario'}
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm mt-1 capitalize animate-fade-slide-up"
            style={{ animationDelay: '0.15s' }}>{fechaHoy}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {esAdmin && conteoAlertas > 0 && (
            <a href="#alertas-acceso"
              className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-700 text-xs font-semibold px-3 py-2 rounded-lg hover:bg-amber-100 transition-colors animate-pulse-slow">
              <AlertTriangle size={13} />
              ⚠️ {conteoAlertas} alerta{conteoAlertas !== 1 ? 's' : ''}
            </a>
          )}
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 bg-white rounded-lg px-3 py-2 shadow-sm border border-slate-100">
            <LayoutDashboard size={14} />
            Sistema Vehicular UAGRM
          </div>
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
                <StatCard idx={0} label="Vehículos registrados" value={stats.totalVehiculos} sub="con estado activo" icon={Car} accent="border-emerald-400" />
                <StatCard idx={1} label="Accesos hoy" value={stats.accesosHoy} sub={`${stats.vehiculosActivosHoy} vehículos distintos`} icon={DoorOpen} accent="border-orange-400" />
                <StatCard idx={2} label="Espacios disponibles" value={`${stats.espaciosDisponibles} / ${stats.totalEspacios}`} sub="en todas las zonas" icon={ParkingSquare} accent="border-violet-400" />
                <StatCard idx={3} label="Multas pendientes" value={stats.multasPendientes} sub={`Bs ${stats.montoMultasPendientes.toFixed(2)} total`} icon={AlertTriangle} accent="border-red-400" />
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

      {/* ── Banner de turno para guardia ── */}
      {esGuardia && !esAdmin && (
        <Link
          to="/guardia"
          className="flex items-center justify-between bg-orange-500 hover:bg-orange-600 text-white rounded-xl p-4 shadow-md transition-colors group"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck size={24} className="shrink-0" />
            <div>
              <p className="font-bold text-sm">Panel de Guardia</p>
              <p className="text-xs opacity-80">Registrar entradas, salidas y visitantes</p>
            </div>
          </div>
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </Link>
      )}

      {/* ── Vehículos propios del residente ── */}
      {esResidente && (
        misVehiculos.length === 0 ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-blue-700">
            <strong>¿Primera vez?</strong>{' '}
            Registra tu vehículo en{' '}
            <Link to="/vehiculos" className="underline font-medium">Mis Vehículos</Link>{' '}
            para acceder al estacionamiento de la UAGRM con QR personal.
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
                Mis vehículos
              </h2>
              <Link to="/vehiculos" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                Ver todos <ArrowRight size={12} />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {misVehiculos.map((v: any) => <VehiculoCard key={v.id} v={v} />)}
            </div>
          </div>
        )
      )}

      {/* ── Alertas de acceso — solo admin ── */}
      {esAdmin && alertasPendientes.length > 0 && (
        <div id="alertas-acceso" className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="text-sm font-bold text-amber-800">
              Alertas de acceso — {conteoAlertas} pendiente{conteoAlertas !== 1 ? 's' : ''}
            </h3>
          </div>
          <div className="space-y-2">
            {alertasPendientes.map((a: any) => (
              <div key={a.id} className={`flex items-start gap-3 bg-white rounded-xl px-3 py-2.5 border ${
                a.severidad === 'critica' ? 'border-red-200' : 'border-amber-200'
              }`}>
                <span className="text-lg shrink-0 mt-0.5">
                  {a.severidad === 'critica' ? '🚨' : a.severidad === 'advertencia' ? '⚠️' : 'ℹ️'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 truncate">
                    {a.vehiculoPlaca && <span className="font-mono mr-1">{a.vehiculoPlaca} ·</span>}
                    {a.descripcion}
                  </p>
                </div>
                <button
                  onClick={() => marcarAlerta({ variables: { id: a.id } })}
                  className="text-xs text-slate-400 hover:text-slate-600 shrink-0 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                  title="Marcar como revisada"
                >
                  ✓
                </button>
              </div>
            ))}
          </div>
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
