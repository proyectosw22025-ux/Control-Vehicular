import { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation } from '@apollo/client'
import { Car } from 'lucide-react'
import { LOGIN_MUTATION } from '../graphql/mutations/auth'

export default function Login() {
  const navigate = useNavigate()
  const [ci, setCi] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const [login, { loading }] = useMutation(LOGIN_MUTATION, {
    onCompleted(data) {
      localStorage.setItem('access_token', data.login.access)
      localStorage.setItem('refresh_token', data.login.refresh)
      localStorage.setItem('usuario', JSON.stringify(data.login.usuario))
      navigate('/')
    },
    onError(err) {
      setError(err.message)
    },
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

  return (
    <div className="min-h-screen bg-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-slate-800 text-white p-3 rounded-xl mb-3">
            <Car size={28} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Control Vehicular</h1>
          <p className="text-slate-500 text-sm mt-1">Ingresa con tu CI y contraseña</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Cédula de identidad
            </label>
            <input
              type="text"
              value={ci}
              onChange={e => setCi(e.target.value)}
              placeholder="Ej: 12345678"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
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
            {loading ? 'Ingresando...' : 'Ingresar'}
          </button>

          <div className="text-center pt-2">
            <span className="text-sm text-slate-500">¿No tienes cuenta? </span>
            <Link to="/register" className="text-sm font-medium text-slate-800 hover:underline">
              Regístrate aquí
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
