import { useState, useEffect } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import { Lock, Save, CheckCircle, AlertCircle, Calendar, ShieldCheck } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ACTUALIZAR_USUARIO_MUTATION, CAMBIAR_PASSWORD_MUTATION } from '../graphql/mutations/usuarios'

// Query extendida: incluye nombre, apellido y dateJoined por separado
const ME_PERFIL_QUERY = gql`
  query MePerfil {
    me {
      id
      ci
      nombre
      apellido
      nombreCompleto
      email
      telefono
      dateJoined
      isSuperuser
      roles { nombre }
    }
  }
`

// ── Avatar con iniciales ───────────────────────────────────
function Avatar({ nombre }: { nombre: string }) {
  const initials = nombre
    .split(' ')
    .filter(Boolean)
    .map(n => n[0].toUpperCase())
    .slice(0, 2)
    .join('')
  return (
    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white text-2xl font-bold shadow-md shrink-0">
      {initials || '?'}
    </div>
  )
}

// ── Indicador de fuerza de contraseña ─────────────────────
function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]
  const score = checks.filter(Boolean).length
  const labels = ['', 'Muy débil', 'Débil', 'Buena', 'Fuerte']
  const colors = ['', 'bg-red-400', 'bg-amber-400', 'bg-blue-400', 'bg-emerald-500']
  const textColors = ['', 'text-red-500', 'text-amber-500', 'text-blue-500', 'text-emerald-600']
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= score ? colors[score] : 'bg-slate-200'}`} />
        ))}
      </div>
      <p className={`text-xs ${textColors[score]}`}>{labels[score]}</p>
    </div>
  )
}

// ── Campo de formulario ────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all placeholder:text-slate-300"
    />
  )
}

// ── Alerta de resultado ────────────────────────────────────
function Alert({ tipo, msg }: { tipo: 'ok' | 'err'; msg: string }) {
  const base = 'flex items-center gap-2 text-sm px-4 py-3 rounded-xl mt-4'
  return tipo === 'ok'
    ? <div className={`${base} bg-emerald-50 text-emerald-700 border border-emerald-200`}><CheckCircle size={16} className="shrink-0" />{msg}</div>
    : <div className={`${base} bg-red-50 text-red-700 border border-red-200`}><AlertCircle size={16} className="shrink-0" />{msg}</div>
}

// ── Badge de rol ───────────────────────────────────────────
function RolBadge({ nombre }: { nombre: string }) {
  const colores: Record<string, string> = {
    'Administrador':          'bg-blue-100 text-blue-700 border-blue-200',
    'Guardia':                'bg-orange-100 text-orange-700 border-orange-200',
    'Estudiante':             'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Docente':                'bg-violet-100 text-violet-700 border-violet-200',
    'Personal Administrativo':'bg-amber-100 text-amber-700 border-amber-200',
  }
  const cls = colores[nombre] ?? 'bg-slate-100 text-slate-600 border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${cls}`}>
      <ShieldCheck size={11} />
      {nombre}
    </span>
  )
}

