import { useState, useCallback } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Car, ParkingSquare,
  DoorOpen, UserCheck, AlertTriangle, Bell, LogOut, Menu, X, UserCircle, BarChart2, ShieldCheck,
} from 'lucide-react'
import { useQuery } from '@apollo/client'
import { useAuth } from '../hooks/useAuth'
import { useNotificaciones, NotifPayload } from '../hooks/useNotificaciones'
import { CONTEO_NO_LEIDAS_QUERY } from '../graphql/queries/notificaciones'

const NAV_ITEMS = [
  { to: '/',              label: 'Dashboard',      icon: LayoutDashboard, roles: ['all'] },
  { to: '/guardia',      label: 'Panel Guardia',  icon: ShieldCheck,     roles: ['Guardia', 'Administrador'] },
  { to: '/usuarios',      label: 'Usuarios',       icon: Users,           roles: ['Administrador'] },
  { to: '/vehiculos',     label: 'Vehículos',      icon: Car,             roles: ['all'] },
  { to: '/parqueos',      label: 'Parqueos',       icon: ParkingSquare,   roles: ['Administrador', 'Guardia'] },
  { to: '/acceso',        label: 'Acceso',         icon: DoorOpen,        roles: ['Administrador', 'Guardia'] },
  { to: '/visitantes',    label: 'Visitantes',     icon: UserCheck,       roles: ['Administrador', 'Guardia'] },
  { to: '/multas',        label: 'Multas',         icon: AlertTriangle,   roles: ['Administrador', 'Guardia'] },
  { to: '/notificaciones',label: 'Notificaciones', icon: Bell,            roles: ['all'] },
  { to: '/reportes',      label: 'Reportes',       icon: BarChart2,       roles: ['Administrador'] },
]

// ── Toast de notificación ──────────────────────────────────

interface Toast extends NotifPayload { key: number }

function ToastPanel({ toasts, onClose }: { toasts: Toast[]; onClose: (key: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div key={t.key} className="bg-slate-800 text-white rounded-2xl shadow-xl p-4 flex gap-3 items-start animate-in slide-in-from-right-4">
          <Bell size={16} className="text-orange-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight">{t.titulo}</p>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">{t.mensaje}</p>
          </div>
          <button onClick={() => onClose(t.key)} className="text-slate-400 hover:text-white shrink-0">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Layout principal ───────────────────────────────────────

export default function Layout() {
  const [open, setOpen] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [toastKey, setToastKey] = useState(0)

  const { logout, usuario, roles, esAdmin } = useAuth()
  const navigate = useNavigate()

  const { data: conteoData } = useQuery(CONTEO_NO_LEIDAS_QUERY, {
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
  })
  const conteo: number = conteoData?.conteoNoLeidas ?? 0

  const handleNueva = useCallback((n: NotifPayload) => {
    const key = Date.now() + Math.random()
    setToastKey(k => k + 1)
    setToasts(prev => [...prev, { ...n, key }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.key !== key)), 6000)
  }, [])

  useNotificaciones(handleNueva)

  const esUsuarioNormal = ['Estudiante', 'Docente', 'Personal Administrativo'].some(r => roles.includes(r))

  const itemsVisibles = NAV_ITEMS.filter(item =>
    item.roles.includes('all') ||
    esAdmin ||
    (esUsuarioNormal && item.roles.includes('Residente')) ||
    item.roles.some(r => roles.includes(r))
  )

  function handleLogout() { logout(); navigate('/login') }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className={`${open ? 'w-56' : 'w-16'} bg-slate-800 text-white flex flex-col transition-all duration-200 shrink-0`}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          {open && <span className="font-bold text-sm truncate">Control Vehicular</span>}
          <button onClick={() => setOpen(!open)} className="text-slate-300 hover:text-white">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Info usuario */}
        {open && (
          <div className="px-4 py-3 border-b border-slate-700">
            <p className="text-sm font-medium text-white truncate">{usuario.nombreCompleto}</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {roles.length > 0
                ? roles.map(r => (
                    <span key={r} className="text-xs bg-slate-600 text-slate-200 px-1.5 py-0.5 rounded">{r}</span>
                  ))
                : esAdmin
                  ? <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded">Administrador</span>
                  : <span className="text-xs text-slate-400">Sin rol</span>
              }
            </div>
          </div>
        )}

        <nav className="flex-1 py-4 space-y-1 overflow-y-auto">
          {itemsVisibles.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                 ${isActive ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`
              }
            >
              {/* Badge de notificaciones no leídas */}
              <span className="relative shrink-0">
                <Icon size={18} />
                {to === '/notificaciones' && conteo > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                    {conteo > 9 ? '9+' : conteo}
                  </span>
                )}
              </span>
              {open && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <NavLink
          to="/perfil"
          className={({ isActive }) =>
            `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors border-t border-slate-700
             ${isActive ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`
          }
        >
          <UserCircle size={18} className="shrink-0" />
          {open && <span>Mi perfil</span>}
        </NavLink>

        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-700 hover:text-white border-t border-slate-700"
        >
          <LogOut size={18} className="shrink-0" />
          {open && <span>Cerrar sesión</span>}
        </button>
      </aside>

      {/* Contenido principal */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>

      {/* Toasts de notificaciones en tiempo real */}
      <ToastPanel toasts={toasts} onClose={(key) => setToasts(prev => prev.filter(t => t.key !== key))} />
    </div>
  )
}
