import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import {
  Lock, Save, CheckCircle, AlertCircle, Calendar, ShieldCheck, Shield,
  ShieldOff, Smartphone, Copy, Check, Sun, Moon, Monitor, Camera, Upload,
  MessageCircle,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme, type Theme } from '../hooks/useTheme'
import { ACTUALIZAR_USUARIO_MUTATION, CAMBIAR_PASSWORD_MUTATION } from '../graphql/mutations/usuarios'
import { INICIAR_2FA_MUTATION, VERIFICAR_2FA_MUTATION, DESACTIVAR_2FA_MUTATION } from '../graphql/mutations/auth'

// Query extendida — incluye totpActivo para saber si 2FA está habilitado
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
      whatsappActivo
      dateJoined
      isSuperuser
      totpActivo
      fotoUrl
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
  const { data, loading, refetch } = useQuery(ME_PERFIL_QUERY)
  const me = data?.me
  const theme = useTheme()
  const [fotoPreview, setFotoPreview] = useState<string | null>(me?.fotoUrl ?? usuario.fotoUrl ?? null)
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const [fotoMsg, setFotoMsg] = useState('')
  const fotoInputRef = useRef<HTMLInputElement>(null)

  // Actualizar preview cuando llegan datos de la query
  useEffect(() => {
    if (me?.fotoUrl) setFotoPreview(me.fotoUrl)
  }, [me?.fotoUrl])

  async function handleSubirFoto(archivo: File) {
    if (archivo.size > 3 * 1024 * 1024) { setFotoMsg('La foto supera 3 MB'); return }
    setSubiendoFoto(true); setFotoMsg('')
    const form = new FormData()
    form.append('foto', archivo)
    const token = localStorage.getItem('access_token') ?? ''
    const base = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
    try {
      // Pasar token como query param (mismo patrón que PDFs) para evitar problemas CORS con Authorization header
      const resp = await fetch(`${base}/api/perfil/foto/?token=${encodeURIComponent(token)}`, {
        method: 'POST', body: form,
      })
      const json = await resp.json()
      if (resp.ok) {
        setFotoPreview(json.url)
        setFotoMsg('✓ Foto actualizada')
        // Actualizar localStorage para que el sidebar la muestre
        const stored = JSON.parse(localStorage.getItem('usuario') || '{}')
        localStorage.setItem('usuario', JSON.stringify({ ...stored, fotoUrl: json.url }))
        refetch()
      } else {
        setFotoMsg(json.error ?? 'Error al subir la foto')
      }
    } catch { setFotoMsg('Error de conexión') }
    finally { setSubiendoFoto(false) }
  }

  // Inicializar desde localStorage para no mostrar campos vacíos mientras carga
  const [perfil, setPerfil] = useState(() => {
    const nc = (usuario.nombreCompleto || '').trim().split(' ')
    return {
      nombre:         nc[0] ?? '',
      apellido:       nc.slice(1).join(' ') ?? '',
      email:          usuario.email ?? '',
      telefono:       '',
      whatsappActivo: false,
    }
  })
  const [perfilMsg, setPerfilMsg] = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null)

  const [pass, setPass] = useState({ actual: '', nuevo: '', confirmar: '' })
  const [passMsg,  setPassMsg]  = useState<{ tipo: 'ok' | 'err'; msg: string } | null>(null)

  // Cuando llegan datos del servidor, sobreescribir
  useEffect(() => {
    if (!me) return
    setPerfil({
      nombre:         me.nombre          ?? '',
      apellido:       me.apellido        ?? '',
      email:          me.email           ?? '',
      telefono:       me.telefono        ?? '',
      whatsappActivo: me.whatsappActivo  ?? false,
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
      setPerfilMsg({ tipo: 'ok', msg: 'Perfil actualizado. Actualizando la sesión...' })
      // Recargar tras 1.5s para que el sidebar y el header reflejen el nuevo nombre
      setTimeout(() => window.location.reload(), 1500)
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
          nombre:         perfil.nombre.trim(),
          apellido:       perfil.apellido.trim(),
          email:          perfil.email.trim(),
          telefono:       perfil.telefono.trim(),
          whatsappActivo: perfil.whatsappActivo,
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

        {/* ── Tarjeta de identidad + foto de perfil ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-start gap-6">

            {/* Avatar con clic para cambiar foto — w-24=96px, un poco más grande */}
            <div className="relative group shrink-0">
              {fotoPreview ? (
                <img src={fotoPreview} alt="Foto de perfil"
                  className="w-24 h-24 rounded-full object-cover shadow-md border-2 border-slate-200" />
              ) : (
                <Avatar nombre={me?.nombreCompleto ?? usuario.nombreCompleto ?? ''} />
              )}
              {/* Overlay de cámara al hacer hover */}
              <label className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                {subiendoFoto
                  ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Camera size={20} className="text-white" />
                }
                <input ref={fotoInputRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleSubirFoto(f) }} />
              </label>
            </div>
            {fotoMsg && (
              <p className="text-xs text-emerald-600 mt-1">{fotoMsg}</p>
            )}
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

        {/* ── Apariencia — compacta ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
              {theme.isDark ? <Moon size={13} /> : <Sun size={13} />}
              Apariencia
            </h3>
            <span className="text-[10px] text-slate-400">
              {theme.isDark ? '🌙 Oscuro' : '☀️ Claro'}
            </span>
          </div>
          <div className="flex gap-2">
            {([
              { id: 'light', label: 'Claro',       icon: Sun,     },
              { id: 'dark',  label: 'Oscuro',       icon: Moon,    },
              { id: 'auto',  label: 'Automático',   icon: Monitor, },
            ] as { id: Theme; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => theme.setTheme(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg border transition-all text-xs font-medium ${
                  theme.preference === id
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-300'
                }`}>
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            Automático: oscuro 6 PM – 6 AM
          </p>
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

              {/* ── Notificaciones WhatsApp ─────────────────────────────── */}
              <div className={`rounded-2xl border-2 p-4 transition-all ${
                perfil.whatsappActivo
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-slate-200 bg-slate-50'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                      perfil.whatsappActivo ? 'bg-emerald-100' : 'bg-slate-100'
                    }`}>
                      <MessageCircle size={18} className={perfil.whatsappActivo ? 'text-emerald-600' : 'text-slate-400'} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-sm">Notificaciones por WhatsApp</p>
                      <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">
                        Recibe mensajes automáticos cuando tu vehículo entre al campus,
                        se registre una infracción o tengas una visita.
                      </p>
                      {perfil.whatsappActivo && !perfil.telefono && (
                        <p className="text-amber-600 text-xs mt-1.5 font-semibold">
                          ⚠ Agrega tu número de teléfono para recibir mensajes
                        </p>
                      )}
                      {perfil.whatsappActivo && perfil.telefono && (
                        <p className="text-emerald-600 text-xs mt-1.5 font-semibold">
                          ✓ Los mensajes llegarán al{' '}
                          {perfil.telefono.startsWith('+') || perfil.telefono.startsWith('591')
                            ? perfil.telefono
                            : `+591 ${perfil.telefono}`}
                        </p>
                      )}
                    </div>
                  </div>
                  {/* Toggle switch moderno */}
                  <button
                    type="button"
                    onClick={() => setPerfil(p => ({ ...p, whatsappActivo: !p.whatsappActivo }))}
                    className={`relative shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                      perfil.whatsappActivo ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                    aria-label="Activar WhatsApp"
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      perfil.whatsappActivo ? 'translate-x-6' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>

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

        {/* ── Sección 2FA ── */}
        <Seccion2FA totpActivo={!!me?.totpActivo} onCambio={() => window.location.reload()} />

      </div>
    </div>
  )
}

// ── Componente 2FA ─────────────────────────────────────────
type Estado2FA = 'reposo' | 'configurando' | 'desactivando'

function Seccion2FA({ totpActivo, onCambio }: { totpActivo: boolean; onCambio: () => void }) {
  const [estado, setEstado]           = useState<Estado2FA>('reposo')
  const [qrUrl, setQrUrl]             = useState('')
  const [secreto, setSecreto]         = useState('')
  const [codigo, setCodigo]           = useState('')
  const [copiado, setCopiado]         = useState(false)
  const [msg, setMsg]                 = useState<{ tipo: 'ok' | 'err'; text: string } | null>(null)

  const [iniciar2FA,  { loading: loadingIniciar }] = useMutation(INICIAR_2FA_MUTATION, {
    onCompleted(d) {
      setQrUrl(d.iniciarConfiguracion2fa.otpauthUrl)
      setSecreto(d.iniciarConfiguracion2fa.secretBase32)
      setEstado('configurando')
      setMsg(null)
    },
    onError(e) { setMsg({ tipo: 'err', text: e.message }) },
  })

  const [verificar2FA, { loading: loadingVerif }] = useMutation(VERIFICAR_2FA_MUTATION, {
    onCompleted(d) {
      if (d.verificarConfiguracion2fa.ok) {
        setMsg({ tipo: 'ok', text: '2FA activado. Tu cuenta ahora está protegida.' })
        setEstado('reposo')
        setCodigo('')
        setTimeout(onCambio, 1500)
      }
    },
    onError(e) { setMsg({ tipo: 'err', text: e.message }) },
  })

  const [desactivar2FA, { loading: loadingDesact }] = useMutation(DESACTIVAR_2FA_MUTATION, {
    onCompleted(d) {
      if (d.desactivar2fa.ok) {
        setMsg({ tipo: 'ok', text: '2FA desactivado.' })
        setEstado('reposo')
        setCodigo('')
        setTimeout(onCambio, 1500)
      }
    },
    onError(e) { setMsg({ tipo: 'err', text: e.message }) },
  })

  function copiarSecreto() {
    navigator.clipboard.writeText(secreto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  // Genera imagen QR desde la URL otpauth://
  const qrImageUrl = qrUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`
    : ''

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 mt-0">
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${totpActivo ? 'bg-blue-100' : 'bg-slate-100'}`}>
            {totpActivo
              ? <ShieldCheck size={18} className="text-blue-600" />
              : <ShieldOff size={18} className="text-slate-400" />
            }
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-700">Autenticación de doble factor</h3>
            <p className={`text-xs mt-0.5 font-medium ${totpActivo ? 'text-blue-600' : 'text-slate-400'}`}>
              {totpActivo ? '✓ Activo — tu cuenta está protegida con 2FA' : 'No activado'}
            </p>
          </div>
        </div>
        {estado === 'reposo' && (
          <button
            onClick={() => {
              setMsg(null); setCodigo('')
              if (totpActivo) setEstado('desactivando')
              else iniciar2FA()
            }}
            disabled={loadingIniciar}
            className={`text-xs font-semibold px-4 py-2 rounded-xl border transition-colors disabled:opacity-50 ${
              totpActivo
                ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
            }`}
          >
            {loadingIniciar ? 'Iniciando...' : totpActivo ? 'Desactivar 2FA' : 'Activar 2FA'}
          </button>
        )}
      </div>

      {/* Qué es 2FA — solo cuando no está activo y en reposo */}
      {!totpActivo && estado === 'reposo' && (
        <div className="flex items-start gap-3 bg-slate-50 rounded-xl p-4 text-xs text-slate-500">
          <Smartphone size={18} className="text-slate-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-slate-600">¿Qué es el doble factor?</p>
            <p>Añade una segunda capa de seguridad. Al iniciar sesión necesitarás el código de 6 dígitos que genera tu app de autenticación (Google Authenticator, Authy, etc.).</p>
            <p className="text-slate-400">Recomendado para Administradores y Guardias.</p>
          </div>
        </div>
      )}

      {/* ── Flujo de activación: paso 1 escanear QR ── */}
      {estado === 'configurando' && (
        <div className="space-y-5">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 space-y-1">
            <p className="font-semibold text-sm">Paso 1 — Escanea este código QR</p>
            <p>Abre <strong>Google Authenticator</strong> o <strong>Authy</strong> → toca el <strong>+</strong> → "Escanear código QR".</p>
          </div>

          {/* QR generado via servicio externo de imagen */}
          {qrImageUrl && (
            <div className="flex flex-col items-center gap-3">
              <div className="border-2 border-slate-200 rounded-2xl p-3 bg-white">
                <img src={qrImageUrl} alt="QR para Google Authenticator" width={180} height={180} />
              </div>
              <p className="text-xs text-slate-400 text-center">
                ¿No puedes escanear? Ingresa este código manualmente:
              </p>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2">
                <code className="text-xs font-mono text-slate-700 tracking-widest break-all">
                  {secreto}
                </code>
                <button onClick={copiarSecreto} title="Copiar secreto"
                  className="text-slate-400 hover:text-slate-600 shrink-0 ml-1">
                  {copiado ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 space-y-1">
            <p className="font-semibold text-sm">Paso 2 — Confirma con el primer código</p>
            <p>Escribe el código de 6 dígitos que aparece en tu app para confirmar que la configuración fue correcta.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
              Código de 6 dígitos de tu app
            </label>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={codigo}
              onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
            />
          </div>

          {msg && (
            <div className={`text-sm px-4 py-3 rounded-xl flex items-center gap-2 ${
              msg.tipo === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {msg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
              {msg.text}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setEstado('reposo'); setMsg(null); setCodigo('') }}
              className="flex-1 border border-slate-300 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => verificar2FA({ variables: { codigo } })}
              disabled={loadingVerif || codigo.length < 6}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {loadingVerif ? 'Verificando...' : 'Activar 2FA'}
            </button>
          </div>
        </div>
      )}

      {/* ── Flujo de desactivación ── */}
      {estado === 'desactivando' && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 space-y-1">
            <p className="font-semibold text-sm">Confirma con tu app de autenticación</p>
            <p>Para desactivar el 2FA necesitas el código de tu app. Esto protege contra desactivación no autorizada.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
              Código de 6 dígitos actual
            </label>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={codigo}
              onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-400 transition-all"
            />
          </div>

          {msg && (
            <div className={`text-sm px-4 py-3 rounded-xl flex items-center gap-2 ${
              msg.tipo === 'ok'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {msg.tipo === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
              {msg.text}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setEstado('reposo'); setMsg(null); setCodigo('') }}
              className="flex-1 border border-slate-300 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => desactivar2FA({ variables: { codigo } })}
              disabled={loadingDesact || codigo.length < 6}
              className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
            >
              {loadingDesact ? 'Desactivando...' : 'Confirmar desactivación'}
            </button>
          </div>
        </div>
      )}

      {/* Éxito en reposo */}
      {estado === 'reposo' && msg?.tipo === 'ok' && (
        <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <CheckCircle size={15} /> {msg.text}
        </div>
      )}
    </div>
  )
}
