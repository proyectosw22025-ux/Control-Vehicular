import { useState } from 'react'
import { useQuery } from '@apollo/client'
import {
  LogIn, LogOut, Clock, MapPin, Car, Filter,
  ShieldCheck, QrCode, Hand, RefreshCw,
} from 'lucide-react'
import { MIS_ACCESOS_QUERY } from '../graphql/queries/acceso'

type Registro = {
  id: number
  tipo: 'entrada' | 'salida'
  timestamp: string
  metodoAcceso: string
  puntoNombre: string
  placaVehiculo: string | null
  tipoVehiculo: string | null
  marcaModelo: string | null
  observacion: string
}

type FiltroTipo = 'todos' | 'entrada' | 'salida'

const METODO_LABEL: Record<string, { label: string; icon: React.FC<{ size: number; className?: string }> }> = {
  qr_permanente: { label: 'QR', icon: QrCode },
  qr_delegado:   { label: 'QR Delegado', icon: QrCode },
  manual:        { label: 'Manual', icon: Hand },
  pase_temporal: { label: 'Pase Temporal', icon: ShieldCheck },
}

function agruparPorFecha(registros: Registro[]): Array<{ fecha: string; items: Registro[] }> {
  const grupos: Record<string, Registro[]> = {}
  for (const r of registros) {
    const fecha = new Date(r.timestamp).toLocaleDateString('es-BO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
    if (!grupos[fecha]) grupos[fecha] = []
    grupos[fecha].push(r)
  }
  return Object.entries(grupos).map(([fecha, items]) => ({ fecha, items }))
}

function formatHora(ts: string) {
  return new Date(ts).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
}

function etiquetaHoy(fechaStr: string): string {
  const hoy = new Date()
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1)
  const fecha = new Date(fechaStr.split('T')[0] + 'T12:00:00')
  const soloFecha = (d: Date) => d.toDateString()
  if (soloFecha(fecha) === soloFecha(hoy)) return 'Hoy'
  if (soloFecha(fecha) === soloFecha(ayer)) return 'Ayer'
  return ''
}

export default function MisAccesos() {
  const [filtro, setFiltro] = useState<FiltroTipo>('todos')

  const { data, loading, error, refetch } = useQuery(MIS_ACCESOS_QUERY, {
    variables: {
      limite: 100,
      tipo: filtro === 'todos' ? undefined : filtro,
    },
    fetchPolicy: 'cache-and-network',
  })

  const registros: Registro[] = data?.misAccesos ?? []
  const grupos = agruparPorFecha(registros)

  const totalEntradas = registros.filter(r => r.tipo === 'entrada').length
  const totalSalidas  = registros.filter(r => r.tipo === 'salida').length

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">

      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 text-white p-2 rounded-xl">
            <Clock size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Mis Accesos</h1>
            <p className="text-slate-500 text-xs">Historial de entradas y salidas al campus UAGRM</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <RefreshCw size={13} />
          Actualizar
        </button>
      </div>

      {/* Resumen rápido */}
      {registros.length > 0 && (
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <LogIn size={20} className="text-emerald-600 shrink-0" />
            <div>
              <p className="text-2xl font-black text-emerald-700">{totalEntradas}</p>
              <p className="text-xs text-emerald-600">Entradas al campus</p>
            </div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3 flex items-center gap-3">
            <LogOut size={20} className="text-red-500 shrink-0" />
            <div>
              <p className="text-2xl font-black text-red-600">{totalSalidas}</p>
              <p className="text-xs text-red-500">Salidas del campus</p>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-5">
        <Filter size={14} className="text-slate-400 shrink-0" />
        {(['todos', 'entrada', 'salida'] as FiltroTipo[]).map(f => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors capitalize ${
              filtro === f
                ? f === 'entrada'
                  ? 'bg-emerald-500 text-white'
                  : f === 'salida'
                  ? 'bg-red-500 text-white'
                  : 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f === 'todos' ? 'Todos' : f === 'entrada' ? 'Entradas' : 'Salidas'}
          </button>
        ))}
      </div>

      {/* Estado de carga */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-blue-500 mr-2" />
          <span className="text-slate-500 text-sm">Cargando historial...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          Error al cargar el historial: {error.message}
        </div>
      )}

      {/* Sin registros */}
      {!loading && !error && registros.length === 0 && (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">🏫</div>
          <p className="font-bold text-slate-700 text-lg">Sin registros de acceso</p>
          <p className="text-slate-500 text-sm mt-1 max-w-xs mx-auto">
            {filtro === 'todos'
              ? 'Cuando ingreses o salgas del campus UAGRM con tu vehículo, aquí aparecerá tu historial.'
              : `No tienes registros de ${filtro === 'entrada' ? 'entrada' : 'salida'} aún.`}
          </p>
        </div>
      )}

      {/* Timeline agrupada por fecha */}
      {!loading && grupos.length > 0 && (
        <div className="space-y-6">
          {grupos.map(({ fecha, items }) => {
            const etiqueta = etiquetaHoy(items[0].timestamp)
            return (
              <div key={fecha}>
                {/* Encabezado de fecha */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide px-2 whitespace-nowrap">
                    {etiqueta || fecha}
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                {/* Registros del día */}
                <div className="space-y-2">
                  {items.map(r => {
                    const esEntrada = r.tipo === 'entrada'
                    const MetodoIcon = METODO_LABEL[r.metodoAcceso]?.icon ?? QrCode
                    const metodoLabel = METODO_LABEL[r.metodoAcceso]?.label ?? r.metodoAcceso
                    return (
                      <div
                        key={r.id}
                        className={`flex items-start gap-3 rounded-2xl p-3 border ${
                          esEntrada
                            ? 'bg-emerald-50 border-emerald-200'
                            : 'bg-red-50 border-red-200'
                        }`}
                      >
                        {/* Icono de tipo */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          esEntrada ? 'bg-emerald-500' : 'bg-red-500'
                        }`}>
                          {esEntrada
                            ? <LogIn size={15} className="text-white" />
                            : <LogOut size={15} className="text-white" />
                          }
                        </div>

                        {/* Contenido */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-bold ${
                              esEntrada ? 'text-emerald-700' : 'text-red-700'
                            }`}>
                              {esEntrada ? 'Entrada' : 'Salida'}
                            </span>
                            <span className="text-xs text-slate-500">
                              {formatHora(r.timestamp)}
                            </span>
                            <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full">
                              <MetodoIcon size={10} />
                              {metodoLabel}
                            </span>
                          </div>

                          {/* Punto de acceso */}
                          <div className="flex items-center gap-1 mt-0.5">
                            <MapPin size={11} className="text-slate-400 shrink-0" />
                            <span className="text-xs text-slate-600 truncate">{r.puntoNombre}</span>
                          </div>

                          {/* Vehículo */}
                          {r.placaVehiculo && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Car size={11} className="text-slate-400 shrink-0" />
                              <span className="text-xs font-mono text-slate-700 font-semibold">{r.placaVehiculo}</span>
                              {r.marcaModelo && (
                                <span className="text-[10px] text-slate-400">· {r.marcaModelo}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <p className="text-center text-[10px] text-slate-400 pt-2">
            Mostrando los últimos {registros.length} registros
          </p>
        </div>
      )}
    </div>
  )
}
