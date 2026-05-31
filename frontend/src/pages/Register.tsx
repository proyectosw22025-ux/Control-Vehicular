import { useState, FormEvent, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import { ArrowLeft, CheckCircle, Eye, EyeOff, Users, UserCheck, Loader2, QrCode, Mail } from 'lucide-react'
import { CREAR_USUARIO_MUTATION } from '../graphql/mutations/usuarios'
import { PRE_REGISTRAR_VISITANTE_MUTATION } from '../graphql/mutations/visitantes'

// ── Tipos de usuario UAGRM ────────────────────────────────
const TIPOS_UAGRM = [
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

const inputBase = 'w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-colors bg-slate-50 focus:bg-white'
const inputOk   = `${inputBase} border-slate-200 focus:ring-slate-400 focus:border-transparent`
const inputErr  = `${inputBase} border-red-400 focus:ring-red-400 bg-red-50`

// ── Pantalla de éxito reutilizable ────────────────────────
function PantallaExito({ titulo, sub, onLogin }: { titulo: string; sub: string; onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center">
        <div className="flex items-center justify-center w-16 h-16 bg-emerald-100 rounded-full mx-auto mb-4">
          <CheckCircle size={32} className="text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">{titulo}</h2>
        <p className="text-slate-500 text-sm">{sub}</p>
        <button onClick={onLogin} className="mt-6 w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
          Volver al inicio
        </button>
      </div>
    </div>
  )
}

// ── Formulario de cuenta UAGRM ────────────────────────────
function FormularioCuenta() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    ci: '', nombre: '', apellido: '', email: '', telefono: '',
    password: '', confirmar: '', tipo_usuario: 'estudiante',
  })
  const [tocado, setTocado]         = useState<Record<string, boolean>>({})
  const [verPass, setVerPass]       = useState(false)
  const [exito, setExito]           = useState(false)
  const [errorServidor, setError]   = useState('')

  const [crearUsuario, { loading }] = useMutation(CREAR_USUARIO_MUTATION, {
    onCompleted() { setExito(true); setTimeout(() => navigate('/login'), 3000) },
    onError(err) { setError(err.message) },
  })

  function set(f: string, v: string) { setForm(p => ({ ...p, [f]: v })); setError('') }
  function blur(f: string) { setTocado(t => ({ ...t, [f]: true })) }

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
  const hayError = Object.values(v).some(Boolean)
  const fortaleza = forcezaPassword(form.password)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setTocado({ ci: true, nombre: true, apellido: true, email: true, password: true, confirmar: true })
    if (hayError) return
    crearUsuario({ variables: { input: {
      ci: form.ci.trim(), nombre: form.nombre.trim(), apellido: form.apellido.trim(),
      email: form.email.trim(), telefono: form.telefono.trim(),
      password: form.password, tipoUsuario: form.tipo_usuario,
    }}})
  }

  if (exito) return (
    <PantallaExito
      titulo="¡Cuenta creada!"
      sub="Revisa tu email. Redirigiendo al login..."
      onLogin={() => navigate('/login')}
    />
  )

  return (
    <div className="space-y-4">
      {/* Selector de tipo */}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-2">Soy... *</label>
        <div className="grid grid-cols-3 gap-2">
          {TIPOS_UAGRM.map(t => (
            <button key={t.value} type="button" onClick={() => set('tipo_usuario', t.value)}
              className={`py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                form.tipo_usuario === t.value
                  ? 'bg-slate-800 text-white border-slate-800 shadow-md'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
            onChange={e => set('telefono', e.target.value)} className={inputOk} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
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

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Email *</label>
        <input type="email" value={form.email} placeholder="juan@gmail.com"
          onChange={e => set('email', e.target.value)} onBlur={() => blur('email')}
          className={tocado.email && v.email ? inputErr : inputOk} />
        {tocado.email && v.email && <p className="text-red-500 text-xs mt-1">{v.email as string}</p>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Contraseña *</label>
        <div className="relative">
          <input type={verPass ? 'text' : 'password'} value={form.password}
            placeholder="Mín. 8 caracteres" autoComplete="new-password"
            onChange={e => set('password', e.target.value)} onBlur={() => blur('password')}
            className={`${tocado.password && v.password ? inputErr : inputOk} pr-10`} />
          <button type="button" onClick={() => setVerPass(!verPass)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            {verPass ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {tocado.password && v.password && <p className="text-red-500 text-xs mt-1">{v.password as string}</p>}
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

      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">Confirmar contraseña *</label>
        <input type="password" value={form.confirmar} placeholder="Repetir contraseña" autoComplete="new-password"
          onChange={e => set('confirmar', e.target.value)} onBlur={() => blur('confirmar')}
          className={tocado.confirmar && v.confirmar ? inputErr : inputOk} />
        {tocado.confirmar && v.confirmar && <p className="text-red-500 text-xs mt-1">{v.confirmar as string}</p>}
      </div>

      {errorServidor && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {errorServidor}
        </div>
      )}

      <button type="button" onClick={handleSubmit} disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50">
        {loading ? <><Loader2 size={15} className="animate-spin" /> Creando cuenta...</> : 'Crear cuenta'}
      </button>
    </div>
  )
}

// ── Formulario de pre-registro de visitante externo ────────
function FormularioVisitante() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    ci: '', nombre: '', apellido: '', telefono: '', email: '',
    procedencia: '', placa: '', destino: '',
  })
  const [exito,      setExito]     = useState(false)
  const [error,      setError]     = useState('')
  const [paso,       setPaso]      = useState<1 | 2>(1)
  const [paseCodigo, setPaseCodigo] = useState('')
  const [paseUrl,    setPaseUrl]   = useState('')
  const [emailOk,    setEmailOk]   = useState(false)
  const [qrDataUrl,  setQrDataUrl] = useState('')

  const [preRegistrar, { loading }] = useMutation(PRE_REGISTRAR_VISITANTE_MUTATION, {
    onCompleted(d) {
      const r = d.preRegistrarVisitante
      setPaseCodigo(r.paseCodigo)
      setPaseUrl(r.paseUrl)
      setEmailOk(r.emailEnviado)
      setExito(true)
    },
    onError(e) { setError(e.message) },
  })

  // Generar QR en el cliente cuando llega el código
  useEffect(() => {
    if (!paseCodigo) return
    import('qrcode').then(QRCode =>
      QRCode.toDataURL(paseCodigo, { width: 220, margin: 2, errorCorrectionLevel: 'H' })
        .then(setQrDataUrl)
    )
  }, [paseCodigo])

  function set(f: string, v: string) { setForm(p => ({ ...p, [f]: v })) }

  function handlePaso1(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.ci.trim() || !form.nombre.trim() || !form.apellido.trim()) {
      setError('CI, nombre y apellido son obligatorios')
      return
    }
    setPaso(2)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    preRegistrar({ variables: { input: {
      ci:                    form.ci.trim(),
      nombre:                form.nombre.trim(),
      apellido:              form.apellido.trim(),
      telefono:              form.telefono.trim(),
      email:                 form.email.trim(),
      procedencia:           form.procedencia.trim(),
      placaHabitual:         form.placa.trim().toUpperCase(),
      destinoSugeridoTexto:  form.destino.trim(),
    }}})
  }

  if (exito) return (
    <div className="text-center space-y-4">
      <div className="flex items-center justify-center w-14 h-14 bg-emerald-100 rounded-full mx-auto">
        <CheckCircle size={28} className="text-emerald-600" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-800">¡Tu pase está listo!</h2>
        <p className="text-slate-500 text-sm mt-1">Muestra este código QR al guardia en la portería</p>
      </div>

      {/* QR code */}
      {qrDataUrl ? (
        <div className="flex flex-col items-center gap-2 bg-slate-50 rounded-2xl p-4 border border-slate-200">
          <img src={qrDataUrl} alt="QR pase visitante"
            className="rounded-xl shadow-md" style={{ width: 180, height: 180 }} />
          <p className="font-mono font-black text-slate-700 text-lg tracking-[0.25em]">{paseCodigo}</p>
          <a href={paseUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-blue-600 text-xs hover:underline">
            <QrCode size={12} />
            Abrir mi pase completo
          </a>
        </div>
      ) : (
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200">
          <p className="font-mono font-black text-slate-700 text-2xl tracking-[0.3em]">{paseCodigo}</p>
          <p className="text-slate-400 text-xs mt-1">Tu código de acceso</p>
        </div>
      )}

      {/* Notificación de email */}
      {emailOk ? (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs text-blue-700">
          <Mail size={13} />
          <span>También te enviamos el pase a tu correo electrónico</span>
        </div>
      ) : form.email ? (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-700">
          <Mail size={13} />
          <span>
            El servidor de email no está configurado — guarda el <strong>código QR de arriba</strong>, lo necesitarás en la portería.
          </span>
        </div>
      ) : null}

      <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-4 text-left space-y-2 text-xs">
        <p className="font-bold text-cyan-800 text-sm">Al llegar a la UAGRM:</p>
        {[
          'Ve directamente a la garita de seguridad',
          'Muestra este QR al guardia — lo escanea en segundos',
          'El guardia ya tiene todos tus datos, no necesitas decir nada más',
        ].map((txt, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="font-bold text-cyan-600 shrink-0">{i + 1}.</span>
            <p className="text-cyan-700">{txt}</p>
          </div>
        ))}
      </div>

      {form.placa && (
        <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 text-xs text-violet-700">
          Tu vehículo <strong className="font-mono">{form.placa.toUpperCase()}</strong> ya está registrado.
        </div>
      )}

      <button onClick={() => navigate('/login')}
        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
        Volver al inicio
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Pasos visuales */}
      <div className="flex items-center gap-2 mb-2">
        {[1, 2].map(n => (
          <div key={n} className={`flex items-center gap-1.5 ${n < 2 ? 'flex-1' : ''}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              paso >= n ? 'bg-cyan-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}>{n}</div>
            <span className={`text-xs ${paso >= n ? 'text-cyan-700 font-semibold' : 'text-slate-400'}`}>
              {n === 1 ? 'Tus datos' : 'Tu visita'}
            </span>
            {n < 2 && <div className="flex-1 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      {paso === 1 && (
        <form onSubmit={handlePaso1} className="space-y-3">
          <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 text-xs text-cyan-800">
            <p className="font-semibold">¿Por qué pre-registrarse?</p>
            <p className="mt-0.5 opacity-80">El guardia ya tendrá tus datos. Tu ingreso tarda segundos, no minutos.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">CI / Documento de identidad *</label>
            <input type="text" value={form.ci} placeholder="Ej: 12345678"
              onChange={e => set('ci', e.target.value)} className={inputOk} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre *</label>
              <input type="text" value={form.nombre} placeholder="Juan"
                onChange={e => set('nombre', e.target.value)} className={inputOk} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Apellido *</label>
              <input type="text" value={form.apellido} placeholder="Pérez"
                onChange={e => set('apellido', e.target.value)} className={inputOk} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Teléfono</label>
              <input type="tel" value={form.telefono} placeholder="7xxxxxxx"
                onChange={e => set('telefono', e.target.value)} className={inputOk} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
              <input type="email" value={form.email} placeholder="tu@correo.com"
                onChange={e => set('email', e.target.value)} className={inputOk} />
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

          <button type="submit"
            className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
            Continuar →
          </button>
        </form>
      )}

      {paso === 2 && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
            <p className="font-semibold">Datos opcionales — ayudan al guardia</p>
            <p className="opacity-70 mt-0.5">Cuanto más completes, más rápido es tu ingreso</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">¿De dónde vienes?</label>
            <input type="text" value={form.procedencia} placeholder="Ej: Santa Cruz, Empresa ABC, La Paz..."
              onChange={e => set('procedencia', e.target.value)} className={inputOk} />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">¿A dónde vas en la universidad?</label>
            <input type="text" value={form.destino}
              placeholder="Ej: Secretaría de Admisiones, Biblioteca, Rectorado..."
              onChange={e => set('destino', e.target.value)} className={inputOk} />
            <p className="text-[10px] text-slate-400 mt-1">El guardia usará esto como referencia</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Placa de tu vehículo</label>
            <input type="text" value={form.placa}
              placeholder="Ej: ABC-123 · 123ABC · MOTO-456"
              maxLength={15}
              onChange={e => set('placa', e.target.value.toUpperCase())}
              style={{ textTransform: 'uppercase' }}
              className={`${inputOk} uppercase`} />
            <p className="text-[10px] text-slate-400 mt-1">Si vienes en moto, auto, etc. Deja vacío si vienes a pie o en taxi.</p>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setPaso(1)}
              className="px-4 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm">
              ← Atrás
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50">
              {loading ? <><Loader2 size={15} className="animate-spin" /> Registrando...</> : 'Pre-registrarme →'}
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-center">
            Puedes omitir el paso 2 y completarlo después si lo deseas
          </p>
        </form>
      )}
    </div>
  )
}

