import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import {
  LayoutDashboard, Users, Car, ParkingSquare,
  DoorOpen, UserCheck, AlertTriangle, Bell, LogOut,
  Menu, X, UserCircle, BarChart2, ShieldCheck, Shield, Search, Navigation,
} from 'lucide-react'
import { UagrmLogo } from './UagrmLogo'
import { useQuery } from '@apollo/client'
import { useAuth } from '../hooks/useAuth'
import { useNotificaciones, NotifPayload } from '../hooks/useNotificaciones'
import { CONTEO_NO_LEIDAS_QUERY } from '../graphql/queries/notificaciones'

const BusquedaGlobalModal = lazy(() => import('./BusquedaGlobalModal'))

const NAV_ITEMS = [
  { to: '/',               label: 'Dashboard',      icon: LayoutDashboard, roles: ['all'] },
  { to: '/guardia',        label: 'Panel Guardia',  icon: ShieldCheck,     roles: ['Guardia', 'Administrador'] },
  { to: '/usuarios',       label: 'Usuarios',       icon: Users,           roles: ['Administrador'] },
  { to: '/vehiculos',      label: 'Vehículos',      icon: Car,             roles: ['all'] },
  { to: '/parqueos',       label: 'Parqueos',       icon: ParkingSquare,   roles: ['all'] },
  { to: '/acceso',         label: 'Acceso',         icon: DoorOpen,        roles: ['Administrador', 'Guardia'] },
  { to: '/visitantes',     label: 'Visitantes',     icon: UserCheck,       roles: ['Administrador', 'Guardia'] },
  { to: '/multas',         label: 'Multas',         icon: AlertTriangle,   roles: ['all'] },
  { to: '/notificaciones', label: 'Notificaciones', icon: Bell,            roles: ['all'] },
  { to: '/reportes',       label: 'Reportes',       icon: BarChart2,       roles: ['Administrador'] },
  { to: '/auditoria',      label: 'Auditoría',      icon: Shield,          roles: ['Administrador'] },
  { to: '/parqueo-demo',    label: 'Guía Parqueo 🔴DEMO', icon: Navigation, roles: ['all'] },
  { to: '/rastreo-en-vivo', label: '📡 Rastreo en Vivo',   icon: Navigation, roles: ['all'] },
]

interface Toast extends NotifPayload { key: number }

