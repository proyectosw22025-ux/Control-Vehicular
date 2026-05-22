/**
 * Mi Pase QR — Acceso rápido al campus + Delegaciones temporales
 *
 * El usuario ve su QR permanente en grande (listo para mostrar en portería)
 * y puede generar QRs temporales (delegaciones) para que otra persona
 * ingrese su vehículo al campus durante un tiempo limitado.
 */
import { useState, useCallback } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  QrCode, Shield, Clock, Trash2, Plus, ChevronDown,
  Car, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  Share2, Maximize2,
} from 'lucide-react'
import { QrImage } from '../components/QrImage'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { MIS_DELEGACIONES_QUERY } from '../graphql/queries/acceso'
import { GENERAR_QR_DELEGACION_MUTATION, REVOCAR_QR_DELEGACION_MUTATION } from '../graphql/mutations/acceso'

type Delegacion = {
  id: number
  codigoHash: string
  motivo: string
  fechaGeneracion: string
  fechaExpiracion: string
  usado: boolean
  vigente: boolean
  placaVehiculo: string | null
}

type Vehiculo = {
  id: number
  placa: string
  marca: string
  modelo: string
  estado: string
  codigoQr: string
  tipo: { nombre: string } | null
}

const DURACIONES = [
  { horas: 1,  label: '1 hora',   color: 'bg-slate-100 text-slate-700' },
  { horas: 4,  label: '4 horas',  color: 'bg-blue-100 text-blue-700' },
  { horas: 12, label: '12 horas', color: 'bg-violet-100 text-violet-700' },
  { horas: 24, label: '1 día',    color: 'bg-orange-100 text-orange-700' },
]

