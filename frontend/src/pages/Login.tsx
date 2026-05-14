import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { LOGIN_MUTATION } from '../graphql/mutations/auth'

export default function Login() {
  const navigate = useNavigate()
  const [ci, setCi]             = useState('')
  const [password, setPassword] = useState('')
  const [verPass, setVerPass]   = useState(false)
  const [error, setError]       = useState('')

  const [login, { loading }] = useMutation(LOGIN_MUTATION, {
    onCompleted(data) {
      localStorage.setItem('access_token', data.login.access)
      localStorage.setItem('refresh_token', data.login.refresh)
      localStorage.setItem('usuario', JSON.stringify(data.login.usuario))
      navigate('/')
    },
    onError(err) { setError(err.message) },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!ci.trim() || !password.trim()) {
      setError('Completa todos los campos')
      return
    }
    login({ variables: { ci: ci.trim(), password } })
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

        {/* Card de login */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-slate-800 font-semibold text-base mb-6">Inicia sesión</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* CI */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                Cédula de identidad
              </label>
              <input
                type="text"
                value={ci}
                onChange={e => setCi(e.target.value)}
                placeholder="Ej: 12345678"
                autoFocus
                autoComplete="username"
                className={inputBase}
              />
            </div>

            {/* Contraseña con toggle ver/ocultar */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={verPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={`${inputBase} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setVerPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                  aria-label={verPass ? 'Ocultar contraseña' : 'Ver contraseña'}
                >
                  {verPass ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            {/* Botón con spinner */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-60 mt-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Verificando...
                </>
              ) : 'Ingresar'}
            </button>
          </form>

          <div className="text-center pt-5 border-t border-slate-100 mt-5">
            <span className="text-sm text-slate-500">¿No tienes cuenta? </span>
            <Link to="/register" className="text-sm font-semibold text-slate-800 hover:underline">
              Regístrate aquí
            </Link>
          </div>
        </div>

        {/* Pie de página institucional */}
        <p className="text-center text-slate-500 text-xs mt-6">
          Sistema de Control Vehicular · UAGRM · 2025
        </p>
      </div>
    </div>
  )
}