function ToastPanel({ toasts, onClose }: { toasts: Toast[]; onClose: (key: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-xs sm:max-w-sm">
      {toasts.map(t => (
        <div key={t.key} className="bg-slate-800 text-white rounded-2xl shadow-xl p-4 flex gap-3 items-start">
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

export default function Layout() {
  const [desktopOpen, setDesktopOpen]   = useState(true)
  const [mobileOpen, setMobileOpen]     = useState(false)
  const [toasts, setToasts]             = useState<Toast[]>([])
  const [busquedaAbierta, setBusqueda]  = useState(false)
  const [guiaParqueo, setGuiaParqueo]   = useState(false)
  const [guiaVehId, setGuiaVehId]       = useState<number | null>(null)  // vehiculo del QR escaneado

  const { logout, usuario, roles, esAdmin } = useAuth()
  // Aplicar tema al montar (lee preferencia guardada)
  useEffect(() => {
    const saved = localStorage.getItem('uagrm_theme') ?? 'auto'
    const hora = new Date().getHours()
    const auto = hora >= 18 || hora < 6 ? 'dark' : 'light'
    const resolved = saved === 'auto' ? auto : saved
    document.documentElement.classList.toggle('dark', resolved === 'dark')
  }, [])
  const navigate  = useNavigate()
  const location  = useLocation()

  // Cerrar sidebar mobile al cambiar de ruta + actualizar document.title
  const PAGE_TITLES: Record<string, string> = {
    '/':               'Dashboard',
    '/guardia':        'Panel Guardia',
    '/usuarios':       'Usuarios',
    '/vehiculos':      'Vehículos',
    '/parqueos':       'Parqueos',
    '/acceso':         'Control de Acceso',
    '/visitantes':     'Visitantes',
    '/multas':         'Multas',
    '/notificaciones': 'Notificaciones',
    '/reportes':       'Reportes',
    '/auditoria':      'Auditoría',
    '/perfil':         'Mi Perfil',
  }
  useEffect(() => {
    setMobileOpen(false)
    const ruta = Object.keys(PAGE_TITLES).find(k => location.pathname === k || location.pathname.startsWith(k + '/'))
    const titulo = ruta ? PAGE_TITLES[ruta] : 'Sistema Vehicular'
    document.title = `${titulo} · Control Vehicular UAGRM · 2026`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Inicializar colapsado en pantallas pequeñas
  useEffect(() => {
    if (window.innerWidth < 768) setDesktopOpen(false)
  }, [])

  const { data: conteoData } = useQuery(CONTEO_NO_LEIDAS_QUERY, {
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
  })
  const conteo: number = conteoData?.conteoNoLeidas ?? 0

  const handleNueva = useCallback((n: NotifPayload) => {
    // Notificación especial: guía de parqueo → modal YES/NO con vehiculo_id del QR
    if (n.tipoCodigo === 'orientacion_parqueo') {
      const vehId = n.datosExtra?.vehiculo_id
      setGuiaVehId(typeof vehId === 'number' ? vehId : null)
      setGuiaParqueo(true)
      return
    }
    const key = Date.now() + Math.random()
    setToasts(prev => [...prev, { ...n, key }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.key !== key)), 6000)
  }, [])

  useNotificaciones(handleNueva)

  // Ctrl+K abre la búsqueda global
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setBusqueda(v => !v)
      }
    }
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [])

  const esUsuarioNormal = ['Estudiante', 'Docente', 'Personal Administrativo'].some(r => roles.includes(r))
  const itemsVisibles = NAV_ITEMS.filter(item =>
    item.roles.includes('all') ||
    esAdmin ||
    (esUsuarioNormal && item.roles.includes('Residente')) ||
    item.roles.some(r => roles.includes(r))
  )

  function handleLogout() { logout(); navigate('/login') }

  const NavContent = ({ onItemClick }: { onItemClick?: () => void }) => (
    <>
      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {itemsVisibles.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={onItemClick}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-all
               ${isActive
                 ? 'text-white font-semibold border-l-2'
                 : 'text-blue-100/70 hover:text-white hover:bg-white/10'}`
            }
            style={({ isActive }) => isActive ? { borderColor: '#e8951a', background: 'rgba(255,255,255,0.12)' } : {}}
          >
            <span className="relative shrink-0">
              {/* Campana oscila una vez al montar cuando hay notificaciones sin leer */}
              <Icon size={18}
                className={to === '/notificaciones' && conteo > 0 ? 'animate-swing-bell' : ''} />
              {to === '/notificaciones' && conteo > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full animate-badge-entrar">
                  {conteo > 9 ? '9+' : conteo}
                </span>
              )}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <NavLink
        to="/perfil"
        onClick={onItemClick}
        className={({ isActive }) =>
          `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors border-t border-slate-700
           ${isActive ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`
        }
      >
        <UserCircle size={18} className="shrink-0" />
        <span>Mi perfil</span>
      </NavLink>

      <button
        onClick={() => { handleLogout(); onItemClick?.() }}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-300 hover:bg-slate-700 hover:text-white border-t border-slate-700"
      >
        <LogOut size={18} className="shrink-0" />
        <span>Cerrar sesión</span>
      </button>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">

      {/* ── SIDEBAR DESKTOP (md+) ─────────────────────────── */}
      {/* Sidebar con paleta azul marino UAGRM */}
      <aside className={`
        hidden md:flex flex-col text-white shrink-0 transition-all duration-200
        ${desktopOpen ? 'w-56' : 'w-16'}
      `} style={{ background: 'linear-gradient(180deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center justify-between p-3 border-b border-slate-700 min-h-[57px]"
          style={{ background: 'linear-gradient(135deg, #1a4d1a 0%, #0d2b0d 100%)' }}>
          {desktopOpen
            ? <UagrmLogo size={32} variant="completo" />
            : <UagrmLogo size={28} variant="escudo" />
          }
          <button onClick={() => setDesktopOpen(!desktopOpen)} className="text-yellow-200/60 hover:text-yellow-200 ml-2 shrink-0">
            {desktopOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {desktopOpen && (
          <div className="px-4 py-3 border-b border-slate-700">
            {/* Foto + nombre del usuario */}
            <div className="flex items-center gap-3 mb-2">
              {usuario.fotoUrl ? (
                <img src={usuario.fotoUrl} alt="Perfil"
                  className="w-12 h-12 rounded-full object-cover shrink-0 border-2 border-yellow-400/50 shadow-md" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center shrink-0 border-2 border-slate-600 text-white text-sm font-bold shadow-md">
                  {(usuario.nombreCompleto || 'U').split(' ').map((n: string) => n[0]).slice(0,2).join('')}
                </div>
              )}
              <p className="text-sm font-medium text-white truncate">{usuario.nombreCompleto}</p>
            </div>
            <div className="flex flex-wrap gap-1">
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

        {desktopOpen ? (
          <NavContent />
        ) : (
          /* Modo icono colapsado */
          <>
            <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
              {itemsVisibles.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  title={label}
                  className={({ isActive }) =>
                    `flex items-center justify-center px-4 py-2.5 text-sm transition-colors
                     ${isActive ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`
                  }
                >
                  <span className="relative">
                    <Icon size={18} />
                    {to === '/notificaciones' && conteo > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                        {conteo > 9 ? '9+' : conteo}
                      </span>
                    )}
                  </span>
                </NavLink>
              ))}
            </nav>
            <NavLink to="/perfil" title="Mi perfil"
              className={({ isActive }) =>
                `flex items-center justify-center px-4 py-2.5 border-t border-slate-700 transition-colors
                 ${isActive ? 'bg-slate-600 text-white' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`
              }
            >
              <UserCircle size={18} />
            </NavLink>
            <button onClick={handleLogout} title="Cerrar sesión"
              className="flex items-center justify-center px-4 py-3 text-slate-300 hover:bg-slate-700 hover:text-white border-t border-slate-700">
              <LogOut size={18} />
            </button>
          </>
        )}
      </aside>

      {/* ── OVERLAY MOBILE ───────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── SIDEBAR MOBILE (drawer) ───────────────────────── */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 text-white flex flex-col
        transform transition-transform duration-300 md:hidden
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `} style={{ background: 'linear-gradient(180deg, #061840 0%, #0a2a6e 100%)' }}>
        <div className="flex items-center justify-between p-4 border-b border-slate-700"
          style={{ background: 'linear-gradient(135deg, #1a4d1a 0%, #0d2b0d 100%)' }}>
          <UagrmLogo size={30} variant="completo" />
          <button onClick={() => setMobileOpen(false)} className="text-yellow-200/60 hover:text-yellow-200">
            <X size={18} />
          </button>
        </div>
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
        <NavContent onItemClick={() => setMobileOpen(false)} />
      </aside>

      {/* ── CONTENIDO PRINCIPAL — aplica tema claro/oscuro ─── */}
      <div className="flex-1 flex flex-col overflow-hidden theme-content">
        {/* Top bar mobile */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 text-white shrink-0"
          style={{ background: 'linear-gradient(90deg, #061840 0%, #0a2a6e 100%)', borderBottom: '2px solid #e8951a' }}>
          <button onClick={() => setMobileOpen(true)} className="text-blue-100/70 hover:text-white">
            <Menu size={20} />
          </button>
          <UagrmLogo size={26} variant="completo" className="flex-1" />
          {/* Búsqueda mobile */}
          {esAdmin && (
            <button onClick={() => setBusqueda(true)} className="text-slate-300 hover:text-white">
              <Search size={18} />
            </button>
          )}
          <NavLink to="/notificaciones" className="relative text-slate-300 hover:text-white">
            <Bell size={20} />
            {conteo > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                {conteo > 9 ? '9+' : conteo}
              </span>
            )}
          </NavLink>
        </header>

        {/* Barra de búsqueda desktop — solo admin */}
        {esAdmin && (
          <div className="hidden md:flex items-center px-4 py-2 border-b border-slate-200 bg-white/80 dark:bg-slate-900/80 shrink-0">
            <button
              onClick={() => setBusqueda(true)}
              className="flex items-center gap-2 w-full max-w-sm text-sm text-slate-400 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 transition-colors"
            >
              <Search size={14} />
              <span className="flex-1 text-left">Buscar...</span>
              <kbd className="text-[10px] font-mono text-slate-400 bg-white border border-slate-300 rounded px-1.5 py-0.5">⌘K</kbd>
            </button>
          </div>
        )}

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <ToastPanel toasts={toasts} onClose={(key) => setToasts(prev => prev.filter(t => t.key !== key))} />

      {/* Modal de búsqueda global */}
      {busquedaAbierta && (
        <Suspense fallback={null}>
          <BusquedaGlobalModal onClose={() => setBusqueda(false)} />
        </Suspense>
      )}

      {/* ── Modal: orientación de parqueo post-escaneo QR ─────────── */}
      {guiaParqueo && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full animate-flip-modal">
            <div className="text-center mb-5">
              <span className="text-5xl block mb-3">🏫</span>
              <h2 className="font-black text-xl text-slate-800">¡Bienvenido al campus UAGRM!</h2>
              <p className="text-slate-500 text-sm mt-1">Tu ingreso fue registrado</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-5 text-center">
              <p className="font-bold text-amber-800 text-sm">🅿 ¿Deseas orientación para encontrar estacionamiento?</p>
              <p className="text-amber-600 text-xs mt-1">El sistema te guía hasta una zona disponible</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                setGuiaParqueo(false)
                // Navegar con el vehiculo_id del QR para pre-selección automática
                const url = guiaVehId ? `/parqueo-demo?vehiculoId=${guiaVehId}` : '/parqueo-demo'
                navigate(url)
              }}
                className="flex flex-col items-center gap-1.5 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold text-sm transition-colors shadow-lg"
              >
                <span className="text-2xl">✅</span>
                Sí, guíame
              </button>
              <button
                onClick={() => setGuiaParqueo(false)}
                className="flex flex-col items-center gap-1.5 py-4 border-2 border-slate-200 text-slate-600 rounded-2xl font-medium text-sm hover:bg-slate-50 transition-colors"
              >
                <span className="text-2xl">🚗</span>
                No, gracias
              </button>
            </div>
            <p className="text-center text-[10px] text-slate-400 mt-3">
              Si eliges "No", el guardia registrará tu parqueo al llegar a la zona
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
