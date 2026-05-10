import { useState } from 'react'
import { useQuery, useMutation, gql } from '@apollo/client'
import {
  ShieldCheck, ArrowDownCircle, ArrowUpCircle, Camera, CameraOff,
  CheckCircle2, XCircle, Clock, ParkingSquare, UserCheck, DoorOpen,
} from 'lucide-react'
import { QrScanner } from '../components/QrScanner'
import { PUNTOS_ACCESO_QUERY, REGISTROS_ACCESO_QUERY } from '../graphql/queries/acceso'
import { REGISTRAR_ACCESO_MUTATION, REGISTRAR_ACCESO_MANUAL_MUTATION } from '../graphql/mutations/acceso'

const GUARDIA_STATS_QUERY = gql`
  query GuardiaStats {
    dashboardStats {
      accesosHoy
      espaciosDisponibles
      totalEspacios
      visitantesActivos
    }
  }
`

type TipoAcceso = 'entrada' | 'salida'
type ResultadoAcceso = { ok: boolean; mensaje: string; placa?: string } | null

const METODO_LABEL: Record<string, string> = {
  qr_permanente: 'QR',
  qr_delegacion: 'QR Deleg.',
  pase_temporal: 'Pase',
  manual: 'Manual',
}

export default function GuardiaDashboard() {
  const [tipo, setTipo] = useState<TipoAcceso>('entrada')
  const [camaraActiva, setCamaraActiva] = useState(false)
  const [resultado, setResultado] = useState<ResultadoAcceso>(null)
  const [placaManual, setPlacaManual] = useState('')
  const puntoGuardado = localStorage.getItem('guardia_punto_id')
  const [puntoId, setPuntoId] = useState<number | null>(puntoGuardado ? parseInt(puntoGuardado) : null)

  const { data: statsData } = useQuery(GUARDIA_STATS_QUERY, { pollInterval: 30_000 })
  const { data: puntosData } = useQuery(PUNTOS_ACCESO_QUERY)
  const { data: registrosData, refetch: refetchRegistros } = useQuery(REGISTROS_ACCESO_QUERY, {
    variables: { limite: 8 },
    pollInterval: 15_000,
    fetchPolicy: 'cache-and-network',
  })

  const [registrarAcceso, { loading: loadingQr }] = useMutation(REGISTRAR_ACCESO_MUTATION, {
    onCompleted(d) {
      const r = d.registrarAcceso
      setResultado({ ok: true, mensaje: `${tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada`, placa: r.placaVehiculo })
      refetchRegistros()
      setTimeout(() => setResultado(null), 5000)
    },
    onError(e) {
      setResultado({ ok: false, mensaje: e.message })
      setTimeout(() => setResultado(null), 6000)
    },
  })

  const [registrarManual, { loading: loadingManual }] = useMutation(REGISTRAR_ACCESO_MANUAL_MUTATION, {
    onCompleted(d) {
      const r = d.registrarAccesoManual
      setResultado({ ok: true, mensaje: `${tipo === 'entrada' ? 'Entrada' : 'Salida'} manual registrada`, placa: r.placaVehiculo })
      setPlacaManual('')
      refetchRegistros()
      setTimeout(() => setResultado(null), 5000)
    },
    onError(e) {
      setResultado({ ok: false, mensaje: e.message })
      setTimeout(() => setResultado(null), 6000)
    },
  })

  const stats = statsData?.dashboardStats
  const puntos = puntosData?.puntosAcceso ?? []
  const registros = registrosData?.registrosAcceso ?? []

  function cambiarPunto(id: number | null) {
    setPuntoId(id)
    if (id) localStorage.setItem('guardia_punto_id', String(id))
    else localStorage.removeItem('guardia_punto_id')
  }

  function registrarQr(codigo: string) {
    if (!puntoId) { setResultado({ ok: false, mensaje: 'Selecciona un punto de acceso primero' }); return }
    setCamaraActiva(false)
    registrarAcceso({ variables: { input: { puntoAccesoId: puntoId, codigo, tipo } } })
  }

  function registrarPlacaManual() {
    if (!puntoId) { setResultado({ ok: false, mensaje: 'Selecciona un punto de acceso primero' }); return }
    if (!placaManual.trim()) return
    registrarManual({ variables: { input: { puntoAccesoId: puntoId, placa: placaManual.trim().toUpperCase(), tipo } } })
  }

  // suppress unused warning for loadingQr — kept for future use
  void loadingQr

  return (
    <div className="p-4 md:p-6 min-h-screen bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 text-white p-2.5 rounded-xl">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Control de Acceso</h1>
            <p className="text-xs text-slate-400">Panel del guardia</p>
          </div>
        </div>
        {/* Selector de punto de acceso */}
        <select
          value={puntoId ?? ''}
          onChange={e => cambiarPunto(e.target.value ? parseInt(e.target.value) : null)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400 max-w-[200px]"
        >
          <option value="">Seleccionar punto...</option>
          {puntos.map((p: any) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </select>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <StatChip icon={DoorOpen} label="Accesos hoy" value={stats.accesosHoy} color="text-orange-500" />
          <StatChip icon={ParkingSquare} label="Espacios libres" value={`${stats.espaciosDisponibles}/${stats.totalEspacios}`} color="text-violet-500" />
          <StatChip icon={UserCheck} label="Visitantes" value={stats.visitantesActivos} color="text-cyan-500" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Panel izquierdo: scanner + acciones */}
        <div className="space-y-3">
          {/* Selector entrada/salida */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setTipo('entrada')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-colors ${tipo === 'entrada' ? 'bg-green-500 text-white shadow-lg shadow-green-200' : 'bg-white text-slate-600 border border-slate-200 hover:border-green-300'}`}
            >
              <ArrowDownCircle size={18} /> Entrada
            </button>
            <button
              onClick={() => setTipo('salida')}
              className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-colors ${tipo === 'salida' ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-white text-slate-600 border border-slate-200 hover:border-red-300'}`}
            >
              <ArrowUpCircle size={18} /> Salida
            </button>
          </div>

          {/* Botón cámara */}
          <button
            onClick={() => setCamaraActiva(v => !v)}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors border ${camaraActiva ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            {camaraActiva ? <><CameraOff size={16} /> Apagar cámara</> : <><Camera size={16} /> Escanear QR con cámara</>}
          </button>

          {/* Scanner */}
          {camaraActiva && (
            <div className="rounded-xl overflow-hidden border-2 border-orange-200">
              <QrScanner activo={camaraActiva} onScan={registrarQr} />
            </div>
          )}

          {/* Resultado */}
          {resultado && (
            <div className={`rounded-xl p-4 flex items-center gap-3 border-2 transition-all ${resultado.ok ? 'bg-green-50 border-green-400 text-green-800' : 'bg-red-50 border-red-400 text-red-800'}`}>
              {resultado.ok
                ? <CheckCircle2 size={28} className="text-green-500 shrink-0" />
                : <XCircle size={28} className="text-red-500 shrink-0" />
              }
              <div>
                {resultado.placa && <p className="font-bold text-lg font-mono">{resultado.placa}</p>}
                <p className="text-sm font-medium">{resultado.mensaje}</p>
              </div>
            </div>
          )}

          {/* Placa manual */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ingreso manual por placa</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={placaManual}
                onChange={e => setPlacaManual(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && registrarPlacaManual()}
                placeholder="ABC-1234"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <button
                onClick={registrarPlacaManual}
                disabled={loadingManual || !placaManual.trim()}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {loadingManual ? '...' : 'Registrar'}
              </button>
            </div>
          </div>
        </div>

        {/* Panel derecho: log de accesos */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={15} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Últimos accesos</h2>
            <span className="ml-auto text-[10px] text-slate-400 italic">actualiza cada 15 s</span>
          </div>
          {registros.length === 0 ? (
            <p className="text-center py-8 text-slate-400 text-sm">Sin registros aún</p>
          ) : (
            <div className="space-y-2">
              {registros.map((r: any) => (
                <div key={r.id} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${r.tipo === 'entrada' ? 'bg-green-50' : 'bg-red-50'}`}>
                  <span className={`font-bold text-xs w-12 shrink-0 ${r.tipo === 'entrada' ? 'text-green-700' : 'text-red-700'}`}>
                    {r.tipo === 'entrada' ? '▼ ENT' : '▲ SAL'}
                  </span>
                  <span className="font-mono font-bold text-slate-800 flex-1">{r.placaVehiculo ?? '—'}</span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {new Date(r.timestamp).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">{METODO_LABEL[r.metodoAcceso] ?? r.metodoAcceso}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatChip({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl p-3 shadow-sm flex items-center gap-2 border border-slate-100">
      <Icon size={18} className={color} />
      <div className="min-w-0">
        <p className="text-lg font-bold text-slate-800 leading-none">{value}</p>
        <p className="text-[11px] text-slate-400 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  )
}
