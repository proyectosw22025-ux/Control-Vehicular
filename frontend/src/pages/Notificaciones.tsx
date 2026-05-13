import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { Bell, CheckCheck, Check, AlertCircle, Info, Car, Shield, Wifi, WifiOff, Trash2 } from 'lucide-react'
import { MIS_NOTIFICACIONES_QUERY, CONTEO_NO_LEIDAS_QUERY } from '../graphql/queries/notificaciones'
import {
  MARCAR_LEIDA_MUTATION,
  MARCAR_TODAS_LEIDAS_MUTATION,
  ELIMINAR_NOTIFICACION_MUTATION,
  ELIMINAR_TODAS_LEIDAS_MUTATION,
} from '../graphql/mutations/notificaciones'

// ── Derivar URL WebSocket desde la misma variable que el cliente GraphQL ───
// VITE_GRAPHQL_URI = "https://api.railway.app/graphql/"
// → wsBase = "wss://api.railway.app"
// En desarrollo: "http://127.0.0.1:8000/graphql/" → "ws://127.0.0.1:8000"
function buildWsUrl(): string {
  const graphqlUri = import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/'
  const wsBase = graphqlUri
    .replace(/\/graphql\/?$/, '')
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')
  const token = localStorage.getItem('access_token') ?? ''
  return `${wsBase}/ws/notificaciones/?token=${encodeURIComponent(token)}`
}

function tipoIcon(codigo?: string | null) {
  if (!codigo) return <Bell size={16} className="text-slate-400" />
  const c = codigo.toLowerCase()
  if (c.includes('multa'))    return <AlertCircle size={16} className="text-red-500" />
  if (c.includes('acceso'))   return <Shield size={16} className="text-orange-500" />
  if (c.includes('vehiculo')) return <Car size={16} className="text-emerald-500" />
  if (c.includes('visita'))   return <Bell size={16} className="text-cyan-500" />
  return <Info size={16} className="text-blue-500" />
}

// ── Indicador de conexión WebSocket ────────────────────────────────────────
function EstadoConexion({ onMensaje }: { onMensaje: () => void }) {
  const [estado, setEstado] = useState<'conectando' | 'en_vivo' | 'sin_conexion'>('conectando')
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) { setEstado('sin_conexion'); return }

    function conectar() {
      const ws = new WebSocket(buildWsUrl())
      wsRef.current = ws
      ws.onopen  = () => setEstado('en_vivo')
      ws.onclose = () => {
        setEstado('sin_conexion')
        // Reconectar automáticamente tras 5s si el token sigue válido
        setTimeout(() => {
          if (localStorage.getItem('access_token')) conectar()
        }, 5000)
      }
      ws.onerror = () => setEstado('sin_conexion')
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          // nueva_notificacion → refrescar lista
          if (data.tipo === 'nueva_notificacion') onMensaje()
        } catch { /* ignorar frames malformados */ }
      }
    }

    conectar()
    return () => {
      wsRef.current?.close()
      wsRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (estado === 'en_vivo') return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
      <Wifi size={12} /> En vivo
      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
    </span>
  )
  if (estado === 'conectando') return <span className="text-xs text-slate-400">Conectando...</span>
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-400">
      <WifiOff size={12} /> Solo polling
    </span>
  )
}

// ── Página ─────────────────────────────────────────────────────────────────
export default function Notificaciones() {
  const [soloNoLeidas, setSoloNoLeidas] = useState(false)

  const { data, loading, refetch } = useQuery(MIS_NOTIFICACIONES_QUERY, {
    variables: { soloNoLeidas, limite: 50 },
    fetchPolicy: 'cache-and-network',
  })
  const { data: conteoData, refetch: refetchConteo } = useQuery(CONTEO_NO_LEIDAS_QUERY)

  function refetchTodo() { refetch(); refetchConteo() }

  const [marcarLeida] = useMutation(MARCAR_LEIDA_MUTATION, {
    onCompleted: refetchTodo,
  })
  const [marcarTodasLeidas, { loading: loadingTodas }] = useMutation(MARCAR_TODAS_LEIDAS_MUTATION, {
    onCompleted: refetchTodo,
  })
  const [eliminarNotificacion] = useMutation(ELIMINAR_NOTIFICACION_MUTATION, {
    onCompleted: refetchTodo,
  })
  const [eliminarTodasLeidas, { loading: loadingEliminar }] = useMutation(ELIMINAR_TODAS_LEIDAS_MUTATION, {
    onCompleted: refetchTodo,
  })

  const notificaciones = data?.misNotificaciones ?? []
  const conteo: number = conteoData?.conteoNoLeidas ?? 0
  const hayLeidas = notificaciones.some((n: any) => n.leido)

  return (
    <div className="p-8 bg-slate-50 min-h-full">
      <div className="max-w-3xl mx-auto">

        {/* Encabezado */}
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
                {/* WebSocket: refetch al recibir evento en tiempo real */}
                <EstadoConexion onMensaje={refetchTodo} />
              </div>
              <p className="text-slate-500 text-xs">{conteo > 0 ? `${conteo} sin leer` : 'Todo al día'}</p>
            </div>
          </div>

          {/* Acciones globales */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
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
            {hayLeidas && (
              <button
                onClick={() => eliminarTodasLeidas()}
                disabled={loadingEliminar}
                className="flex items-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                title="Eliminar todas las ya leídas"
              >
                <Trash2 size={15} /> Limpiar leídas
              </button>
            )}
          </div>
        </div>

        {/* Lista */}
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
                className={`bg-white rounded-xl shadow-sm p-4 flex items-start gap-3 transition-all group ${
                  !n.leido
                    ? 'border-l-4 border-slate-600 hover:shadow-md hover:bg-slate-50'
                    : 'opacity-70'
                }`}
              >
                {/* Ícono por tipo */}
                <div
                  className="mt-0.5 shrink-0 cursor-pointer"
                  onClick={() => !n.leido && marcarLeida({ variables: { notificacionId: n.id } })}
                >
                  {tipoIcon(n.tipoCodigo)}
                </div>

                {/* Contenido */}
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => !n.leido && marcarLeida({ variables: { notificacionId: n.id } })}
                >
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

                {/* Indicador + botón eliminar */}
                <div className="flex items-center gap-1 shrink-0">
                  {!n.leido
                    ? <div className="w-2 h-2 bg-slate-600 rounded-full mt-1" title="Sin leer" />
                    : <Check size={14} className="text-slate-300 mt-1" />
                  }
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      eliminarNotificacion({ variables: { notificacionId: n.id } })
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 hover:text-red-500 text-slate-300 transition-all"
                    title="Eliminar notificación"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {notificaciones.length > 0 && (
          <p className="text-center text-xs text-slate-400 mt-4">
            {notificaciones.length} notificaciones · Clic en una no leída para marcarla como leída
          </p>
        )}
      </div>
    </div>
  )
}
