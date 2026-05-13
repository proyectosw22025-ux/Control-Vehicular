import { useState, FormEvent, useRef } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { DoorOpen, QrCode, Search, Clock, ArrowUp, ArrowDown, X, Camera, CameraOff } from 'lucide-react'
import { QrImage } from '../components/QrImage'
import { QrScanner } from '../components/QrScanner'
import {
  PUNTOS_ACCESO_QUERY,
  REGISTROS_ACCESO_QUERY,
} from '../graphql/queries/acceso'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import {
  REGISTRAR_ACCESO_MUTATION,
  REGISTRAR_ACCESO_MANUAL_MUTATION,
  GENERAR_QR_DELEGACION_MUTATION,
} from '../graphql/mutations/acceso'

const METODO_BADGE: Record<string, string> = {
  qr_permanente: 'bg-emerald-100 text-emerald-700',
  qr_delegacion: 'bg-blue-100 text-blue-700',
  pase_temporal: 'bg-violet-100 text-violet-700',
  manual:        'bg-orange-100 text-orange-700',
}

const METODO_LABEL: Record<string, string> = {
  qr_permanente: 'QR Permanente',
  qr_delegacion: 'QR Delegación',
  pase_temporal:  'Pase Temporal',
  manual:         'Manual',
}

type Tab = 'qr' | 'manual' | 'historial' | 'delegacion'

