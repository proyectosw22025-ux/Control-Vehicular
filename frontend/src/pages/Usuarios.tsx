import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  UserPlus, Trash2, UserCheck, Search, X,
  Users, ShieldCheck, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import { USUARIOS_QUERY, ROLES_QUERY } from '../graphql/queries/usuarios'
import {
  CREAR_USUARIO_MUTATION,
  DESACTIVAR_USUARIO_MUTATION,
  ASIGNAR_ROL_MUTATION,
} from '../graphql/mutations/usuarios'

interface Usuario {
  id: number
  ci: string
  nombreCompleto: string
  email: string
  telefono: string
  isActive: boolean
  roles: { nombre: string }[]
}

interface Rol { id: number; nombre: string }

// ── Colores de rol — alineados con Perfil.tsx ──────────────
const ROL_BADGE: Record<string, string> = {
  'Administrador':           'bg-blue-100 text-blue-700 border-blue-200',
  'Guardia':                 'bg-orange-100 text-orange-700 border-orange-200',
  'Estudiante':              'bg-emerald-100 text-emerald-700 border-emerald-200',
  'Docente':                 'bg-violet-100 text-violet-700 border-violet-200',
  'Personal Administrativo': 'bg-amber-100 text-amber-700 border-amber-200',
}
function RolBadge({ nombre }: { nombre: string }) {
  const cls = ROL_BADGE[nombre] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>
      <ShieldCheck size={10} /> {nombre}
    </span>
  )
}

