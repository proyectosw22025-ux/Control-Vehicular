import { useState } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { UserPlus, Trash2, UserCheck } from 'lucide-react'
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

interface Rol {
  id: number
  nombre: string
}

export default function Usuarios() {
  const { data, loading, error: queryError, refetch } = useQuery(USUARIOS_QUERY)
  const { data: rolesData } = useQuery(ROLES_QUERY)

  const [crearUsuario] = useMutation(CREAR_USUARIO_MUTATION, { onCompleted: () => { refetch(); setShowForm(false) } })
  const [desactivar] = useMutation(DESACTIVAR_USUARIO_MUTATION, { onCompleted: () => refetch() })
  const [asignarRol] = useMutation(ASIGNAR_ROL_MUTATION, { onCompleted: () => refetch() })

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ci: '', email: '', nombre: '', apellido: '', password: '', telefono: '', tipoUsuario: 'estudiante' })
  const [error, setError] = useState('')
  const [rolSeleccionado, setRolSeleccionado] = useState<{ [id: number]: string }>({})

  function handleCrear() {
    setError('')
    if (!form.ci || !form.email || !form.nombre || !form.apellido || !form.password) {
      setError('Todos los campos son obligatorios')
      return
    }
    crearUsuario({
      variables: {
        input: {
          ci: form.ci,
          email: form.email,
          nombre: form.nombre,
          apellido: form.apellido,
          password: form.password,
          telefono: form.telefono,
          tipoUsuario: form.tipoUsuario,
        },
      },
    }).catch(e => setError(e.message))
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Usuarios</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-slate-800 text-white px-3 py-2 sm:px-4 rounded-lg text-sm hover:bg-slate-700"
        >
          <UserPlus size={16} />
          <span className="hidden sm:inline">Nuevo usuario</span>
          <span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      {/* Formulario crear */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-4 sm:p-6 mb-6">
          <h2 className="font-semibold text-slate-700 mb-4">Nuevo usuario</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { key: 'ci', label: 'CI', type: 'text' },
              { key: 'email', label: 'Email', type: 'email' },
              { key: 'nombre', label: 'Nombre', type: 'text' },
              { key: 'apellido', label: 'Apellido', type: 'text' },
              { key: 'telefono', label: 'Teléfono', type: 'text' },
              { key: 'password', label: 'Contraseña', type: 'password' },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                <input
                  type={type}
                  autoComplete="new-password"
                  value={form[key as keyof typeof form]}
                  onChange={e => setForm({ ...form, [key]: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
              </div>
            ))}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de usuario (asigna el rol)</label>
              <select
                value={form.tipoUsuario}
                onChange={e => setForm({ ...form, tipoUsuario: e.target.value })}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="estudiante">Estudiante</option>
                <option value="docente">Docente</option>
                <option value="personal">Personal Administrativo</option>
              </select>
            </div>
          </div>
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          <div className="flex gap-3 mt-4">
            <button onClick={handleCrear} className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700">
              Guardar
            </button>
            <button onClick={() => setShowForm(false)} className="border border-slate-300 px-4 py-2 rounded-lg text-sm hover:bg-slate-50">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl p-8 text-center text-slate-500 text-sm">Cargando...</div>
      ) : queryError ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-red-600 text-sm font-medium mb-1">Error al cargar usuarios</p>
          <p className="text-slate-400 text-xs">{queryError.message}</p>
          <button onClick={() => refetch()} className="mt-3 text-xs text-blue-600 hover:underline">Reintentar</button>
        </div>
      ) : !data?.usuarios?.length ? (
        <div className="bg-white rounded-xl p-8 text-center text-slate-400 text-sm">No hay usuarios registrados</div>
      ) : (
        <>
          {/* ── Vista mobile: cards ── */}
          <div className="sm:hidden space-y-3">
            {data.usuarios.map((u: Usuario) => (
              <div key={u.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold text-slate-800">{u.nombreCompleto}</p>
                    <p className="text-xs font-mono text-slate-500">{u.ci}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{u.email}</p>
                    {u.telefono && <p className="text-xs text-slate-400">{u.telefono}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {u.roles.length > 0
                      ? u.roles.map(r => (
                          <span key={r.nombre} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{r.nombre}</span>
                        ))
                      : <span className="text-xs text-slate-400">Sin rol</span>
                    }
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <select
                    value={rolSeleccionado[u.id] || ''}
                    onChange={e => setRolSeleccionado({ ...rolSeleccionado, [u.id]: e.target.value })}
                    className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-xs"
                  >
                    <option value="">Seleccionar rol...</option>
                    {rolesData?.roles?.map((r: Rol) => (
                      <option key={r.id} value={r.id}>{r.nombre}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { if (rolSeleccionado[u.id]) asignarRol({ variables: { usuarioId: u.id, rolId: parseInt(rolSeleccionado[u.id]) } }) }}
                    className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                  >
                    <UserCheck size={15} />
                  </button>
                  <button
                    onClick={() => { if (confirm(`¿Desactivar a ${u.nombreCompleto}?`)) desactivar({ variables: { id: u.id } }) }}
                    className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ── Vista desktop: tabla ── */}
          <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['CI', 'Nombre', 'Email', 'Teléfono', 'Roles', 'Asignar rol', 'Acciones'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.usuarios.map((u: Usuario) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-600">{u.ci}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{u.nombreCompleto}</td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3 text-slate-600">{u.telefono || '—'}</td>
                    <td className="px-4 py-3">
                      {u.roles.length > 0
                        ? u.roles.map(r => (
                            <span key={r.nombre} className="inline-block bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full mr-1">
                              {r.nombre}
                            </span>
                          ))
                        : <span className="text-slate-400 text-xs">Sin rol</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={rolSeleccionado[u.id] || ''}
                          onChange={e => setRolSeleccionado({ ...rolSeleccionado, [u.id]: e.target.value })}
                          className="border border-slate-300 rounded px-2 py-1 text-xs"
                        >
                          <option value="">Seleccionar...</option>
                          {rolesData?.roles?.map((r: Rol) => (
                            <option key={r.id} value={r.id}>{r.nombre}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => { if (rolSeleccionado[u.id]) asignarRol({ variables: { usuarioId: u.id, rolId: parseInt(rolSeleccionado[u.id]) } }) }}
                          className="text-blue-600 hover:text-blue-800" title="Asignar rol"
                        >
                          <UserCheck size={15} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { if (confirm(`¿Desactivar a ${u.nombreCompleto}?`)) desactivar({ variables: { id: u.id } }) }}
                        className="text-red-500 hover:text-red-700" title="Desactivar usuario"
                      >
                        <Trash2 size={15} />
                      </button>
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
