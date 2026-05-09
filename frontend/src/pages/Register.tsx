import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import { Car, ArrowLeft } from 'lucide-react'
import { CREAR_USUARIO_MUTATION } from '../graphql/mutations/usuarios'

export default function Register() {
  const navigate = useNavigate()
  const TIPOS = [
    { value: 'estudiante', label: 'Estudiante' },
    { value: 'docente',    label: 'Docente' },
    { value: 'personal',   label: 'Personal Administrativo' },
  ]

  const [form, setForm] = useState({
    ci: '', nombre: '', apellido: '', email: '', telefono: '',
    password: '', confirmar: '', tipo_usuario: 'estudiante',
  })
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)

  const [crearUsuario, { loading }] = useMutation(CREAR_USUARIO_MUTATION, {
    onCompleted() {
      setExito(true)
      setTimeout(() => navigate('/login'), 2500)
    },
    onError(err) {
      setError(err.message)
    },
  })

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.ci || !form.nombre || !form.apellido || !form.email || !form.password) {
      setError('Los campos CI, nombre, apellido, email y contraseña son obligatorios')
      return
    }
    if (form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (form.password !== form.confirmar) {
      setError('Las contraseñas no coinciden')
      return
    }
    crearUsuario({
      variables: {
        input: {
          ci: form.ci.trim(),
          nombre: form.nombre.trim(),
          apellido: form.apellido.trim(),
          email: form.email.trim(),
          telefono: form.telefono.trim(),
          password: form.password,
          tipoUsuario: form.tipo_usuario,
        },
      },
    })
  }

  if (exito) {
    return (
      <div className="min-h-screen bg-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">¡Registro exitoso!</h2>
          <p className="text-slate-500 text-sm">Tu cuenta fue creada. Redirigiendo al login...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-6">
          <div className="bg-slate-800 text-white p-3 rounded-xl mb-3">
            <Car size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Crear cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">Sistema de Control Vehicular</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de usuario */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Soy... *</label>
            <div className="grid grid-cols-3 gap-2">
              {TIPOS.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('tipo_usuario', t.value)}
                  className={`py-2.5 rounded-lg text-sm font-medium border transition-colors
                    ${form.tipo_usuario === t.value
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">CI *</label>
              <input
                type="text"
                value={form.ci}
                onChange={e => set('ci', e.target.value)}
                placeholder="12345678"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
              <input
                type="text"
                value={form.telefono}
                onChange={e => set('telefono', e.target.value)}
                placeholder="7xxxxxxx"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nombre *</label>
              <input
                type="text"
                value={form.nombre}
                onChange={e => set('nombre', e.target.value)}
                placeholder="Juan"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Apellido *</label>
              <input
                type="text"
                value={form.apellido}
                onChange={e => set('apellido', e.target.value)}
                placeholder="Pérez"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              placeholder="juan@universidad.edu.bo"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Contraseña *</label>
              <input
                type="password"
                value={form.password}
                onChange={e => set('password', e.target.value)}
                placeholder="Mín. 8 caracteres"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Confirmar *</label>
              <input
                type="password"
                value={form.confirmar}
                onChange={e => set('confirmar', e.target.value)}
                placeholder="Repetir contraseña"
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Registrando...' : 'Crear cuenta'}
          </button>

          <Link
            to="/login"
            className="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-700 mt-2"
          >
            <ArrowLeft size={14} />
            Ya tengo cuenta
          </Link>
        </form>
      </div>
    </div>
  )
}