// ── Componente principal ───────────────────────────────────
export default function Perfil() {
  const { usuario } = useAuth()
  const { data, loading } = useQuery(ME_PERFIL_QUERY)
  const me = data?.me

  // Inicializar desde localStorage para no mostrar campos vacíos mientras carga
  const [perfil, setPerfil] = useState(() => {
    const nc = (usuario.nombreCompleto || '').trim().split(' ')
    return {
      nombre:    nc[0] ?? '',
      apellido:  nc.slice(1).join(' ') ?? '',
      email:     usuario.email ?? '',
      telefono:  '',
    }
  })
  const [perfilMsg, setPerfilMsg] = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null)

  const [pass, setPass] = useState({ actual: '', nuevo: '', confirmar: '' })
  const [passMsg,  setPassMsg]  = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null)

  // Cuando llegan datos del servidor, sobreescribir
  useEffect(() => {
    if (!me) return
    setPerfil({
      nombre:   me.nombre    ?? '',
      apellido: me.apellido  ?? '',
      email:    me.email     ?? '',
      telefono: me.telefono  ?? '',
    })
  }, [me])

  const [actualizarUsuario, { loading: savingPerfil }] = useMutation(ACTUALIZAR_USUARIO_MUTATION, {
    onCompleted(data) {
      const u = data.actualizarUsuario
      const stored = JSON.parse(localStorage.getItem('usuario') || '{}')
      localStorage.setItem('usuario', JSON.stringify({
        ...stored,
        nombreCompleto: u.nombreCompleto,
        email: u.email,
      }))
      setPerfilMsg({ tipo: 'ok', msg: 'Perfil actualizado. Los cambios se reflejarán en el sidebar al recargar.' })
    },
    onError(e) { setPerfilMsg({ tipo: 'err', msg: e.message }) },
  })

  const [cambiarPassword, { loading: savingPass }] = useMutation(CAMBIAR_PASSWORD_MUTATION, {
    onCompleted() {
      setPassMsg({ tipo: 'ok', msg: 'Contraseña cambiada. Por seguridad, vuelve a iniciar sesión.' })
      setPass({ actual: '', nuevo: '', confirmar: '' })
    },
    onError(e) { setPassMsg({ tipo: 'err', msg: e.message }) },
  })

  function handleGuardarPerfil() {
    setPerfilMsg(null)
    if (!perfil.nombre || !perfil.apellido || !perfil.email) {
      setPerfilMsg({ tipo: 'err', msg: 'Nombre, apellido y email son obligatorios.' })
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(perfil.email)) {
      setPerfilMsg({ tipo: 'err', msg: 'El email no tiene un formato válido.' })
      return
    }
    actualizarUsuario({
      variables: {
        id: me?.id ?? usuario.id,
        input: {
          nombre:   perfil.nombre.trim(),
          apellido: perfil.apellido.trim(),
          email:    perfil.email.trim(),
          telefono: perfil.telefono.trim(),
        },
      },
    })
  }

  function handleCambiarPass() {
    setPassMsg(null)
    if (!pass.actual || !pass.nuevo || !pass.confirmar) {
      setPassMsg({ tipo: 'err', msg: 'Todos los campos son obligatorios.' })
      return
    }
    if (pass.nuevo !== pass.confirmar) {
      setPassMsg({ tipo: 'err', msg: 'La nueva contraseña y la confirmación no coinciden.' })
      return
    }
    if (pass.nuevo.length < 8) {
      setPassMsg({ tipo: 'err', msg: 'La nueva contraseña debe tener al menos 8 caracteres.' })
      return
    }
    if (pass.nuevo === pass.actual) {
      setPassMsg({ tipo: 'err', msg: 'La nueva contraseña debe ser diferente a la actual.' })
      return
    }
    cambiarPassword({ variables: { passwordActual: pass.actual, passwordNuevo: pass.nuevo } })
  }

  // Fecha de registro formateada
  const fechaMiembro = me?.dateJoined
    ? new Date(me.dateJoined).toLocaleDateString('es-BO', { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  // Roles a mostrar (incluyendo Administrador si es superuser sin rol en BD)
  const roles: string[] = me?.roles?.map((r: { nombre: string }) => r.nombre) ?? []
  const rolesDisplay = roles.length > 0
    ? roles
    : (me?.isSuperuser || usuario.isSuperuser) ? ['Administrador'] : []

  return (
    <div className="p-8 bg-slate-50 min-h-full">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* ── Encabezado ── */}
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Mi perfil</h1>
          <p className="text-slate-400 text-sm mt-1">Gestiona tu información personal y seguridad de cuenta</p>
        </div>

        {/* ── Tarjeta de identidad ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-start gap-6">
            <Avatar nombre={me?.nombreCompleto ?? usuario.nombreCompleto ?? ''} />
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-slate-800 truncate">
                {me?.nombreCompleto ?? usuario.nombreCompleto ?? 'Usuario'}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5 font-mono">
                CI: {me?.ci ?? usuario.ci ?? '—'}
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {rolesDisplay.map(r => <RolBadge key={r} nombre={r} />)}
                {rolesDisplay.length === 0 && (
                  <span className="text-xs text-slate-400 italic">Sin rol asignado</span>
                )}
              </div>
              {fechaMiembro && (
                <p className="flex items-center gap-1.5 text-xs text-slate-400 mt-3">
                  <Calendar size={12} />
                  Miembro desde el {fechaMiembro}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Grid: Info + Contraseña ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Información personal ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-5 pb-3 border-b border-slate-100">
              Información personal
            </h3>
            {loading ? (
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <Field label="Nombre">
                  <Input
                    value={perfil.nombre}
                    onChange={e => setPerfil({ ...perfil, nombre: e.target.value })}
                    placeholder="Tu nombre"
                    autoComplete="given-name"
                  />
                </Field>
                <Field label="Apellido">
                  <Input
                    value={perfil.apellido}
                    onChange={e => setPerfil({ ...perfil, apellido: e.target.value })}
                    placeholder="Tu apellido"
                    autoComplete="family-name"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={perfil.email}
                    onChange={e => setPerfil({ ...perfil, email: e.target.value })}
                    placeholder="correo@ejemplo.com"
                    autoComplete="email"
                  />
                </Field>
                <Field label="Teléfono">
                  <Input
                    type="tel"
                    value={perfil.telefono}
                    onChange={e => setPerfil({ ...perfil, telefono: e.target.value })}
                    placeholder="Ej: 70000000"
                    autoComplete="tel"
                  />
                </Field>
              </div>
            )}

            {perfilMsg && <Alert tipo={perfilMsg.tipo} msg={perfilMsg.msg} />}

            <button
              onClick={handleGuardarPerfil}
              disabled={savingPerfil || loading}
              className="mt-5 w-full flex items-center justify-center gap-2 bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <Save size={15} />
              {savingPerfil ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>

          {/* ── Cambiar contraseña ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-5 pb-3 border-b border-slate-100">
              Cambiar contraseña
            </h3>

            {/* Campo trampa para confundir el autocomplete del browser */}
            <input type="password" name="fake_pass" className="hidden" aria-hidden="true" tabIndex={-1} />

            <div className="space-y-4">
              <Field label="Contraseña actual">
                <Input
                  type="password"
                  value={pass.actual}
                  onChange={e => setPass({ ...pass, actual: e.target.value })}
                  placeholder="Tu contraseña actual"
                  autoComplete="current-password"
                />
              </Field>
              <Field label="Nueva contraseña">
                <Input
                  type="password"
                  value={pass.nuevo}
                  onChange={e => setPass({ ...pass, nuevo: e.target.value })}
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                />
                <PasswordStrength password={pass.nuevo} />
              </Field>
              <Field label="Confirmar nueva contraseña">
                <Input
                  type="password"
                  value={pass.confirmar}
                  onChange={e => setPass({ ...pass, confirmar: e.target.value })}
                  placeholder="Repite la nueva contraseña"
                  autoComplete="new-password"
                />
                {pass.confirmar && pass.nuevo !== pass.confirmar && (
                  <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
                )}
                {pass.confirmar && pass.nuevo === pass.confirmar && pass.nuevo.length >= 8 && (
                  <p className="text-xs text-emerald-600 mt-1">✓ Las contraseñas coinciden</p>
                )}
              </Field>
            </div>

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              Usa mayúsculas, números y símbolos para una contraseña más segura.
            </div>

            {passMsg && <Alert tipo={passMsg.tipo} msg={passMsg.msg} />}

            <button
              onClick={handleCambiarPass}
              disabled={savingPass}
              className="mt-5 w-full flex items-center justify-center gap-2 bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <Lock size={15} />
              {savingPass ? 'Cambiando...' : 'Cambiar contraseña'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
