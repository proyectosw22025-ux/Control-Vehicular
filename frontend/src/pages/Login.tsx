import { useState, FormEvent, useRef, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import { Eye, EyeOff, Loader2, ShieldCheck, ArrowLeft } from 'lucide-react'
import { LOGIN_MUTATION } from '../graphql/mutations/auth'

export default function Login() {
  const navigate = useNavigate()

  // ── Paso 1: CI + contraseña ───────────────────────────────
  const [ci, setCi]             = useState('')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass]   = useState(false)
  const [error, setError]       = useState('')

  // ── Paso 2: código TOTP (solo si el usuario tiene 2FA activo) ──
  const [requiere2FA, setRequiere2FA] = useState(false)
  const [codigoTotp, setCodigoTotp]   = useState('')
  const codigoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (requiere2FA) codigoRef.current?.focus()
  }, [requiere2FA])

  const [login, { loading }] = useMutation(LOGIN_MUTATION, {
    onCompleted(data) {
      localStorage.setItem('access_token', data.login.access)
      localStorage.setItem('refresh_token', data.login.refresh)
      localStorage.setItem('usuario', JSON.stringify(data.login.usuario))
      navigate('/')
    },
    onError(err) {
      if (err.message === '2FA_REQUIRED') {
        // Backend señala que el usuario tiene 2FA activo
        setError('')
        setRequiere2FA(true)
      } else {
        setError(err.message)
      }
    },
  })

  function handleSubmitPaso1(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!ci.trim() || !password.trim()) {
      setError('Completa todos los campos')
      return
    }
    login({ variables: { ci: ci.trim(), password } })
  }

  function handleSubmitPaso2(e: FormEvent) {
    e.preventDefault()
    setError('')
    const codigo = codigoTotp.replace(/\s/g, '')
    if (codigo.length !== 6) {
      setError('El código debe tener exactamente 6 dígitos')
      return
    }
    login({ variables: { ci: ci.trim(), password, codigoTotp: codigo } })
  }

  const inputBase = 'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent transition-all placeholder:text-slate-300'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Marca institucional */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur mb-4">
            <span className="text-white font-black text-2xl tracking-tight">UV</span>
          </div>
          <h1 className="text-white font-bold text-xl tracking-tight">Control Vehicular</h1>
          <p className="text-slate-400 text-sm mt-1">Universidad Autónoma Gabriel René Moreno</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* ── Paso 1: CI + Contraseña ── */}
          {!requiere2FA && (
            <>
              <h2 className="text-slate-800 font-semibold text-base mb-6">Inicia sesión</h2>
              <form onSubmit={handleSubmitPaso1} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                    Cédula de identidad
                  </label>
                  <input type="text" value={ci} onChange={e => setCi(e.target.value)}
                    placeholder="Ej: 12345678" autoFocus autoComplete="username"
                    className={inputBase} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                    Contraseña
                  </label>
                  <div className="relative">
                    <input type={verPass ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" autoComplete="current-password"
                      className={`${inputBase} pr-11`} />
                    <button type="button" onClick={() => setVerPass(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                      aria-label={verPass ? 'Ocultar contraseña' : 'Ver contraseña'}>
                      {verPass ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-60 mt-2">
                  {loading ? <><Loader2 size={16} className="animate-spin" /> Verificando...</> : 'Ingresar'}
                </button>
              </form>
            </>
          )}

          {/* ── Paso 2: Código TOTP ── */}
          {requiere2FA && (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="bg-blue-100 p-2.5 rounded-xl">
                  <ShieldCheck size={22} className="text-blue-600" />
                </div>
                <div>
                  <h2 className="text-slate-800 font-semibold text-sm">Verificación de doble factor</h2>
                  <p className="text-slate-400 text-xs mt-0.5">Tu cuenta está protegida con 2FA</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-xs text-blue-700 space-y-1">
                <p className="font-semibold">Abre tu app de autenticación</p>
                <p>Busca <strong>UAGRM Control Vehicular</strong> y escribe el código de 6 dígitos.</p>
                <p className="text-blue-500">El código cambia cada 30 segundos.</p>
              </div>

              <form onSubmit={handleSubmitPaso2} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                    Código de 6 dígitos
                  </label>
                  <input
                    ref={codigoRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9 ]*"
                    maxLength={7}
                    value={codigoTotp}
                    onChange={e => setCodigoTotp(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    className="w-full border border-slate-200 rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-[0.5em] bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                  />
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading || codigoTotp.length < 6}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50">
                  {loading ? <><Loader2 size={16} className="animate-spin" /> Verificando...</> : 'Verificar código'}
                </button>

                <button type="button" onClick={() => { setRequiere2FA(false); setCodigoTotp(''); setError('') }}
                  className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-slate-600 text-sm transition-colors">
                  <ArrowLeft size={14} /> Volver a iniciar sesión
                </button>
              </form>
            </>
          )}

          {!requiere2FA && (
            <div className="text-center pt-5 border-t border-slate-100 mt-5">
              <span className="text-sm text-slate-500">¿No tienes cuenta? </span>
              <Link to="/register" className="text-sm font-semibold text-slate-800 hover:underline">
                Regístrate aquí
              </Link>
            </div>
          )}
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          Sistema de Control Vehicular · UAGRM · 2025
        </p>
      </div>
    </div>
  )
}