function tiempoRestante(fechaStr: string): string {
  const ms = new Date(fechaStr).getTime() - Date.now()
  if (ms <= 0) return 'Expirado'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m restantes`
  return `${m} min restantes`
}

function formatFecha(fechaStr: string): string {
  return new Date(fechaStr).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function MiPaseQR() {
  const { usuario } = useAuth()
  const toast = useToast()

  const [vehiculoSelId, setVehiculoSelId] = useState<number | null>(null)
  const [mostrarForm, setMostrarForm]     = useState(false)
  const [motivo, setMotivo]               = useState('')
  const [duracion, setDuracion]           = useState(4)
  const [qrFullscreen, setQrFullscreen]   = useState(false)
  const [delegacionGenerada, setDelegacionGenerada] = useState<Delegacion | null>(null)

  const { data: vehiculosData, loading: loadVeh } = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: usuario.id, porPagina: 50 },
    onCompleted(d) {
      const items = d?.vehiculos?.items ?? []
      if (items.length > 0 && !vehiculoSelId) {
        setVehiculoSelId(items[0].id)
      }
    },
  })

  const { data: delegData, refetch: refetchDeleg } = useQuery(MIS_DELEGACIONES_QUERY, {
    fetchPolicy: 'cache-and-network',
  })

  const [generarQR, { loading: lGenerar }] = useMutation(GENERAR_QR_DELEGACION_MUTATION, {
    onCompleted(d) {
      setDelegacionGenerada(d.generarQrDelegacion)
      setMostrarForm(false)
      setMotivo('')
      refetchDeleg()
      toast.exito('QR temporal generado', `Válido por ${duracion} hora${duracion > 1 ? 's' : ''}`)
    },
    onError(e) { toast.error('Error al generar QR', e.message) },
  })

  const [revocarQR, { loading: lRevocar }] = useMutation(REVOCAR_QR_DELEGACION_MUTATION, {
    onCompleted() {
      setDelegacionGenerada(null)
      refetchDeleg()
      toast.alerta('QR revocado', 'El acceso temporal fue cancelado')
    },
    onError(e) { toast.error('Error al revocar', e.message) },
  })

  const vehiculos: Vehiculo[] = vehiculosData?.vehiculos?.items ?? []
  const delegaciones: Delegacion[] = delegData?.misDelegaciones ?? []
  const vehSel = vehiculos.find(v => v.id === vehiculoSelId) ?? vehiculos[0] ?? null

  const handleGenerar = useCallback(() => {
    if (!motivo.trim()) { toast.error('Campo requerido', 'Escribe el motivo de la delegación'); return }
    if (!vehSel) return
    generarQR({ variables: { input: { vehiculoId: vehSel.id, motivo: motivo.trim(), horasValidez: duracion } } })
  }, [motivo, vehSel, duracion, generarQR, toast])

  const handleCompartir = useCallback(async (hash: string) => {
    const texto = `Código de acceso temporal UAGRM: ${hash}`
    if (navigator.share) {
      await navigator.share({ title: 'QR Acceso UAGRM', text: texto }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(texto)
      toast.info('Copiado', 'Código copiado al portapapeles')
    }
  }, [toast])

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />

      {/* Encabezado */}
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-emerald-600 text-white p-2 rounded-xl">
          <QrCode size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Mi Pase Digital</h1>
          <p className="text-slate-500 text-xs">Acceso rápido al campus · Delegaciones temporales</p>
        </div>
      </div>

      {/* Sin vehículos */}
      {!loadVeh && vehiculos.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🚗</div>
          <p className="font-bold text-slate-700">No tienes vehículos registrados</p>
          <p className="text-slate-500 text-sm mt-1">Registra un vehículo para obtener tu pase de acceso</p>
        </div>
      )}

      {vehSel && (
        <>
          {/* Selector de vehículo */}
          {vehiculos.length > 1 && (
            <div className="relative mb-4">
              <select
                value={vehiculoSelId ?? ''}
                onChange={e => { setVehiculoSelId(parseInt(e.target.value)); setDelegacionGenerada(null) }}
                className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm pr-8 focus:outline-none focus:ring-2 focus:ring-emerald-400 appearance-none"
              >
                {vehiculos.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.placa} · {v.tipo?.nombre} — {v.marca} {v.modelo}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-3.5 text-slate-400 pointer-events-none" />
            </div>
          )}

          {/* QR Permanente */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-3xl p-6 mb-5 text-white text-center shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="text-left">
                <p className="font-mono font-black text-2xl tracking-widest">{vehSel.placa}</p>
                <p className="text-slate-300 text-sm">{vehSel.tipo?.nombre} · {vehSel.marca} {vehSel.modelo}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${
                  vehSel.estado === 'activo' ? 'bg-emerald-500/20 text-emerald-400' :
                  vehSel.estado === 'sancionado' ? 'bg-red-500/20 text-red-400' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {vehSel.estado === 'activo' ? '✓ Activo' :
                   vehSel.estado === 'sancionado' ? '⚠ Sancionado' : vehSel.estado}
                </span>
                <button
                  onClick={() => setQrFullscreen(true)}
                  className="text-slate-400 hover:text-white transition-colors"
                  title="Ver QR en pantalla completa"
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            </div>

            {/* QR grande */}
            <div className="flex justify-center">
              {vehSel.codigoQr ? (
                <QrImage
                  value={vehSel.codigoQr}
                  size={200}
                  label="QR de acceso permanente"
                  showDownload
                  downloadName={`pase_${vehSel.placa}`}
                />
              ) : (
                <div className="w-52 h-52 bg-slate-700 rounded-2xl flex items-center justify-center">
                  <p className="text-slate-400 text-xs text-center">QR no disponible</p>
                </div>
              )}
            </div>

            {vehSel.estado === 'sancionado' && (
              <div className="mt-3 bg-red-500/20 border border-red-500/30 rounded-xl p-2">
                <p className="text-red-400 text-xs">Vehículo sancionado — acceso bloqueado hasta pagar la multa</p>
              </div>
            )}
          </div>

          {/* Sección de delegaciones */}
          <div className="space-y-3 mb-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-blue-600" />
                <h2 className="font-bold text-slate-800 text-sm">Acceso Temporal</h2>
              </div>
              {!mostrarForm && vehSel.estado === 'activo' && (
                <button
                  onClick={() => setMostrarForm(true)}
                  className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors"
                >
                  <Plus size={13} /> Delegar
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Genera un QR único de un solo uso para que otra persona ingrese tu vehículo al campus durante un tiempo limitado.
            </p>

            {/* Formulario de delegación */}
            {mostrarForm && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">¿Quién usará el acceso? *</label>
                  <input
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    placeholder="Ej: Papá trae el auto, Amigo lo estaciona..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    maxLength={120}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">{motivo.length}/120</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Duración del acceso</label>
                  <div className="grid grid-cols-4 gap-2">
                    {DURACIONES.map(d => (
                      <button
                        key={d.horas}
                        onClick={() => setDuracion(d.horas)}
                        className={`py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                          duracion === d.horas
                            ? 'border-blue-500 bg-blue-600 text-white shadow-md'
                            : `border-transparent ${d.color} hover:border-blue-300`
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-xl p-2 flex gap-2">
                  <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">El QR generado es de <strong>un solo uso</strong> y expira automáticamente en {duracion} hora{duracion > 1 ? 's' : ''}. Puedes revocarlo antes de que sea usado.</p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => { setMostrarForm(false); setMotivo('') }}
                    className="flex-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl text-sm font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleGenerar}
                    disabled={lGenerar || !motivo.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold disabled:opacity-40 transition-colors"
                  >
                    {lGenerar ? <RefreshCw size={13} className="animate-spin" /> : <QrCode size={13} />}
                    Generar QR
                  </button>
                </div>
              </div>
            )}

            {/* QR recién generado */}
            {delegacionGenerada && (
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 text-center animate-pulse-once">
                <div className="flex items-center gap-2 mb-3 justify-center">
                  <CheckCircle size={16} className="text-emerald-600" />
                  <p className="font-bold text-emerald-800 text-sm">QR temporal listo</p>
                </div>
                <QrImage value={delegacionGenerada.codigoHash} size={160} label={delegacionGenerada.motivo} />
                <p className="text-xs text-emerald-600 mt-2 font-semibold">
                  <Clock size={11} className="inline mr-1" />
                  {tiempoRestante(delegacionGenerada.fechaExpiracion)}
                </p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleCompartir(delegacionGenerada.codigoHash)}
                    className="flex-1 flex items-center justify-center gap-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold"
                  >
                    <Share2 size={12} /> Compartir código
                  </button>
                  <button
                    onClick={() => revocarQR({ variables: { qrId: delegacionGenerada.id } })}
                    disabled={lRevocar}
                    className="flex items-center justify-center gap-1 py-2 px-3 border border-red-300 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-50"
                  >
                    <Trash2 size={12} /> Revocar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Lista de delegaciones activas */}
          {delegaciones.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-slate-500" />
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                  Delegaciones activas ({delegaciones.length})
                </p>
              </div>
              <div className="space-y-2">
                {delegaciones.map(d => (
                  <div key={d.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
                    <div className="shrink-0">
                      <QrImage value={d.codigoHash} size={52} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{d.motivo}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Car size={10} className="text-slate-400" />
                        <p className="text-[11px] text-slate-500">{d.placaVehiculo}</p>
                      </div>
                      <p className="text-[10px] text-blue-600 font-semibold mt-0.5">
                        <Clock size={9} className="inline mr-0.5" />
                        {tiempoRestante(d.fechaExpiracion)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">
                        VIGENTE
                      </span>
                      <button
                        onClick={() => revocarQR({ variables: { qrId: d.id } })}
                        disabled={lRevocar}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Revocar acceso"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal QR pantalla completa */}
      {qrFullscreen && vehSel && (
        <div
          className="fixed inset-0 bg-black/90 z-[300] flex flex-col items-center justify-center p-6 cursor-pointer"
          onClick={() => setQrFullscreen(false)}
        >
          <p className="text-white text-sm mb-2 font-mono font-bold tracking-widest">{vehSel.placa}</p>
          {vehSel.codigoQr && (
            <QrImage value={vehSel.codigoQr} size={280} label="Toca para cerrar" />
          )}
          <p className="text-slate-400 text-xs mt-4">Muestra este QR al guardia en la portería</p>
        </div>
      )}
    </div>
  )
}