// ── Modal genérico ─────────────────────────────────────────
function Modal({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{titulo}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

// ── Confirmación de desactivación ──────────────────────────
function ConfirmModal({ nombre, onConfirm, onCancel, loading }: {
  nombre: string; onConfirm: () => void; onCancel: () => void; loading: boolean
}) {
  return (
    <Modal titulo="Confirmar desactivación" onClose={onCancel}>
      <div className="flex items-start gap-3 mb-5">
        <div className="bg-red-100 p-2 rounded-xl shrink-0">
          <AlertTriangle size={20} className="text-red-600" />
        </div>
        <div>
          <p className="font-semibold text-slate-800">¿Desactivar a {nombre}?</p>
          <p className="text-sm text-slate-500 mt-1">
            El usuario perderá acceso al sistema inmediatamente. Podrás reactivarlo más tarde.
          </p>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 border border-slate-300 py-2 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
          Cancelar
        </button>
        <button onClick={onConfirm} disabled={loading}
          className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
          {loading ? 'Desactivando...' : 'Sí, desactivar'}
        </button>
      </div>
    </Modal>
  )
}

export default function Usuarios() {
  const { usuario: yo } = useAuth()
  const toast = useToast()

  const { data, loading, error: queryError, refetch } = useQuery(USUARIOS_QUERY)
  const { data: rolesData } = useQuery(ROLES_QUERY)

  const [crearUsuario, { loading: loadingCrear }] = useMutation(CREAR_USUARIO_MUTATION, {
    onCompleted(d) {
      refetch()
      setModal(null)
      toast.exito('Usuario creado', `${d.crearUsuario.nombreCompleto} puede iniciar sesión`)
    },
    onError(e) { setFormError(e.message); toast.error('Error al crear usuario', e.message) },
  })

  const [desactivar, { loading: loadingDesactivar }] = useMutation(DESACTIVAR_USUARIO_MUTATION, {
    onCompleted(d) {
      refetch()
      setConfirm(null)
      if (d.desactivarUsuario.ok) toast.alerta('Usuario desactivado', d.desactivarUsuario.mensaje)
      else toast.error('Error', d.desactivarUsuario.mensaje)
    },
    onError(e) { setConfirm(null); toast.error('Error al desactivar', e.message) },
  })

  const [asignarRol, { loading: loadingRol }] = useMutation(ASIGNAR_ROL_MUTATION, {
    onCompleted(d) {
      refetch()
      if (d.asignarRol.ok) toast.exito('Rol asignado', d.asignarRol.mensaje)
      else toast.error('Error', d.asignarRol.mensaje)
    },
    onError(e) { toast.error('Error al asignar rol', e.message) },
  })

  const [modal, setModal] = useState<'crear' | null>(null)
  const [confirm, setConfirm] = useState<Usuario | null>(null)
  const [formError, setFormError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [rolSeleccionado, setRolSeleccionado] = useState<Record<number, string>>({})
  const [form, setForm] = useState({
    ci: '', email: '', nombre: '', apellido: '',
    password: '', telefono: '', tipoUsuario: 'estudiante',
  })

  const todos: Usuario[] = data?.usuarios ?? []
  const roles: Rol[] = rolesData?.roles ?? []

  // Filtro client-side — todos los usuarios ya están en memoria
  const filtrados = useMemo(() => {
    if (!busqueda.trim()) return todos
    const q = busqueda.toLowerCase()
    return todos.filter(u =>
      u.nombreCompleto.toLowerCase().includes(q) ||
      u.ci.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.roles.some(r => r.nombre.toLowerCase().includes(q))
    )
  }, [todos, busqueda])

  function resetForm() {
    setForm({ ci: '', email: '', nombre: '', apellido: '', password: '', telefono: '', tipoUsuario: 'estudiante' })
    setFormError('')
  }

  function handleCrear() {
    setFormError('')
    if (!form.ci || !form.email || !form.nombre || !form.apellido || !form.password) {
      setFormError('Todos los campos marcados con * son obligatorios')
      return
    }
    crearUsuario({ variables: { input: form } })
  }

  function handleAsignarRol(u: Usuario) {
    const rolId = rolSeleccionado[u.id]
    if (!rolId) { toast.alerta('Selecciona un rol primero'); return }
    asignarRol({ variables: { usuarioId: u.id, rolId: parseInt(rolId) } })
  }

  const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 bg-slate-50 focus:bg-white transition-all'

  return (
    <div className="p-4 sm:p-8">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 text-white p-2 rounded-xl"><Users size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Usuarios</h1>
            <p className="text-slate-500 text-xs">{todos.length} usuario{todos.length !== 1 ? 's' : ''} registrados</p>
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setModal('crear') }}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
        >
          <UserPlus size={16} />
          <span className="hidden sm:inline">Nuevo usuario</span>
          <span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      {/* Barra de búsqueda */}
      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar por nombre, CI, email o rol..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {busqueda && (
          <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Estados de carga / error */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl h-16 animate-pulse" />)}
        </div>
      ) : queryError ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-red-600 text-sm font-medium mb-1">Error al cargar usuarios</p>
          <p className="text-slate-400 text-xs">{queryError.message}</p>
          <button onClick={() => refetch()} className="mt-3 text-xs text-blue-600 hover:underline">Reintentar</button>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center text-slate-400">
          <Users size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{busqueda ? 'Sin resultados para esta búsqueda' : 'No hay usuarios registrados'}</p>
        </div>
      ) : (
        <>
          {/* Vista mobile: cards */}
          <div className="sm:hidden space-y-3">
            {filtrados.map(u => (
              <div key={u.id} className={`bg-white rounded-xl shadow-sm p-4 border-l-4 ${u.isActive ? 'border-emerald-400' : 'border-slate-300 opacity-60'}`}>
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-800">{u.nombreCompleto}</p>
                      {!u.isActive && <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Inactivo</span>}
                    </div>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">CI: {u.ci}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {u.roles.length > 0
                        ? u.roles.map(r => <RolBadge key={r.nombre} nombre={r.nombre} />)
                        : <span className="text-xs text-slate-400 italic">Sin rol</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <select value={rolSeleccionado[u.id] ?? ''} onChange={e => setRolSeleccionado({ ...rolSeleccionado, [u.id]: e.target.value })}
                    className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs">
                    <option value="">Asignar rol...</option>
                    {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                  <button onClick={() => handleAsignarRol(u)} disabled={loadingRol}
                    className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors" title="Asignar rol">
                    <UserCheck size={15} />
                  </button>
                  {u.id !== yo.id && u.isActive && (
                    <button onClick={() => setConfirm(u)}
                      className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors" title="Desactivar usuario">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Vista desktop: tabla */}
          <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['CI', 'Nombre', 'Email', 'Roles', 'Estado', 'Asignar rol', 'Acción'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map(u => (
                  <tr key={u.id} className={`hover:bg-slate-50 transition-colors ${!u.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 font-mono text-slate-600 text-xs">{u.ci}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{u.nombreCompleto}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.length > 0
                          ? u.roles.map(r => <RolBadge key={r.nombre} nombre={r.nombre} />)
                          : <span className="text-slate-400 text-xs italic">Sin rol</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {u.isActive ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <select value={rolSeleccionado[u.id] ?? ''} onChange={e => setRolSeleccionado({ ...rolSeleccionado, [u.id]: e.target.value })}
                          className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[160px]">
                          <option value="">Seleccionar rol...</option>
                          {roles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                        </select>
                        <button onClick={() => handleAsignarRol(u)} disabled={loadingRol || !rolSeleccionado[u.id]}
                          className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-40 transition-colors" title="Aplicar rol">
                          <UserCheck size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.id !== yo.id && u.isActive ? (
                        <button onClick={() => setConfirm(u)}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Desactivar usuario">
                          <Trash2 size={15} />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-300 px-2">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
              {filtrados.length} de {todos.length} usuario{todos.length !== 1 ? 's' : ''}
              {busqueda && ` · filtrado por "${busqueda}"`}
            </div>
          </div>
        </>
      )}

      {/* Modal crear usuario */}
      {modal === 'crear' && (
        <Modal titulo="Nuevo usuario" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Nombre *</label>
                <input className={inputCls} placeholder="Juan" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Apellido *</label>
                <input className={inputCls} placeholder="Pérez" value={form.apellido} onChange={e => setForm({ ...form, apellido: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">CI *</label>
              <input className={inputCls} placeholder="Cédula de identidad" value={form.ci} onChange={e => setForm({ ...form, ci: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Email *</label>
              <input type="email" className={inputCls} placeholder="correo@uagrm.edu.bo" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Contraseña *</label>
              <input type="password" autoComplete="new-password" className={inputCls} placeholder="Mínimo 8 caracteres" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Teléfono</label>
              <input type="tel" className={inputCls} placeholder="70000000" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Tipo de usuario</label>
              <select className={inputCls} value={form.tipoUsuario} onChange={e => setForm({ ...form, tipoUsuario: e.target.value })}>
                <option value="estudiante">Estudiante</option>
                <option value="docente">Docente</option>
                <option value="personal">Personal Administrativo</option>
              </select>
            </div>
          </div>

          {formError && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {formError}
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button onClick={() => setModal(null)} className="flex-1 border border-slate-300 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button onClick={handleCrear} disabled={loadingCrear}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              {loadingCrear ? 'Creando...' : 'Crear usuario'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal confirmación desactivar */}
      {confirm && (
        <ConfirmModal
          nombre={confirm.nombreCompleto}
          loading={loadingDesactivar}
          onConfirm={() => desactivar({ variables: { id: confirm.id } })}
          onCancel={() => setConfirm(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />
    </div>
  )
}
