import { useState, useCallback, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  UserCheck, Search, LogIn, LogOut, X, FileDown,
  ArrowRight, Clock, CheckCircle2, XCircle, Users,
  AlertTriangle, History, Filter, Calendar, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { useDebounce } from '../hooks/useDebounce'
import { ToastContainer } from '../components/ToastContainer'
import { AnfitrionCombobox } from '../components/AnfitrionCombobox'
import {
  VISITANTES_QUERY,
  VISITAS_ACTIVAS_QUERY,
  VISITAS_HISTORIAL_QUERY,
  TIPOS_VISITA_QUERY,
} from '../graphql/queries/visitantes'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import {
  REGISTRAR_VISITANTE_MUTATION,
  REGISTRAR_VISITA_MUTATION,
  INICIAR_VISITA_MUTATION,
  FINALIZAR_VISITA_MUTATION,
  CANCELAR_VISITA_MUTATION,
} from '../graphql/mutations/visitantes'

// ── Umbrales de alerta por tiempo en campus ──────────────────
const ALERTA_AMBAR_MIN = 120  // 2 horas
const ALERTA_ROJA_MIN  = 240  // 4 horas

function nivelAlerta(durMin?: number | null): 'normal' | 'ambar' | 'roja' {
  if (!durMin) return 'normal'
  if (durMin >= ALERTA_ROJA_MIN) return 'roja'
  if (durMin >= ALERTA_AMBAR_MIN) return 'ambar'
  return 'normal'
}

const ESTADO_BADGE: Record<string, string> = {
  pendiente:  'bg-amber-100 text-amber-700 border-amber-200',
  activa:     'bg-green-100 text-green-700 border-green-200',
  completada: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelada:  'bg-red-100 text-red-600 border-red-200',
}

function tiempoDesde(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatFechaHora(iso: string): string {
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

type Tab = 'activas' | 'registrar' | 'buscar' | 'historial'

// ── Modal de confirmación de salida ─────────────────────────
function ModalSalida({
  visita,
  onConfirmar,
  onCerrar,
  loading,
}: {
  visita: any
  onConfirmar: (obs: string) => void
  onCerrar: () => void
  loading: boolean
}) {
  const [obs, setObs] = useState('')
  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
        <div className="flex items-center gap-3 mb-4">
          <div className="bg-orange-100 p-2 rounded-xl"><LogOut size={18} className="text-orange-600" /></div>
          <div>
            <h3 className="font-bold text-slate-800">Registrar salida</h3>
            <p className="text-xs text-slate-500">{visita.visitante?.nombreCompleto}</p>
          </div>
        </div>
        <div className="bg-slate-50 rounded-xl p-3 mb-4 text-xs text-slate-600 space-y-1">
          {visita.placaVehiculoVisitante && (
            <p>Verificar placa: <span className="font-mono font-bold text-slate-800">{visita.placaVehiculoVisitante}</span></p>
          )}
          {visita.numAcompanantes > 0 && (
            <p>Acompañantes a registrar salida: <strong>{visita.numAcompanantes}</strong></p>
          )}
          {visita.duracionMinutos != null && (
            <p>Tiempo en campus: <strong>{Math.floor(visita.duracionMinutos / 60)}h {visita.duracionMinutos % 60}m</strong></p>
          )}
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-slate-600 mb-1">Observaciones (opcional)</label>
          <textarea
            value={obs}
            onChange={e => setObs(e.target.value)}
            placeholder="Ej: Salió sin inconvenientes, entregó credencial..."
            rows={2}
            className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onCerrar} className="flex-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl text-sm">
            Cancelar
          </button>
          <button
            onClick={() => onConfirmar(obs)}
            disabled={loading}
            className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-sm disabled:opacity-40"
          >
            {loading ? 'Registrando...' : 'Confirmar salida'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Visitantes() {
  const { usuario } = useAuth()
  const toast = useToast()

  const [tab, setTab]                       = useState<Tab>('activas')
  const [busqueda, setBusqueda]             = useState('')
  const [busquedaHistorial, setBusqHist]    = useState('')
  const [visitanteEncontrado, setVisitante] = useState<any>(null)
  const [anfitrionId, setAnfitrionId]       = useState<number | null>(null)
  const [error, setError]                   = useState('')
  const [modalSalida, setModalSalida]       = useState<any>(null)

  // Historial filtros
  const [histEstado, setHistEstado]         = useState('')
  const [histDesde, setHistDesde]           = useState('')
  const [histHasta, setHistHasta]           = useState('')

  const busquedaDebounced     = useDebounce(busqueda, 350)
  const busquedaHistDebounced = useDebounce(busquedaHistorial, 350)

  const { data: visitasData, refetch: refetchVisitas } = useQuery(VISITAS_ACTIVAS_QUERY, {
    fetchPolicy: 'cache-and-network',
    pollInterval: 30_000,
  })

  const { data: historialData, loading: loadHist } = useQuery(VISITAS_HISTORIAL_QUERY, {
    variables: {
      estado: histEstado || undefined,
      fechaDesde: histDesde || undefined,
      fechaHasta: histHasta || undefined,
      buscar: busquedaHistDebounced || undefined,
      limite: 60,
    },
    skip: tab !== 'historial',
    fetchPolicy: 'cache-and-network',
  })

  const { data: tiposData } = useQuery(TIPOS_VISITA_QUERY)
  const { data: vehiculosData } = useQuery(VEHICULOS_QUERY, { variables: { porPagina: 500 } })

  const { data: visitantesData } = useQuery(VISITANTES_QUERY, {
    variables: { buscar: busquedaDebounced || undefined },
    skip: !busquedaDebounced || (tab !== 'buscar' && tab !== 'registrar'),
    fetchPolicy: 'cache-and-network',
  })

  const [registrarVisitante, { loading: loadingVisitante }] = useMutation(REGISTRAR_VISITANTE_MUTATION, {
    onCompleted(d) {
      setVisitante(d.registrarVisitante)
      setError('')
      toast.exito('Visitante registrado', d.registrarVisitante.nombreCompleto)
    },
    onError(e) { setError(e.message); toast.error('Error', e.message) },
  })

  const [registrarVisita, { loading: loadingVisita }] = useMutation(REGISTRAR_VISITA_MUTATION, {
    onCompleted(d) {
      setError(''); setVisitante(null); setBusqueda('')
      refetchVisitas(); setTab('activas')
      toast.exito('Visita registrada', `${d.registrarVisita.visitante?.nombreCompleto} → pendiente de ingreso`)
    },
    onError(e) { setError(e.message); toast.error('Error al registrar visita', e.message) },
  })

  const [iniciarVisita, { loading: loadingIniciar }] = useMutation(INICIAR_VISITA_MUTATION, {
    onCompleted(d) { refetchVisitas(); toast.exito('Visitante ingresó', `Visita #${d.iniciarVisita.id} activa`) },
    onError(e) { toast.error('Error al iniciar visita', e.message) },
  })

  const [finalizarVisita, { loading: loadingFinalizar }] = useMutation(FINALIZAR_VISITA_MUTATION, {
    onCompleted() {
      refetchVisitas(); setModalSalida(null)
      toast.info('Salida registrada', 'Visitante salió del campus')
    },
    onError(e) { toast.error('Error al finalizar', e.message) },
  })

  const [cancelarVisita] = useMutation(CANCELAR_VISITA_MUTATION, {
    onCompleted() { refetchVisitas(); toast.alerta('Visita cancelada', '') },
    onError(e) { toast.error('Error al cancelar', e.message) },
  })

  const todasVisitas = visitasData?.visitasActivas ?? []
  const pendientes   = todasVisitas.filter((v: any) => v.estado === 'pendiente')
  const activas      = todasVisitas.filter((v: any) => v.estado === 'activa')
  const tipos        = tiposData?.tiposVisita ?? []
  const vehiculos    = vehiculosData?.vehiculos?.items ?? []
  const visitantesResultado = visitantesData?.visitantes ?? []
  const historial    = historialData?.visitasHistorial ?? []

  const visitaActivaPorVisitanteId = new Map<number, any>(
    todasVisitas.filter((v: any) => v.visitante?.id != null).map((v: any) => [v.visitante.id, v])
  )

  function handleCrearVisitante(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    registrarVisitante({
      variables: {
        input: {
          nombre:      (f.get('nombre') as string).trim(),
          apellido:    (f.get('apellido') as string).trim(),
          ci:          (f.get('ci') as string).trim(),
          telefono:    (f.get('telefono') as string).trim(),
          email:       (f.get('email') as string).trim(),
          procedencia: (f.get('procedencia') as string).trim(),
        },
      },
    })
  }

  function handleRegistrarVisita(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    if (!anfitrionId) { setError('Selecciona la persona a visitar'); return }
    const f = new FormData(e.currentTarget)
    const vehId  = f.get('vehiculoId') as string
    const tipoId = f.get('tipoVisitaId') as string
    const placa  = ((f.get('placaVehiculoVisitante') as string) || '').trim().toUpperCase()
    const acomp  = parseInt(f.get('numAcompanantes') as string) || 0
    registrarVisita({
      variables: {
        input: {
          visitanteId:            visitanteEncontrado.id,
          anfitrionId,
          motivo:                 (f.get('motivo') as string).trim(),
          tipoVisitaId:           tipoId ? parseInt(tipoId) : null,
          vehiculoId:             vehId  ? parseInt(vehId)  : null,
          placaVehiculoVisitante: placa || null,
          numAcompanantes:        acomp,
        },
      },
    })
  }

  const confirmarSalida = useCallback((obs: string) => {
    if (!modalSalida) return
    finalizarVisita({ variables: { visitaId: modalSalida.id, observaciones: obs } })
  }, [modalSalida, finalizarVisita])

  async function exportarPDF() {
    const t = localStorage.getItem('access_token') || ''
    const base = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
    const resp = await fetch(`${base}/api/pdf/visitas/`, { headers: { Authorization: `Bearer ${t}` } })
    if (!resp.ok) { toast.error(`Error al generar PDF (${resp.status})`); return }
    const blob = await resp.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `visitas_${new Date().toISOString().slice(0,10)}.pdf`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 sm:p-8">

      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500 text-white p-2 rounded-xl"><UserCheck size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Visitantes</h1>
            <p className="text-slate-500 text-xs">Registro y control de visitas al campus UAGRM</p>
          </div>
        </div>
        <button onClick={exportarPDF}
          className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors">
          <FileDown size={15} /> Exportar PDF
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
        <TabBtn active={tab === 'activas'} onClick={() => setTab('activas')}
          label={`En campus (${activas.length})${pendientes.length > 0 ? ` · ${pendientes.length} esperando` : ''}`} />
        <TabBtn active={tab === 'registrar'} onClick={() => setTab('registrar')} label="Registrar Visita" />
        <TabBtn active={tab === 'buscar'} onClick={() => setTab('buscar')} label="Buscar Visitante" />
        <TabBtn active={tab === 'historial'} onClick={() => setTab('historial')} label="Historial" />
      </div>

      {/* ── Tab: Visitas activas/pendientes ── */}
      {tab === 'activas' && (
        <div className="space-y-5">
          {pendientes.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse" />
                <h2 className="text-sm font-semibold text-amber-700">
                  Esperando ingreso — {pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}
                </h2>
              </div>
              <div className="space-y-2">
                {pendientes.map((v: any) => (
                  <VisitaCard key={v.id} visita={v}
                    onIniciar={() => iniciarVisita({ variables: { visitaId: v.id } })}
                    onFinalizar={() => setModalSalida(v)}
                    onCancelar={() => cancelarVisita({ variables: { visitaId: v.id, motivoCancelacion: 'Cancelado por guardia' } })}
                    loadingIniciar={loadingIniciar} loadingFinalizar={loadingFinalizar} />
                ))}
              </div>
            </div>
          )}

          {activas.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2.5 h-2.5 bg-green-500 rounded-full" />
                <h2 className="text-sm font-semibold text-green-700">
                  Dentro del campus — {activas.length} activa{activas.length !== 1 ? 's' : ''}
                </h2>
                {activas.some((v: any) => nivelAlerta(v.duracionMinutos) !== 'normal') && (
                  <span className="text-xs text-red-600 flex items-center gap-1 ml-2">
                    <AlertTriangle size={12} /> Hay visitas con tiempo prolongado
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {activas.map((v: any) => (
                  <VisitaCard key={v.id} visita={v}
                    onFinalizar={() => setModalSalida(v)}
                    onCancelar={() => cancelarVisita({ variables: { visitaId: v.id, motivoCancelacion: 'Cancelado por guardia' } })}
                    loadingIniciar={false} loadingFinalizar={loadingFinalizar} />
                ))}
              </div>
            </div>
          )}

          {todasVisitas.length === 0 && (
            <div className="text-center py-16 text-slate-400">
              <Users size={44} className="mx-auto mb-3 opacity-20" />
              <p className="font-medium text-slate-600">Sin visitas activas ahora</p>
              <button onClick={() => setTab('registrar')}
                className="mt-4 flex items-center gap-2 mx-auto bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                Registrar visita <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Registrar visita ── */}
      {tab === 'registrar' && (
        <div className="max-w-xl">
          {!visitanteEncontrado ? (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Paso 1 — Busca al visitante por CI o nombre</p>

              {/* Búsqueda en tiempo real (debounce 350ms) */}
              <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="CI, nombre o apellido del visitante..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  autoFocus
                  className="w-full pl-9 border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />
                {busqueda && (
                  <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Resultados */}
              {busquedaDebounced && visitantesResultado.length > 0 && (
                <div className="space-y-2 mb-4">
                  <p className="text-xs text-slate-500">{visitantesResultado.length} resultado{visitantesResultado.length > 1 ? 's' : ''}:</p>
                  {visitantesResultado.map((vt: any) => {
                    const visitaActual = visitaActivaPorVisitanteId.get(vt.id)
                    return (
                      <button key={vt.id} onClick={() => setVisitante(vt)}
                        className="w-full bg-white border border-slate-200 hover:border-cyan-400 hover:shadow-sm rounded-xl p-3 text-left transition-all flex items-center justify-between group">
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">{vt.nombreCompleto}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            CI: {vt.ci}{vt.procedencia ? ` · ${vt.procedencia}` : ''}{vt.telefono ? ` · ${vt.telefono}` : ''}
                          </p>
                          {visitaActual && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full mt-1 inline-block">
                              ⚠ Actualmente en campus
                            </span>
                          )}
                        </div>
                        <ArrowRight size={16} className="text-slate-300 group-hover:text-cyan-500 transition-colors shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}

              {/* No encontrado → formulario de registro */}
              {busquedaDebounced && visitantesResultado.length === 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <p className="text-sm font-medium text-slate-700 mb-3">
                    Visitante no encontrado — completa sus datos:
                  </p>
                  <form onSubmit={handleCrearVisitante} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Campo label="Nombre *" name="nombre" />
                      <Campo label="Apellido *" name="apellido" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Campo label="CI *" name="ci" defaultValue={busqueda} />
                      <Campo label="Teléfono" name="telefono" />
                    </div>
                    <Campo label="Email" name="email" type="email" />
                    <Campo label="Procedencia (ciudad / empresa)" name="procedencia" placeholder="Ej: Santa Cruz, Empresa ABC..." />
                    {error && <Err t={error} />}
                    <Btn loading={loadingVisitante} label="Registrar y continuar" />
                  </form>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-slate-700">Paso 2 — Datos de la visita</p>
                <button onClick={() => { setVisitante(null); setError('') }}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors">
                  <X size={13} /> Cambiar visitante
                </button>
              </div>

              {/* Tarjeta visitante / alerta si ya tiene visita activa */}
              {(() => {
                const visitaActual = visitaActivaPorVisitanteId.get(visitanteEncontrado.id)
                return visitaActual ? (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4">
                    <p className="font-bold text-amber-700 text-sm">⚠ Visitante ya en campus</p>
                    <p className="text-sm font-bold text-slate-800 mt-1">{visitanteEncontrado.nombreCompleto}</p>
                    <p className="text-xs text-slate-500">CI: {visitanteEncontrado.ci}</p>
                    <div className="mt-2 text-xs text-amber-700 space-y-0.5">
                      <p>Estado: <strong>{visitaActual.estado}</strong></p>
                      <p>Visita con: <strong>{visitaActual.anfitrionNombre}</strong></p>
                      <p>Motivo: {visitaActual.motivo}</p>
                    </div>
                    <button onClick={() => { setVisitante(null); setTab('activas') }}
                      className="mt-3 w-full bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl text-xs font-semibold transition-colors">
                      Ver visita activa →
                    </button>
                  </div>
                ) : (
                  <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-3 mb-4 flex items-center gap-3">
                    <div className="bg-cyan-100 p-2 rounded-xl shrink-0"><UserCheck size={18} className="text-cyan-600" /></div>
                    <div>
                      <p className="font-bold text-cyan-800 text-sm">{visitanteEncontrado.nombreCompleto}</p>
                      <p className="text-xs text-cyan-600">CI: {visitanteEncontrado.ci}{visitanteEncontrado.procedencia ? ` · ${visitanteEncontrado.procedencia}` : ''}</p>
                    </div>
                    <CheckCircle2 size={18} className="text-cyan-500 ml-auto shrink-0" />
                  </div>
                )
              })()}

              <form onSubmit={handleRegistrarVisita} className="space-y-3">
                {/* Tipo de visita */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de visita *</label>
                  <select name="tipoVisitaId" required className={cls}>
                    <option value="">Seleccionar tipo...</option>
                    {tipos.map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}{t.requiereVehiculo ? ' ⚠ requiere vehículo' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Anfitrión — combobox con búsqueda en tiempo real */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Persona a visitar (anfitrión) *</label>
                  <AnfitrionCombobox
                    value={anfitrionId}
                    onChange={(id) => setAnfitrionId(id)}
                    required
                    placeholder="Escribe el nombre o CI del docente/administrativo..."
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Busca por nombre completo o número de CI</p>
                </div>

                {/* Motivo */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Motivo de la visita *</label>
                  <input type="text" name="motivo" required placeholder="Ej. Reunión académica, entrega de documentos..." className={cls} />
                </div>

                {/* Nº acompañantes */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Número de acompañantes</label>
                  <input type="number" name="numAcompanantes" min={0} max={20} defaultValue={0}
                    className={cls} />
                  <p className="text-xs text-slate-400 mt-0.5">Personas que ingresan junto al visitante registrado</p>
                </div>

                {/* Placa visitante */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Placa del vehículo del visitante
                    <span className="ml-1 text-slate-400 font-normal">(opcional)</span>
                  </label>
                  <input type="text" name="placaVehiculoVisitante"
                    placeholder="Ej: ABC-123 · TAXI · A PIE"
                    maxLength={20} className={`${cls} uppercase`}
                    style={{ textTransform: 'uppercase' }} />
                  <p className="text-xs text-slate-400 mt-1">Se verifica al registrar la salida</p>
                </div>

                {/* Vehículo UAGRM */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Vehículo UAGRM asociado
                    <span className="ml-1 text-slate-400 font-normal">(solo si usa vehículo registrado)</span>
                  </label>
                  <select name="vehiculoId" className={cls}>
                    <option value="">No aplica</option>
                    {vehiculos.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                    ))}
                  </select>
                </div>

                {error && <Err t={error} />}

                {!visitaActivaPorVisitanteId.has(visitanteEncontrado.id) && (
                  <>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-500 space-y-1">
                      <p className="font-medium text-slate-600">Flujo de registro:</p>
                      <p>1. Visita queda en <strong>pendiente</strong> → el visitante está en la garita</p>
                      <p>2. Haz clic en <strong>Iniciar ingreso</strong> cuando entre al campus</p>
                      <p>3. Cuando salga, haz clic en <strong>Registrar salida</strong></p>
                    </div>
                    <Btn loading={loadingVisita} label="Registrar visita →" color="bg-cyan-500 hover:bg-cyan-600" />
                  </>
                )}
              </form>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Buscar visitante ── */}
      {tab === 'buscar' && (
        <div className="max-w-xl">
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por CI, nombre, apellido o procedencia..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              autoFocus
              className="w-full pl-9 border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
            {busqueda && (
              <button onClick={() => setBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {busquedaDebounced && visitantesResultado.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              <UserCheck size={32} className="mx-auto mb-2 opacity-20" />
              <p>No encontrado: "{busquedaDebounced}"</p>
              <button onClick={() => setTab('registrar')} className="mt-3 text-cyan-600 hover:underline text-xs">
                ¿Registrar nuevo visitante?
              </button>
            </div>
          )}

          <div className="space-y-2">
            {visitantesResultado.map((vt: any) => {
              const visitaActual = visitaActivaPorVisitanteId.get(vt.id)
              const enCampus = !!visitaActual
              return (
                <div key={vt.id} className={`bg-white rounded-xl shadow-sm border p-4 ${enCampus ? 'border-amber-300' : 'border-slate-100'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="font-semibold text-slate-800">{vt.nombreCompleto}</p>
                        {enCampus && (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            visitaActual.estado === 'activa' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-amber-100 text-amber-700 border-amber-300'
                          }`}>
                            {visitaActual.estado === 'activa' ? '✓ Dentro del campus' : '⏳ Esperando ingreso'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                        <span>CI: <span className="font-mono font-medium">{vt.ci}</span></span>
                        {vt.procedencia && <span>📍 {vt.procedencia}</span>}
                        {vt.telefono && <span>{vt.telefono}</span>}
                      </div>
                      {enCampus && (
                        <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 space-y-0.5">
                          <p><span className="font-medium">Visita con:</span> {visitaActual.anfitrionNombre}</p>
                          <p><span className="font-medium">Motivo:</span> {visitaActual.motivo}</p>
                          {visitaActual.fechaEntrada && <p>En campus hace {tiempoDesde(visitaActual.fechaEntrada)}</p>}
                        </div>
                      )}
                    </div>
                    {enCampus ? (
                      <button onClick={() => setTab('activas')}
                        className="shrink-0 flex items-center gap-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap">
                        Ver visita activa <ArrowRight size={13} />
                      </button>
                    ) : (
                      <button onClick={() => { setVisitante(vt); setTab('registrar') }}
                        className="shrink-0 flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-600 text-white px-3 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap">
                        Registrar visita <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {!busquedaDebounced && (
            <div className="text-center py-10 text-slate-400 text-sm">
              <Search size={32} className="mx-auto mb-2 opacity-20" />
              <p>Escribe un CI, nombre o apellido para buscar</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Historial ── */}
      {tab === 'historial' && (
        <div>
          {/* Filtros */}
          <div className="flex flex-wrap gap-3 mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs font-semibold text-slate-600">Filtros:</span>
            </div>

            {/* Búsqueda inteligente */}
            <div className="relative flex-1 min-w-48">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar visitante, motivo..."
                value={busquedaHistorial}
                onChange={e => setBusqHist(e.target.value)}
                className="w-full pl-8 border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>

            {/* Estado */}
            <select value={histEstado} onChange={e => setHistEstado(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400">
              <option value="">Completadas + Canceladas</option>
              <option value="completada">Solo completadas</option>
              <option value="cancelada">Solo canceladas</option>
            </select>

            {/* Fecha desde */}
            <div className="flex items-center gap-1">
              <Calendar size={13} className="text-slate-400" />
              <input type="date" value={histDesde} onChange={e => setHistDesde(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400" />
            </div>
            <input type="date" value={histHasta} onChange={e => setHistHasta(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400" />

            {(histEstado || histDesde || histHasta || busquedaHistorial) && (
              <button onClick={() => { setHistEstado(''); setHistDesde(''); setHistHasta(''); setBusqHist('') }}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                <X size={12} /> Limpiar
              </button>
            )}
          </div>

          {loadHist && <p className="text-slate-400 text-sm text-center py-8">Cargando historial...</p>}

          {!loadHist && historial.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <History size={40} className="mx-auto mb-3 opacity-20" />
              <p>Sin visitas en el historial con los filtros aplicados</p>
            </div>
          )}

          <div className="space-y-2">
            {historial.map((v: any) => (
              <div key={v.id} className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className="font-semibold text-slate-800 text-sm">{v.visitante?.nombreCompleto}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_BADGE[v.estado] ?? ''}`}>
                        {v.estado}
                      </span>
                      {v.tipoVisita && <span className="text-[10px] bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full border border-cyan-200">{v.tipoVisita.nombre}</span>}
                      {v.tipoCierre === 'manual_guardia' && (
                        <span className="flex items-center gap-0.5 text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full border border-green-200">
                          <ShieldCheck size={9} /> Guardia verificó salida
                        </span>
                      )}
                      {v.tipoCierre === 'confirmado_anfitrion' && (
                        <span className="flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200">
                          <CheckCircle2 size={9} /> Anfitrión confirmó salida
                        </span>
                      )}
                      {v.tipoCierre === 'auto' && (
                        <span className="flex items-center gap-0.5 text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">
                          <AlertTriangle size={9} /> Auto-cerrada — salida no verificada
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 space-y-0.5">
                      <p>CI: <span className="font-mono">{v.visitante?.ci}</span>{v.visitante?.procedencia ? ` · ${v.visitante.procedencia}` : ''}</p>
                      <p>Visita con: {v.anfitrionNombre}</p>
                      <p>Motivo: {v.motivo}</p>
                      {v.numAcompanantes > 0 && <p>Acompañantes: {v.numAcompanantes}</p>}
                      {v.placaVehiculoVisitante && <p>Vehículo: <span className="font-mono">{v.placaVehiculoVisitante}</span></p>}
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-xs text-slate-400 space-y-1">
                    {v.fechaEntrada && <p>{formatFechaHora(v.fechaEntrada)}</p>}
                    {v.duracionMinutos != null && (
                      <p className="font-medium text-slate-600">
                        <Clock size={10} className="inline mr-0.5" />
                        {Math.floor(v.duracionMinutos / 60)}h {v.duracionMinutos % 60}m
                      </p>
                    )}
                    {v.observaciones && <p className="text-slate-400 max-w-32 truncate" title={v.observaciones}>{v.observaciones}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de salida con confirmación */}
      {modalSalida && (
        <ModalSalida
          visita={modalSalida}
          onConfirmar={confirmarSalida}
          onCerrar={() => setModalSalida(null)}
          loading={loadingFinalizar}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />
    </div>
  )
}

// ── Tarjeta de visita ────────────────────────────────────────
function VisitaCard({ visita: v, onIniciar, onFinalizar, onCancelar, loadingIniciar, loadingFinalizar }: {
  visita: any; onIniciar?: () => void; onFinalizar?: () => void; onCancelar: () => void
  loadingIniciar: boolean; loadingFinalizar: boolean
}) {
  const esPendiente = v.estado === 'pendiente'
  const alerta = nivelAlerta(v.duracionMinutos)

  const borderColor = esPendiente ? 'border-amber-400'
    : alerta === 'roja' ? 'border-red-500'
    : alerta === 'ambar' ? 'border-amber-500'
    : 'border-green-500'

  return (
    <div className={`bg-white rounded-xl border-l-4 shadow-sm p-4 ${borderColor}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-bold text-slate-800">{v.visitante?.nombreCompleto ?? '—'}</p>
            <span className="text-xs text-slate-400 font-mono">CI: {v.visitante?.ci}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${ESTADO_BADGE[v.estado] ?? ''}`}>
              {esPendiente ? '⏳ Esperando ingreso' : '✓ Dentro del campus'}
            </span>
            {alerta === 'roja' && (
              <span className="flex items-center gap-0.5 text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                <AlertTriangle size={9} /> +4h en campus
              </span>
            )}
            {alerta === 'ambar' && (
              <span className="flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold">
                <Clock size={9} /> +2h en campus
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 space-y-0.5">
            <p><span className="font-medium text-slate-700">Visita a:</span> {v.anfitrionNombre}</p>
            <p><span className="font-medium text-slate-700">Motivo:</span> {v.motivo}</p>
            {v.tipoVisita && <p>Tipo: <span className="text-cyan-700 font-medium">{v.tipoVisita.nombre}</span></p>}
            {v.numAcompanantes > 0 && <p>Grupo: {v.numAcompanantes + 1} persona{v.numAcompanantes + 1 > 1 ? 's' : ''} total</p>}
            {v.placaVehiculoVisitante ? (
              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg font-mono font-bold text-xs mt-1 ${
                !esPendiente ? 'bg-violet-100 text-violet-800 border border-violet-300' : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>
                <span className="text-[10px] font-sans font-medium opacity-70">Vehículo:</span>
                {v.placaVehiculoVisitante}
              </div>
            ) : (
              <p className="text-slate-300 italic text-[10px]">Sin vehículo registrado</p>
            )}
            {!esPendiente && v.fechaEntrada && (
              <p className="flex items-center gap-1 text-green-600 font-medium mt-0.5">
                <Clock size={11} /> En campus hace {tiempoDesde(v.fechaEntrada)}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {esPendiente && onIniciar && (
            <button onClick={onIniciar} disabled={loadingIniciar}
              className="flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
              <LogIn size={13} /> Iniciar ingreso
            </button>
          )}
          {!esPendiente && onFinalizar && (
            <button onClick={onFinalizar} disabled={loadingFinalizar}
              className={`flex items-center gap-1 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                alerta === 'roja' ? 'bg-red-500 hover:bg-red-600' : 'bg-orange-500 hover:bg-orange-600'
              }`}>
              <LogOut size={13} /> Registrar salida
            </button>
          )}
          <button onClick={onCancelar}
            className="flex items-center gap-1 text-red-400 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors">
            <XCircle size={13} /> Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
      active ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-slate-500 hover:text-slate-700'
    }`}>
      {label}
    </button>
  )
}

const cls = 'w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400'

function Campo({ label, name, type = 'text', defaultValue = '', placeholder = '' }: {
  label: string; name: string; type?: string; defaultValue?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} className={cls} />
    </div>
  )
}

function Err({ t }: { t: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{t}</div>
}

function Btn({ loading, label, color = 'bg-cyan-500 hover:bg-cyan-600' }: {
  loading: boolean; label: string; color?: string
}) {
  return (
    <button type="submit" disabled={loading}
      className={`w-full ${color} text-white font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50`}>
      {loading ? 'Guardando...' : label}
    </button>
  )
}