// ── Página principal ───────────────────────────────────────
type Flujo = 'uagrm' | 'visitante'

export default function Register() {
  const navigate = useNavigate()
  const [flujo, setFlujo] = useState<Flujo | null>(null)

  // Pantalla de selección de flujo
  if (!flujo) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <span className="text-white font-black text-xl tracking-tight">UV</span>
          </div>
          <h1 className="text-white font-bold text-xl">¿Quién eres?</h1>
          <p className="text-slate-400 text-sm mt-1">Selecciona tu tipo de acceso a la UAGRM</p>
        </div>

        <div className="space-y-3">
          {/* Opción UAGRM */}
          <button onClick={() => setFlujo('uagrm')}
            className="w-full bg-white rounded-2xl p-5 text-left hover:shadow-xl hover:-translate-y-0.5 transition-all group">
            <div className="flex items-center gap-4">
              <div className="bg-slate-100 group-hover:bg-slate-800 group-hover:text-white text-slate-600 p-3 rounded-xl transition-colors shrink-0">
                <Users size={22} />
              </div>
              <div>
                <p className="font-bold text-slate-800">Soy de la UAGRM</p>
                <p className="text-slate-500 text-sm mt-0.5">
                  Estudiante, Docente o Personal Administrativo
                </p>
                <p className="text-slate-400 text-xs mt-1">
                  Crea una cuenta para gestionar tu vehículo y acceder con QR
                </p>
              </div>
            </div>
          </button>

          {/* Separador */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-slate-500 text-xs font-medium">o</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Opción Visitante */}
          <button onClick={() => setFlujo('visitante')}
            className="w-full bg-white/10 hover:bg-white/20 rounded-2xl p-5 text-left border border-white/20 hover:border-white/40 transition-all group">
            <div className="flex items-center gap-4">
              <div className="bg-cyan-500/20 group-hover:bg-cyan-500 text-cyan-400 group-hover:text-white p-3 rounded-xl transition-colors shrink-0">
                <UserCheck size={22} />
              </div>
              <div>
                <p className="font-bold text-white">Soy visitante externo</p>
                <p className="text-slate-300 text-sm mt-0.5">
                  Vengo a visitar a alguien en la universidad
                </p>
                <p className="text-slate-400 text-xs mt-1">
                  Pre-registra tu CI para que el guardia te atienda más rápido
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="text-center mt-6">
          <Link to="/login" className="flex items-center justify-center gap-2 text-slate-400 hover:text-white text-sm transition-colors">
            <ArrowLeft size={14} /> Ya tengo cuenta
          </Link>
        </div>
      </div>
    </div>
  )

  // Formulario según flujo seleccionado
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 sm:p-8">
        {/* Header del formulario */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setFlujo(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="font-bold text-slate-800">
              {flujo === 'uagrm' ? 'Crear cuenta UAGRM' : 'Pre-registro de visitante'}
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {flujo === 'uagrm'
                ? 'Para gestionar tu vehículo universitario'
                : 'Sin contraseña — solo tus datos de contacto'}
            </p>
          </div>
        </div>

        {flujo === 'uagrm' ? <FormularioCuenta /> : <FormularioVisitante />}

        {flujo === 'uagrm' && (
          <div className="text-center mt-4">
            <Link to="/login" className="flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-700 transition-colors">
              <ArrowLeft size={14} /> Ya tengo cuenta
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
