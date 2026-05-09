import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { Bell, CheckCheck, Check, AlertCircle, Info, Car, Shield, Wifi, WifiOff } from 'lucide-react'
import { MIS_NOTIFICACIONES_QUERY, CONTEO_NO_LEIDAS_QUERY } from '../graphql/queries/notificaciones'
import { MARCAR_LEIDA_MUTATION, MARCAR_TODAS_LEIDAS_MUTATION } from '../graphql/mutations/notificaciones'

function tipoIcon(codigo?: string | null) {
  if (!codigo) return <Bell size={16} className="text-slate-400" />
  const c = codigo.toLowerCase()
  if (c.includes('multa'))    return <AlertCircle size={16} className="text-red-500" />
  if (c.includes('acceso'))   return <Shield size={16} className="text-orange-500" />
  if (c.includes('vehiculo')) return <Car size={16} className="text-emerald-500" />
  return <Info size={16} className="text-blue-500" />
}

function EstadoConexion() {
  const [estado, setEstado] = useState<'conectando' | 'en_vivo' | 'sin_conexion'>('conectando')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setEstado('sin_conexion'); return }

    const ws = new WebSocket(`ws://localhost:8000/ws/notificaciones/?token=${token}`)
    ws.onopen  = () => setEstado('en_vivo')
    ws.onclose = () => setEstado('sin_conexion')
    ws.onerror = () => setEstado('sin_conexion')
    return () => ws.close()
  }, [])

  if (estado === 'en_vivo') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
        <Wifi size={12} />
        En vivo
        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
      </span>
    )
  }
  if (estado === 'conectando') {
    return <span className="text-xs text-slate-400">Conectando...</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400">
      <WifiOff size={12} />
      Solo polling
    </span>
  )
}

export default function Notificaciones() {
  const [soloNoLeidas, setSoloNoLeidas] = useState(false)

  const { data, loading, refetch } = useQuery(MIS_NOTIFICACIONES_QUERY, {
    variables: { soloNoLeidas, limite: 50 },
    fetchPolicy: 'cache-and-network',
  })
  const { data: conteoData, refetch: refetchConteo } = useQuery(CONTEO_NO_LEIDAS_QUERY)

  const [marcarLeida] = useMutation(MARCAR_LEIDA_MUTATION, {
    onCompleted() { refetch(); refetchConteo() },
  })
  const [marcarTodasLeidas, { loading: loadingTodas }] = useMutation(MARCAR_TODAS_LEIDAS_MUTATION, {
    onCompleted() { refetch(); refetchConteo() },
  })

  const notificaciones = data?.misNotificaciones ?? []
  const conteo: number = conteoData?.conteoNoLeidas ?? 0

  return (
    <div className="p-8 bg-slate-50 min-h-full">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="bg-slate-700 text-white p-2 rounded-xl"><Bell size={20} /></div>
              {conteo > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full font-bold">
                  {conteo > 9 ? '9+' : conteo}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-800">Notificaciones</h1>
                <EstadoConexion />
              </div>
              <p className="text-slate-500 text-xs">{conteo > 0 ? `${conteo} sin leer` : 'Todo al día'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoloNoLeidas(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                soloNoLeidas
                  ? 'bg-slate-700 text-white border-slate-700'
                  : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
              }`}
            >
              {soloNoLeidas ? 'Ver todas' : 'Solo no leídas'}
            </button>
            {conteo > 0 && (
              <button
                onClick={() => marcarTodasLeidas()}
                disabled={loadingTodas}
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                <CheckCheck size={15} /> Marcar todas leídas
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-16 animate-pulse" />
            ))}
          </div>
        ) : notificaciones.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Bell size={48} className="mx-auto mb-3 opacity-20" />
            <p className="font-medium text-slate-600">Sin notificaciones</p>
            <p className="text-xs mt-1">
              {soloNoLeidas ? 'No tienes mensajes sin leer' : 'No hay notificaciones aún'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {notificaciones.map((n: any) => (
              <div
                key={n.id}
                onClick={() => !n.leido && marcarLeida({ variables: { notificacionId: n.id } })}
                className={`bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 transition-all ${
                  !n.leido
                    ? 'border-l-4 border-slate-600 cursor-pointer hover:shadow-md hover:bg-slate-50'
                    : 'opacity-70'
                }`}
              >
                <div className="mt-0.5 shrink-0">{tipoIcon(n.tipoCodigo)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${n.leido ? 'text-slate-600' : 'font-semibold text-slate-800'}`}>
                      {n.titulo}
                    </p>
                    <span className="text-xs text-slate-400 shrink-0">
                      {new Date(n.fecha).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.mensaje}</p>
                </div>
                {!n.leido
                  ? <div className="w-2 h-2 bg-slate-600 rounded-full mt-2 shrink-0" title="Sin leer" />
                  : <Check size={14} className="text-slate-300 shrink-0 mt-1" />
                }
              </div>
            ))}
          </div>
        )}

        {notificaciones.length > 0 && (
          <p className="text-center text-xs text-slate-400 mt-4">
            {notificaciones.length} notificaciones · Haz clic en una no leída para marcarla como leída
          </p>
        )}
      </div>
    </div>
  )
}
