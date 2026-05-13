import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import { Car, ArrowLeft, CheckCircle, Eye, EyeOff } from 'lucide-react'
import { CREAR_USUARIO_MUTATION } from '../graphql/mutations/usuarios'

const TIPOS = [
  { value: 'estudiante', label: 'Estudiante' },
  { value: 'docente',    label: 'Docente' },
  { value: 'personal',   label: 'Personal Administrativo' },
]

function forcezaPassword(p: string): { nivel: number; texto: string; color: string } {
  if (p.length === 0) return { nivel: 0, texto: '', color: '' }
  let pts = 0
  if (p.length >= 8) pts++
  if (/[A-Z]/.test(p)) pts++
  if (/[0-9]/.test(p)) pts++
  if (/[^A-Za-z0-9]/.test(p)) pts++
  const map = [
    { nivel: 1, texto: 'Muy débil', color: 'bg-red-500' },
    { nivel: 2, texto: 'Débil',     color: 'bg-orange-500' },
    { nivel: 3, texto: 'Buena',     color: 'bg-yellow-500' },
    { nivel: 4, texto: 'Fuerte',    color: 'bg-emerald-500' },
  ]
  return map[Math.min(pts - 1, 3)] ?? map[0]
}

const inputBase = 'w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-colors'
const inputOk   = `${inputBase} border-slate-300 focus:ring-slate-500`
const inputErr  = `${inputBase} border-red-400 focus:ring-red-400 bg-red-50`

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    ci: '', nombre: '', apellido: '', email: '', telefono: '',
    password: '', confirmar: '', tipo_usuario: 'estudiante',
  })
  const [tocado, setTocado] = useState<Record<string, boolean>>({})
  const [verPass, setVerPass] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorServidor, setErrorServidor] = useState('')

  const [crearUsuario, { loading }] = useMutation(CREAR_USUARIO_MUTATION, {
    onCompleted() { setExito(true); setTimeout(() => navigate('/login'), 3000) },
    onError(err) { setErrorServidor(err.message) },
  })

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
    setErrorServidor('')
  }
  function blur(field: string) { setTocado(t => ({ ...t, [field]: true })) }

  // Validaciones individuales
  const v = {
    ci:       !form.ci.trim() && 'El CI es obligatorio',
    nombre:   !form.nombre.trim() && 'El nombre es obligatorio',
    apellido: !form.apellido.trim() && 'El apellido es obligatorio',
    email:    (!form.email.trim() && 'El email es obligatorio') ||
              (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) && 'Email inválido'),
    password: (!form.password && 'La contraseña es obligatoria') ||
              (form.password.length > 0 && form.password.length < 8 && 'Mínimo 8 caracteres'),
    confirmar: form.confirmar && form.password !== form.confirmar && 'Las contraseñas no coinciden',
  }

  const fortaleza = forcezaPassword(form.password)
  const hayError = Object.values(v).some(Boolean)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setTocado({ ci: true, nombre: true, apellido: true, email: true, password: true, confirmar: true })
    if (hayError) return
    setErrorServidor('')
    crearUsuario({
      variables: {
        input: {
          ci: form.ci.trim(), nombre: form.nombre.trim(), apellido: form.apellido.trim(),
          email: form.email.trim(), telefono: form.telefono.trim(),
          password: form.password, tipoUsuario: form.tipo_usuario,
        },
      },
    })
  }

  if (exito) return (
    <div className="min-h-screen bg-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center">
        <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mx-auto mb-4">
          <CheckCircle size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">¡Cuenta creada!</h2>
        <p className="text-slate-500 text-sm">Revisa tu email y redirigiendo al login...</p>
        <div className="mt-4 h-1 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 rounded-full animate-pulse" style={{ width: '100%' }} />
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 sm:p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="bg-slate-800 text-white p-3 rounded-xl mb-3">
            <Car size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Crear cuenta</h1>
          <p className="text-slate-500 text-sm mt-1">Sistema de Control Vehicular</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {/* Tipo */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Soy... *</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TIPOS.map(t => (
                <button key={t.value} type="button" onClick={() => set('tipo_usuario', t.value)}
                  className={`py-2.5 rounded-lg text-sm font-medium border transition-colors
                    ${form.tipo_usuario === t.value
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* CI + Teléfono */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">CI *</label>
              <input type="text" value={form.ci} placeholder="12345678"
                onChange={e => set('ci', e.target.value)} onBlur={() => blur('ci')}
                className={tocado.ci && v.ci ? inputErr : inputOk} />
              {tocado.ci && v.ci && <p className="text-red-500 text-xs mt-1">{v.ci}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Teléfono</label>
              <input type="text" value={form.telefono} placeholder="7xxxxxxx"
                onChange={e => set('telefono', e.target.value)}
                className={inputOk} />
            </div>
          </div>

          {/* Nombre + Apellido */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
              <input type="text" value={form.nombre} placeholder="Juan"
                onChange={e => set('nombre', e.target.value)} onBlur={() => blur('nombre')}
                className={tocado.nombre && v.nombre ? inputErr : inputOk} />
              {tocado.nombre && v.nombre && <p className="text-red-500 text-xs mt-1">{v.nombre}</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Apellido *</label>
              <input type="text" value={form.apellido} placeholder="Pérez"
                onChange={e => set('apellido', e.target.value)} onBlur={() => blur('apellido')}
                className={tocado.apellido && v.apellido ? inputErr : inputOk} />
              {tocado.apellido && v.apellido && <p className="text-red-500 text-xs mt-1">{v.apellido}</p>}
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Email *</label>
            <input type="email" value={form.email} placeholder="juan@gmail.com"
              onChange={e => set('email', e.target.value)} onBlur={() => blur('email')}
              className={tocado.email && v.email ? inputErr : inputOk} />
            {tocado.email && v.email && <p className="text-red-500 text-xs mt-1">{v.email}</p>}
          </div>

          {/* Contraseña */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Contraseña *</label>
            <div className="relative">
              <input type={verPass ? 'text' : 'password'} value={form.password}
                placeholder="Mín. 8 caracteres"
                onChange={e => set('password', e.target.value)} onBlur={() => blur('password')}
                className={`${tocado.password && v.password ? inputErr : inputOk} pr-10`} />
              <button type="button" onClick={() => setVerPass(!verPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {verPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {tocado.password && v.password && <p className="text-red-500 text-xs mt-1">{v.password}</p>}
            {form.password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1 h-1.5">
                  {[1,2,3,4].map(n => (
                    <div key={n} className={`flex-1 rounded-full transition-colors ${n <= fortaleza.nivel ? fortaleza.color : 'bg-slate-200'}`} />
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">{fortaleza.texto}</p>
              </div>
            )}
          </div>

          {/* Confirmar */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Confirmar contraseña *</label>
            <input type="password" value={form.confirmar} placeholder="Repetir contraseña"
              onChange={e => set('confirmar', e.target.value)} onBlur={() => blur('confirmar')}
              className={tocado.confirmar && v.confirmar ? inputErr : inputOk} />
            {tocado.confirmar && v.confirmar && <p className="text-red-500 text-xs mt-1">{v.confirmar}</p>}
          </div>

          {errorServidor && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5">
              {errorServidor}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Creando cuenta...
              </>
            ) : 'Crear cuenta'}
          </button>

          <Link to="/login"
            className="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-slate-700 mt-2">
            <ArrowLeft size={14} />
            Ya tengo cuenta
          </Link>
        </form>
      </div>
    </div>
  )
}