export default function Acceso() {
  const [tab, setTab] = useState<Tab>('qr')
  const [puntoId, setPuntoId] = useState<number | null>(null)
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null)
  const [error, setError] = useState('')

  const { data: puntosData } = useQuery(PUNTOS_ACCESO_QUERY)
  const { data: registrosData, refetch: refetchRegistros } = useQuery(REGISTROS_ACCESO_QUERY, {
    variables: { limite: 30 },
    fetchPolicy: 'cache-and-network',
  })
  const { data: vehiculosData } = useQuery(VEHICULOS_QUERY, { variables: { porPagina: 500 } })

  const [registrarAcceso, { loading: loadingQr }] = useMutation(REGISTRAR_ACCESO_MUTATION, {
    onCompleted(d) {
      const r = d.registrarAcceso
      setResultado({ ok: true, msg: `${r.tipo === 'entrada' ? 'Entrada' : 'Salida'} registrada — ${r.placaVehiculo} (${METODO_LABEL[r.metodoAcceso] ?? r.metodoAcceso})` })
      refetchRegistros()
    },
    onError(e) { setResultado({ ok: false, msg: e.message }) },
  })

  const [registrarManual, { loading: loadingManual }] = useMutation(REGISTRAR_ACCESO_MANUAL_MUTATION, {
    onCompleted(d) {
      const r = d.registrarAccesoManual
      setResultado({ ok: true, msg: `${r.tipo === 'entrada' ? 'Entrada' : 'Salida'} manual registrada — ${r.placaVehiculo}` })
      refetchRegistros()
    },
    onError(e) { setResultado({ ok: false, msg: e.message }) },
  })

  const [generarDelegacion, { loading: loadingDeleg }] = useMutation(GENERAR_QR_DELEGACION_MUTATION, {
    onCompleted(d) {
      const qr = d.generarQrDelegacion
      const expStr = new Date(qr.fechaExpiracion).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
      setResultado({ ok: true, msg: `QR de delegación generado — válido hasta ${expStr}` })
      setDelegQr(qr.codigoHash)
      setDelegExpiracion(expStr)
    },
    onError(e) { setError(e.message) },
  })

  const [delegQr, setDelegQr] = useState<string | null>(null)
  const [delegExpiracion, setDelegExpiracion] = useState<string | null>(null)
  const [camaraActiva, setCamaraActiva] = useState(false)
  const codigoInputRef = useRef<HTMLInputElement>(null)
  const puntos = puntosData?.puntosAcceso ?? []
  const registros = registrosData?.registrosAcceso ?? []
  const vehiculos = vehiculosData?.vehiculos?.items ?? []

  function handleQr(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setResultado(null); setError('')
    const f = new FormData(e.currentTarget)
    const pid = parseInt(f.get('puntoId') as string)
    if (!pid) { setError('Selecciona un punto de acceso'); return }
    registrarAcceso({
      variables: {
        input: {
          puntoAccesoId: pid,
          codigo: (f.get('codigo') as string).trim(),
          tipo: f.get('tipo') as string,
        },
      },
    })
  }

  function handleManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setResultado(null); setError('')
    const f = new FormData(e.currentTarget)
    const pid = parseInt(f.get('puntoId') as string)
    if (!pid) { setError('Selecciona un punto de acceso'); return }
    registrarManual({
      variables: {
        input: {
          puntoAccesoId: pid,
          placa: (f.get('placa') as string).trim().toUpperCase(),
          tipo: f.get('tipo') as string,
          observacion: (f.get('observacion') as string).trim(),
        },
      },
    })
  }

  function handleDelegacion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setDelegQr(null); setError('')
    const f = new FormData(e.currentTarget)
    generarDelegacion({
      variables: {
        input: {
          vehiculoId: parseInt(f.get('vehiculoId') as string),
          motivo: (f.get('motivo') as string).trim(),
          horasValidez: parseInt(f.get('horasValidez') as string) || 24,
        },
      },
    })
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-orange-500 text-white p-2 rounded-xl"><DoorOpen size={20} /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Control de Acceso</h1>
          <p className="text-slate-500 text-xs">Registro de entradas y salidas del campus</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <TabBtn active={tab === 'qr'}        onClick={() => { setTab('qr');        setResultado(null) }} label="Registrar por QR" />
        <TabBtn active={tab === 'manual'}    onClick={() => { setTab('manual');    setResultado(null) }} label="Acceso Manual" />
        <TabBtn active={tab === 'delegacion'} onClick={() => { setTab('delegacion'); setResultado(null) }} label="QR Delegación" />
        <TabBtn active={tab === 'historial'} onClick={() => setTab('historial')} label="Historial" />
      </div>

      {/* Resultado */}
      {resultado && (
        <div className={`mb-4 rounded-xl px-4 py-3 flex items-start justify-between text-sm ${resultado.ok ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          <span>{resultado.msg}</span>
          <button onClick={() => setResultado(null)} className="ml-3 shrink-0 opacity-60 hover:opacity-100">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Por QR */}
      {tab === 'qr' && (
        <div className="max-w-sm space-y-4">
          <SelectorPunto puntos={puntos} value={puntoId} onChange={v => setPuntoId(v)} />

          {/* Selector entrada/salida */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
            <div className="grid grid-cols-2 gap-2">
              {['entrada', 'salida'].map(t => (
                <label key={t} className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2.5 cursor-pointer hover:border-orange-400 text-sm text-slate-700 capitalize">
                  <input type="radio" name="tipo-qr" value={t} defaultChecked={t === 'entrada'} className="accent-orange-500" />
                  {t === 'entrada' ? <ArrowDown size={14} className="text-green-500" /> : <ArrowUp size={14} className="text-red-500" />}
                  {t}
                </label>
              ))}
            </div>
          </div>

          {/* Toggle cámara */}
          <button
            type="button"
            onClick={() => setCamaraActiva(v => !v)}
            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors border ${
              camaraActiva
                ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {camaraActiva ? <><CameraOff size={16} /> Desactivar cámara</> : <><Camera size={16} /> Escanear con cámara</>}
          </button>

          {/* Scanner de cámara */}
          {camaraActiva && (
            <QrScanner
              activo={camaraActiva}
              onScan={(codigo) => {
                setCamaraActiva(false)
                if (codigoInputRef.current) codigoInputRef.current.value = codigo
                // Auto-enviar
                const puntoActual = puntoId
                const tipoEl = document.querySelector<HTMLInputElement>('input[name="tipo-qr"]:checked')
                if (puntoActual && tipoEl) {
                  registrarAcceso({
                    variables: {
                      input: { puntoAccesoId: puntoActual, codigo, tipo: tipoEl.value },
                    },
                  })
                }
              }}
            />
          )}

          {/* Input manual (fallback) */}
          <form onSubmit={handleQr} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {camaraActiva ? 'O pega el código manualmente' : 'Código QR *'}
              </label>
              <div className="relative">
                <QrCode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  ref={codigoInputRef}
                  type="text"
                  name="codigo"
                  required
                  placeholder="Código del QR del vehículo..."
                  className="w-full pl-9 border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono"
                />
              </div>
            </div>
            {error && <Err t={error} />}
            <button type="submit" disabled={loadingQr}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50">
              {loadingQr ? 'Procesando...' : 'Registrar acceso por QR'}
            </button>
          </form>
        </div>
      )}

      {/* Manual */}
      {tab === 'manual' && (
        <div className="max-w-sm">
          <form onSubmit={handleManual} className="space-y-3">
            <SelectorPunto puntos={puntos} value={puntoId} onChange={v => setPuntoId(v)} />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
              <div className="grid grid-cols-2 gap-2">
                {['entrada', 'salida'].map(t => (
                  <label key={t} className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2.5 cursor-pointer hover:border-orange-400 text-sm text-slate-700 capitalize">
                    <input type="radio" name="tipo" value={t} defaultChecked={t === 'entrada'} className="accent-orange-500" />
                    {t === 'entrada' ? <ArrowDown size={14} className="text-green-500" /> : <ArrowUp size={14} className="text-red-500" />}
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Placa del vehículo *</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" name="placa" required placeholder="ABC-1234"
                  className="w-full pl-9 border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono uppercase" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Observación (opcional)</label>
              <input type="text" name="observacion" placeholder="Ej. Vehículo sin QR disponible"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            {error && <Err t={error} />}
            <button type="submit" disabled={loadingManual}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50">
              {loadingManual ? 'Procesando...' : 'Registrar acceso manual'}
            </button>
          </form>
        </div>
      )}

      {/* QR Delegación */}
      {tab === 'delegacion' && (
        <div className="max-w-sm">
          <p className="text-xs text-slate-500 mb-4">
            Genera un QR de delegación de un solo uso para que otra persona ingrese con tu vehículo.
          </p>
          <form onSubmit={handleDelegacion} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo *</label>
              <select name="vehiculoId" required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                <option value="">Seleccionar...</option>
                {vehiculos.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Motivo *</label>
              <input type="text" name="motivo" required placeholder="Ej. Delegación a familiar"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Validez (horas, 1–168)</label>
              <input type="number" name="horasValidez" min={1} max={168} defaultValue={24}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            {error && <Err t={error} />}
            <button type="submit" disabled={loadingDeleg}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50">
              {loadingDeleg ? 'Generando...' : 'Generar QR de delegación'}
            </button>
          </form>
          {delegQr && (
            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-2xl p-5 flex flex-col items-center gap-3">
              <p className="text-sm font-semibold text-orange-800">QR de delegación generado</p>
              <QrImage
                value={delegQr}
                size={200}
                showDownload
                downloadName="QR-delegacion"
              />
              {delegExpiracion && (
                <div className="text-center">
                  <p className="text-xs text-orange-700 font-medium">Válido hasta</p>
                  <p className="text-sm font-bold text-orange-800">{delegExpiracion}</p>
                </div>
              )}
              <p className="text-xs text-orange-600 text-center">
                Este QR es de <strong>un solo uso</strong>. Una vez escaneado en el punto de acceso quedará invalidado.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Historial */}
      {tab === 'historial' && (
        registros.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Clock size={40} className="mx-auto mb-2 opacity-20" />
            <p>Sin registros de acceso</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Placa</th>
                  <th className="px-4 py-3 text-left">Punto</th>
                  <th className="px-4 py-3 text-left">Método</th>
                  <th className="px-4 py-3 text-left">Hora</th>
                  <th className="px-4 py-3 text-left">Observación</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registros.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-medium ${r.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                        {r.tipo === 'entrada' ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
                        {r.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-800">{r.placaVehiculo ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{r.puntoNombre}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${METODO_BADGE[r.metodoAcceso] ?? 'bg-slate-100 text-slate-500'}`}>
                        {METODO_LABEL[r.metodoAcceso] ?? r.metodoAcceso}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(r.timestamp).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{r.observacion || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}

function SelectorPunto({ puntos, value, onChange }: { puntos: any[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">Punto de acceso *</label>
      <select name="puntoId" required value={value ?? ''} onChange={e => onChange(e.target.value ? parseInt(e.target.value) : null)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
        <option value="">Seleccionar punto...</option>
        {puntos.map((p: any) => (
          <option key={p.id} value={p.id}>{p.nombre} — {p.tipo}</option>
        ))}
      </select>
    </div>
  )
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  )
}

function Err({ t }: { t: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{t}</div>
}
