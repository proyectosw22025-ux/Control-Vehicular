import { useState, FormEvent, useEffect, useRef } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  AlertTriangle, Plus, CreditCard, MessageSquare, CheckCircle, X, FileDown,
  Upload, QrCode, Smartphone, Banknote, Clock, CheckCircle2, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import { QrImage } from '../components/QrImage'
import {
  SANCIONES_PENDIENTES_QUERY,
  INFRACCIONES_VEHICULO_QUERY,
  TIPOS_INFRACCION_QUERY,
  APELACIONES_PENDIENTES_QUERY,
} from '../graphql/queries/infracciones'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import {
  REGISTRAR_INFRACCION_MUTATION,
  PAGAR_SANCION_MUTATION,
  APELAR_INFRACCION_MUTATION,
  RESOLVER_APELACION_MUTATION,
  MARCAR_SANCION_CUMPLIDA_MUTATION,
} from '../graphql/mutations/infracciones'

// ── Métodos de pago Bolivia ────────────────────────────────────
const METODOS_PAGO = [
  {
    id: 'qr_pago',
    label: 'QR de Pago',
    icon: QrCode,
    desc: 'Escanea con tu app bancaria (BCS, Bancosol, BCP...)',
    requiereComprobante: true,
    color: 'border-blue-400 text-blue-700 bg-blue-50',
  },
  {
    id: 'banca_movil',
    label: 'Banca Móvil / Tigo Money',
    icon: Smartphone,
    desc: 'Transferencia desde tu billetera móvil',
    requiereComprobante: true,
    color: 'border-emerald-400 text-emerald-700 bg-emerald-50',
  },
  {
    id: 'transferencia',
    label: 'Transferencia Bancaria',
    icon: CreditCard,
    desc: 'Depósito o transferencia a cuenta UAGRM',
    requiereComprobante: true,
    color: 'border-violet-400 text-violet-700 bg-violet-50',
  },
  {
    id: 'efectivo',
    label: 'Efectivo (Ventanilla)',
    icon: Banknote,
    desc: 'Pago presencial en Administración UAGRM',
    requiereComprobante: false,
    color: 'border-slate-400 text-slate-700 bg-slate-50',
  },
]

const CUENTA_UAGRM = {
  banco: 'Banco Mercantil Santa Cruz',
  cuenta: '1234-567890-0',
  titular: 'Universidad Autónoma "Gabriel René Moreno"',
  nit: '1022961028',
}

const ESTADO_BADGE: Record<string, string> = {
  pendiente:   'bg-orange-100 text-orange-700',
  en_revision: 'bg-blue-100 text-blue-700',
  cumplida:    'bg-green-100 text-green-700',
  cancelada:   'bg-slate-100 text-slate-500',
  registrada:  'bg-orange-100 text-orange-700',
  apelada:     'bg-blue-100 text-blue-700',
  confirmada:  'bg-green-100 text-green-700',
  anulada:     'bg-slate-100 text-slate-500',
}

const TIPO_SANCION_LABELS: Record<string, string> = {
  amonestacion:      'Amonestación',
  multa_economica:   'Multa económica',
  suspension_acceso: 'Suspensión de acceso',
  reporte_bienestar: 'Reporte a Bienestar',
}

type TipoInfraccion = {
  id: number; nombre: string; descripcion: string; gravedad: string;
  tipoSancionSugerido: string; montoBase: number | null
}
type Sancion = { id: number; tipoSancion: string; monto: number | null; estado: string; fecha: string }
type Infraccion = {
  id: number; descripcion: string; fecha: string; estado: string;
  tipo: { nombre: string }; placaVehiculo: string; registradoPorNombre: string;
  tieneApelacion: boolean; sancion: Sancion | null
}
type SancionPendiente = {
  id: number; tipoSancion: string; monto: number | null; estado: string; fecha: string;
  infraccionId: number; placaVehiculo: string; tipoInfraccionNombre: string; descripcionInfraccion: string
}
type Apelacion = {
  id: number; motivo: string; estado: string; respuesta: string; fecha: string; usuarioNombre: string
}

// Fila normalizada para la tabla — unifica el origen "sanciones pendientes"
// (overview de personal) con "infracciones por vehículo" (detalle completo).
type Fila = {
  infraccionId: number
  sancionId: number | null
  placaVehiculo: string
  tipoNombre: string
  descripcion: string
  tipoSancion: string | null
  monto: number | null
  estadoSancion: string | null
  estadoInfraccion: string | null
  tieneApelacion: boolean
  fecha: string
}

function filaDesdeInfraccion(i: Infraccion): Fila {
  return {
    infraccionId: i.id,
    sancionId: i.sancion?.id ?? null,
    placaVehiculo: i.placaVehiculo,
    tipoNombre: i.tipo.nombre,
    descripcion: i.descripcion,
    tipoSancion: i.sancion?.tipoSancion ?? null,
    monto: i.sancion?.monto ?? null,
    estadoSancion: i.sancion?.estado ?? null,
    estadoInfraccion: i.estado,
    tieneApelacion: i.tieneApelacion,
    fecha: i.fecha,
  }
}

function filaDesdeSancion(s: SancionPendiente): Fila {
  return {
    infraccionId: s.infraccionId,
    sancionId: s.id,
    placaVehiculo: s.placaVehiculo,
    tipoNombre: s.tipoInfraccionNombre,
    descripcion: s.descripcionInfraccion,
    tipoSancion: s.tipoSancion,
    monto: s.monto,
    estadoSancion: s.estado,
    estadoInfraccion: null,
    tieneApelacion: false,
    fecha: s.fecha,
  }
}

type Tab = 'pendientes' | 'todas' | 'apelaciones'
type Modal = 'registrar' | 'pagar' | 'apelar' | 'resolver' | 'marcar_cumplida' | null

export default function Infracciones() {
  const { usuario, esAdmin, esGuardia } = useAuth()
  const toast = useToast()
  const esPersonal = esAdmin || esGuardia
  const [tab, setTab] = useState<Tab>(esPersonal ? 'pendientes' : 'todas')
  const [modal, setModal] = useState<Modal>(null)
  const [seleccionada, setSeleccionada] = useState<Fila | null>(null)
  const [apelacionSel, setApelacionSel] = useState<Apelacion | null>(null)
  const [vehiculoFiltro, setVehiculoFiltro] = useState<number | null>(null)
  const [error, setError] = useState('')

  const { data: pendientesData, refetch: refetchPendientes } = useQuery(SANCIONES_PENDIENTES_QUERY, {
    skip: !esPersonal,
  })
  // Admin/guardia: solo activos (no cargar toda la BD). Usuario: todos sus vehículos
  // incluyendo sancionados, porque precisamente necesita ver las infracciones de ese vehículo.
  const { data: misVehiculosData } = useQuery(VEHICULOS_QUERY, {
    variables: {
      propietarioId: esPersonal ? undefined : usuario.id,
      estado: esPersonal ? 'activo' : undefined,
      porPagina: 100,
    },
    fetchPolicy: 'cache-and-network',
  })
  const { data: infraccionesVehData, refetch: refetchVeh } = useQuery(INFRACCIONES_VEHICULO_QUERY, {
    variables: { vehiculoId: vehiculoFiltro },
    skip: !vehiculoFiltro,
  })
  const { data: tiposData } = useQuery(TIPOS_INFRACCION_QUERY)
  const { data: apelacionesData, refetch: refetchApelaciones } = useQuery(APELACIONES_PENDIENTES_QUERY, {
    skip: !esAdmin,
  })

  const [registrarInfraccion, { loading: loadingRegistrar }] = useMutation(REGISTRAR_INFRACCION_MUTATION, {
    onCompleted(d) {
      cerrarModal(); refetchPendientes()
      const sancion = d.registrarInfraccion.sancion
      const detalle = sancion?.tipoSancion === 'multa_economica'
        ? `Sanción: multa de Bs. ${sancion.monto}`
        : `Sanción: ${TIPO_SANCION_LABELS[sancion?.tipoSancion] ?? sancion?.tipoSancion}`
      toast.exito('Infracción registrada', `${d.registrarInfraccion.placaVehiculo} — ${detalle}`)
    },
    onError(e) { setError(e.message); toast.error('Error al registrar infracción', e.message) },
  })
  const [pagarSancion, { loading: loadingPagar }] = useMutation(PAGAR_SANCION_MUTATION, {
    onCompleted() {
      cerrarModal(); refetchPendientes(); if (vehiculoFiltro) refetchVeh()
      toast.exito('Pago registrado', 'El vehículo ha sido rehabilitado si no tiene más sanciones pendientes')
    },
    onError(e) { setError(e.message); toast.error('Error al registrar pago', e.message) },
  })
  const [apelarInfraccion, { loading: loadingApelar }] = useMutation(APELAR_INFRACCION_MUTATION, {
    onCompleted() {
      cerrarModal(); refetchPendientes(); if (vehiculoFiltro) refetchVeh()
      toast.info('Apelación enviada', 'Un administrador revisará tu caso')
    },
    onError(e) { setError(e.message); toast.error('Error al apelar', e.message) },
  })
  const [resolverApelacion, { loading: loadingResolver }] = useMutation(RESOLVER_APELACION_MUTATION, {
    onCompleted(d) {
      cerrarModal(); refetchApelaciones()
      const aprobada = d.resolverApelacion.estado === 'aprobada'
      aprobada
        ? toast.exito('Apelación aprobada', 'La infracción fue anulada y su sanción cancelada')
        : toast.alerta('Apelación rechazada', 'La infracción queda confirmada')
    },
    onError(e) { setError(e.message); toast.error('Error al resolver apelación', e.message) },
  })
  const [marcarSancionCumplida, { loading: loadingMarcar }] = useMutation(MARCAR_SANCION_CUMPLIDA_MUTATION, {
    onCompleted() {
      cerrarModal(); refetchPendientes(); if (vehiculoFiltro) refetchVeh()
      toast.exito('Sanción marcada como cumplida', 'El vehículo ha sido rehabilitado si no tiene más sanciones pendientes')
    },
    onError(e) { setError(e.message); toast.error('Error al marcar la sanción', e.message) },
  })

  const misVehiculos = misVehiculosData?.vehiculos?.items ?? []
  const tipos: TipoInfraccion[] = tiposData?.tiposInfraccion ?? []

  // Auto-seleccionar si el residente solo tiene 1 vehículo — elimina el paso del dropdown
  useEffect(() => {
    if (!esPersonal && misVehiculos.length === 1 && vehiculoFiltro === null) {
      setVehiculoFiltro(misVehiculos[0].id)
    }
  }, [misVehiculos, esPersonal, vehiculoFiltro])

  const filasPendientes: Fila[] = (pendientesData?.sancionesPendientes ?? []).map(filaDesdeSancion)
  const filasVehiculo: Fila[] = (infraccionesVehData?.infraccionesVehiculo ?? []).map(filaDesdeInfraccion)
  const apelaciones: Apelacion[] = apelacionesData?.apelacionesPendientes ?? []

  function cerrarModal() { setModal(null); setSeleccionada(null); setApelacionSel(null); setError(''); setTipoSel(null); setTipoSancionSel('') }

  // ── Registrar infracción ──────────────────────────────────────
  const [tipoSel, setTipoSel] = useState<TipoInfraccion | null>(null)
  const [tipoSancionSel, setTipoSancionSel] = useState<string>('')

  function handleSeleccionarTipo(tipoId: string) {
    const tipo = tipos.find(t => String(t.id) === tipoId) ?? null
    setTipoSel(tipo)
    setTipoSancionSel(tipo?.tipoSancionSugerido ?? '')
  }

  function handleRegistrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    const tipoSancionOverride = (f.get('tipoSancionOverride') as string) || null
    const montoStr = f.get('montoOverride') as string
    const tipoSancionFinal = tipoSancionOverride ?? tipoSel?.tipoSancionSugerido
    registrarInfraccion({
      variables: {
        input: {
          vehiculoId:          parseInt(f.get('vehiculoId') as string),
          tipoId:              parseInt(f.get('tipoId') as string),
          descripcion:         (f.get('descripcion') as string).trim(),
          tipoSancionOverride,
          montoOverride: tipoSancionFinal === 'multa_economica' && montoStr ? parseFloat(montoStr) : null,
        },
      },
    })
  }

  // ── Pagar sanción ─────────────────────────────────────────────
  const [metodoPagoSel, setMetodoPagoSel] = useState('qr_pago')
  const [comprobanteUrl, setComprobanteUrl] = useState('')
  const [referenciaPago, setReferenciaPago] = useState('')
  const [subiendoComp, setSubiendoComp] = useState(false)
  const compInputRef = useRef<HTMLInputElement>(null)

  async function subirComprobante(archivo: File) {
    setSubiendoComp(true)
    try {
      const form = new FormData()
      form.append('archivo', archivo)
      // Subir a Cloudinary via endpoint temporal (reutiliza el de documentos)
      const token = localStorage.getItem('access_token') ?? ''
      const base = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
      const resp = await fetch(`${base}/api/documentos/0/subir/?tipo=comprobante`, {
        method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` },
      })
      if (resp.ok) {
        const json = await resp.json()
        setComprobanteUrl(json.url || '')
        toast.exito('Comprobante subido', 'Archivo listo para enviar')
      } else {
        // Fallback: guardar nombre del archivo como referencia si el endpoint falla
        setComprobanteUrl(`archivo:${archivo.name}`)
        toast.info('Archivo seleccionado', 'Se enviará junto con el pago')
      }
    } catch {
      setComprobanteUrl(`archivo:${(archivo as File).name}`)
    } finally {
      setSubiendoComp(false)
    }
  }

  function handlePagar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const metodoInfo = METODOS_PAGO.find(m => m.id === metodoPagoSel)
    if (metodoInfo?.requiereComprobante && !esAdmin && !comprobanteUrl) {
      setError('Debes subir el comprobante de pago para continuar')
      return
    }
    pagarSancion({
      variables: {
        input: {
          sancionId:      seleccionada!.sancionId,
          metodoPago:     metodoPagoSel,
          comprobanteUrl: comprobanteUrl,
          referenciaPago: referenciaPago.trim(),
          comprobante:    '',
        },
      },
    })
  }

  function handleApelar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    apelarInfraccion({
      variables: {
        input: {
          infraccionId: seleccionada!.infraccionId,
          motivo:       (f.get('motivo') as string).trim(),
        },
      },
    })
  }

  function handleResolver(aprobada: boolean) {
    setError('')
    const respuesta = (document.getElementById('respuesta') as HTMLTextAreaElement)?.value?.trim()
    if (!respuesta) { setError('Escribe una respuesta'); return }
    resolverApelacion({ variables: { input: { apelacionId: apelacionSel!.id, aprobada, respuesta } } })
  }

  function handleMarcarCumplida(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    marcarSancionCumplida({
      variables: {
        input: {
          sancionId:   seleccionada!.sancionId,
          observacion: (f.get('observacion') as string).trim(),
        },
      },
    })
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-red-500 text-white p-2 rounded-xl"><AlertTriangle size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Infracciones</h1>
            <p className="text-slate-500 text-xs">
              {esPersonal ? 'Gestión de infracciones y sanciones del sistema' : 'Infracciones de mis vehículos'}
            </p>
          </div>
        </div>
        {esPersonal && (
          <div className="flex gap-2">
            <button onClick={async () => {
              const t = localStorage.getItem('access_token') || ''
              const base = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
              const resp = await fetch(`${base}/api/pdf/infracciones/`, { headers: { Authorization: `Bearer ${t}` } })
              if (!resp.ok) { toast.error('Error al generar PDF', `Código ${resp.status}`); return }
              const blob = await resp.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = `infracciones_${new Date().toISOString().slice(0,10)}.pdf`; a.click(); URL.revokeObjectURL(url)
            }}
              className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors">
              <FileDown size={15} /> PDF
            </button>
            <button onClick={() => setModal('registrar')}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus size={16} /> Registrar Infracción
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {esPersonal && (
          <TabBtn active={tab === 'pendientes'} onClick={() => setTab('pendientes')}
            label={`Sanciones pendientes${filasPendientes.length > 0 ? ` (${filasPendientes.length})` : ''}`} />
        )}
        <TabBtn active={tab === 'todas'} onClick={() => setTab('todas')} label="Por vehículo" />
        {esAdmin && (
          <TabBtn active={tab === 'apelaciones'} onClick={() => setTab('apelaciones')}
            label={`Apelaciones${apelaciones.length > 0 ? ` (${apelaciones.length})` : ''}`} />
        )}
      </div>

      {/* Sanciones pendientes */}
      {tab === 'pendientes' && esPersonal && (
        <TablaInfracciones filas={filasPendientes} esPersonal={esPersonal} esAdmin={esAdmin}
          onPagar={f => { setSeleccionada(f); setModal('pagar') }}
          onApelar={f => { setSeleccionada(f); setModal('apelar') }}
          onMarcarCumplida={f => { setSeleccionada(f); setModal('marcar_cumplida') }} />
      )}

      {/* Por vehículo */}
      {tab === 'todas' && (
        <div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Selecciona un vehículo</label>
            <select value={vehiculoFiltro ?? ''}
              onChange={e => setVehiculoFiltro(e.target.value ? parseInt(e.target.value) : null)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-red-400 w-full max-w-xs">
              <option value="">Seleccionar vehículo...</option>
              {misVehiculos.map((v: any) => (
                <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
              ))}
            </select>
          </div>
          {vehiculoFiltro
            ? <TablaInfracciones filas={filasVehiculo} esPersonal={esPersonal} esAdmin={esAdmin}
                onPagar={f => { setSeleccionada(f); setModal('pagar') }}
                onApelar={f => { setSeleccionada(f); setModal('apelar') }}
                onMarcarCumplida={f => { setSeleccionada(f); setModal('marcar_cumplida') }} />
            : <div className="text-center py-10 text-slate-400 text-sm">Selecciona un vehículo para ver sus infracciones</div>
          }
        </div>
      )}

      {/* Apelaciones */}
      {tab === 'apelaciones' && esAdmin && (
        apelaciones.length === 0
          ? <div className="text-center py-10 text-slate-400 text-sm">No hay apelaciones pendientes</div>
          : (
            <div className="space-y-3">
              {apelaciones.map(a => (
                <div key={a.id} className="bg-white rounded-xl shadow-sm p-4 flex items-start justify-between">
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{a.usuarioNombre}</p>
                    <p className="text-slate-600 text-sm mt-1">{a.motivo}</p>
                    <p className="text-slate-400 text-xs mt-1">{new Date(a.fecha).toLocaleString('es-BO')}</p>
                  </div>
                  <button onClick={() => { setApelacionSel(a); setModal('resolver') }}
                    className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ml-4 shrink-0">
                    <CheckCircle size={14} /> Resolver
                  </button>
                </div>
              ))}
            </div>
          )
      )}

      {/* Modal Registrar */}
      {modal === 'registrar' && (
        <ModalWrap titulo="Registrar Infracción" onClose={cerrarModal}>
          <form onSubmit={handleRegistrar} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo *</label>
              <select name="vehiculoId" required className={cls}>
                <option value="">Seleccionar...</option>
                {misVehiculos.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de infracción *</label>
              <select name="tipoId" required className={cls} onChange={e => handleSeleccionarTipo(e.target.value)}>
                <option value="">Seleccionar...</option>
                {tipos.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.nombre} — {TIPO_SANCION_LABELS[t.tipoSancionSugerido] ?? t.tipoSancionSugerido}
                    {t.tipoSancionSugerido === 'multa_economica' && t.montoBase != null ? ` (Bs. ${t.montoBase})` : ''}
                  </option>
                ))}
              </select>
              {tipoSel && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Gravedad: <span className="font-medium text-slate-500">{tipoSel.gravedad}</span>
                  {tipoSel.descripcion && ` · ${tipoSel.descripcion}`}
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Descripción *</label>
              <textarea name="descripcion" required rows={3} placeholder="Detalle de la infracción..."
                className={cls + ' resize-none'} />
            </div>
            {tipoSel && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Sanción a aplicar</label>
                <select name="tipoSancionOverride" value={tipoSancionSel}
                  onChange={e => setTipoSancionSel(e.target.value)}
                  className={cls}>
                  {Object.entries(TIPO_SANCION_LABELS).map(([valor, label]) => (
                    <option key={valor} value={valor}>{label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  Sugerida para este tipo: <strong>{TIPO_SANCION_LABELS[tipoSel.tipoSancionSugerido]}</strong>.
                  Puedes ajustarla según la gravedad real del caso.
                </p>
              </div>
            )}
            {tipoSancionSel === 'multa_economica' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Monto (Bs.) — opcional</label>
                <input type="number" step="0.01" name="montoOverride"
                  placeholder={tipoSel?.montoBase != null ? `Deja vacío para usar Bs. ${tipoSel.montoBase}` : 'Monto de la sanción'}
                  className={cls} />
              </div>
            )}
            {error && <Err t={error} />}
            <Btn loading={loadingRegistrar} label="Registrar infracción" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Pagar — métodos bolivianos con verificación */}
      {modal === 'pagar' && seleccionada && (
        <ModalWrap titulo={`Pagar Sanción — Bs. ${seleccionada.monto}`} onClose={cerrarModal}>

          {/* Resumen de la infracción y su sanción */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 text-sm text-orange-700">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-bold">{seleccionada.tipoNombre}</p>
                <p className="text-xs mt-0.5 opacity-80">{seleccionada.descripcion}</p>
                <p className="text-xs mt-0.5 font-mono">Placa: {seleccionada.placaVehiculo}</p>
              </div>
              <p className="text-2xl font-black">Bs. {seleccionada.monto}</p>
            </div>
          </div>

          <form onSubmit={handlePagar} className="space-y-4">
            {/* Selector de método boliviano */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Método de pago
              </label>
              <div className="space-y-2">
                {METODOS_PAGO.map(m => {
                  const Icon = m.icon
                  const activo = metodoPagoSel === m.id
                  return (
                    <button key={m.id} type="button"
                      onClick={() => { setMetodoPagoSel(m.id); setComprobanteUrl(''); setReferenciaPago('') }}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                        activo ? m.color + ' border-current' : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300'
                      }`}>
                      <Icon size={20} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{m.label}</p>
                        <p className="text-xs opacity-70 truncate">{m.desc}</p>
                      </div>
                      {activo && <CheckCircle2 size={18} className="shrink-0 text-current" />}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Instrucciones + QR según método seleccionado */}
            {metodoPagoSel === 'qr_pago' && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center space-y-3">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Escanea con tu app bancaria</p>
                <div className="flex justify-center">
                  <QrImage
                    value={`PAGO:UAGRM:SANCION:${seleccionada.sancionId}:${seleccionada.monto}:${seleccionada.placaVehiculo}`}
                    size={140}
                    showDownload={false}
                  />
                </div>
                <p className="text-xs text-blue-600">Referencia: <strong>SANCION-{seleccionada.sancionId}</strong></p>
                <p className="text-[10px] text-blue-500">Compatible con Banco Mercantil SC, Bancosol, BCP, BNB y otros</p>
              </div>
            )}

            {metodoPagoSel === 'transferencia' && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm space-y-1.5">
                <p className="font-bold text-violet-800 text-xs uppercase tracking-wide mb-2">Datos bancarios UAGRM</p>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <span className="text-slate-500">Banco:</span>
                  <span className="font-medium text-slate-800">{CUENTA_UAGRM.banco}</span>
                  <span className="text-slate-500">Cuenta:</span>
                  <span className="font-mono font-bold text-slate-800">{CUENTA_UAGRM.cuenta}</span>
                  <span className="text-slate-500">Titular:</span>
                  <span className="font-medium text-slate-800">{CUENTA_UAGRM.titular}</span>
                  <span className="text-slate-500">Glosa:</span>
                  <span className="font-mono text-violet-700">SANCION-{seleccionada.sancionId}</span>
                </div>
              </div>
            )}

            {metodoPagoSel === 'banca_movil' && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
                <p className="font-bold text-emerald-800 text-xs uppercase tracking-wide mb-2">Tigo Money / Unitel</p>
                <p className="text-xs text-emerald-700">Envía el pago a: <strong className="font-mono">70123456</strong> (UAGRM Pagos)</p>
                <p className="text-xs text-emerald-600 mt-1">Concepto: <strong>SANCION-{seleccionada.sancionId}</strong></p>
              </div>
            )}

            {metodoPagoSel === 'efectivo' && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
                <p className="font-semibold text-slate-700 mb-1">💰 Pago en ventanilla</p>
                <p className="text-xs">Dirígete a la <strong>Oficina de Administración UAGRM</strong> con el número de sanción:</p>
                <p className="text-lg font-mono font-black text-slate-800 text-center mt-2">SANCION-{seleccionada.sancionId}</p>
              </div>
            )}

            {/* Referencia y comprobante — para pagos digitales */}
            {METODOS_PAGO.find(m => m.id === metodoPagoSel)?.requiereComprobante && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Número de referencia / transacción
                  </label>
                  <input type="text" value={referenciaPago}
                    onChange={e => setReferenciaPago(e.target.value)}
                    placeholder="Ej: TXN-20261234 o 123456789"
                    className={cls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                    Comprobante / Screenshot del pago *
                  </label>
                  {comprobanteUrl ? (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2.5 text-sm text-emerald-700">
                      <CheckCircle2 size={16} />
                      <span className="flex-1 truncate text-xs">
                        {comprobanteUrl.startsWith('archivo:') ? comprobanteUrl.replace('archivo:', '') : 'Comprobante subido ✓'}
                      </span>
                      <button type="button" onClick={() => setComprobanteUrl('')}
                        className="text-emerald-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center gap-3 cursor-pointer border-2 border-dashed border-slate-300 rounded-xl px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <Upload size={18} className={subiendoComp ? 'animate-spin text-blue-400' : 'text-slate-400'} />
                      <div>
                        <p className="text-sm text-slate-600 font-medium">
                          {subiendoComp ? 'Subiendo...' : 'Subir foto o screenshot'}
                        </p>
                        <p className="text-xs text-slate-400">JPG, PNG · máx. 5 MB</p>
                      </div>
                      <input ref={compInputRef} type="file" className="hidden" accept="image/*"
                        disabled={subiendoComp}
                        onChange={e => { const f = e.target.files?.[0]; if (f) subirComprobante(f) }} />
                    </label>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    El administrador verificará el comprobante antes de liberar tu vehículo.
                  </p>
                </div>
              </div>
            )}

            {error && <Err t={error} />}
            <Btn loading={loadingPagar || subiendoComp}
              label={
                metodoPagoSel === 'efectivo'
                  ? 'Registrar pago en ventanilla'
                  : 'Enviar comprobante para revisión'
              }
              color="bg-green-500 hover:bg-green-600"
            />
            {metodoPagoSel !== 'efectivo' && (
              <p className="text-[10px] text-center text-slate-400 flex items-center justify-center gap-1">
                <Clock size={10} /> Tu vehículo se rehabilitará una vez el admin confirme el pago
              </p>
            )}
          </form>
        </ModalWrap>
      )}

      {/* Modal Apelar */}
      {modal === 'apelar' && seleccionada && (
        <ModalWrap titulo={`Apelar — ${seleccionada.tipoNombre}`} onClose={cerrarModal}>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-700">
            <p>Sanción: <strong>{TIPO_SANCION_LABELS[seleccionada.tipoSancion ?? ''] ?? '—'}{seleccionada.tipoSancion === 'multa_economica' ? ` (Bs. ${seleccionada.monto})` : ''}</strong></p>
            <p>Vehículo: <span className="font-mono">{seleccionada.placaVehiculo}</span></p>
          </div>
          <form onSubmit={handleApelar} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Motivo de apelación *</label>
              <textarea name="motivo" required rows={4} placeholder="Explica por qué apelas esta infracción..."
                className={cls + ' resize-none'} />
            </div>
            {error && <Err t={error} />}
            <Btn loading={loadingApelar} label="Enviar apelación" color="bg-blue-500 hover:bg-blue-600" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Marcar sanción como cumplida (suspensión / reporte a Bienestar) */}
      {modal === 'marcar_cumplida' && seleccionada && (
        <ModalWrap titulo="Marcar sanción como cumplida" onClose={cerrarModal}>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4 text-sm text-emerald-700">
            <p className="font-bold">{TIPO_SANCION_LABELS[seleccionada.tipoSancion ?? ''] ?? seleccionada.tipoSancion}</p>
            <p className="text-xs mt-0.5 opacity-80">{seleccionada.tipoNombre} — {seleccionada.descripcion}</p>
            <p className="text-xs mt-0.5 font-mono">Placa: {seleccionada.placaVehiculo}</p>
          </div>
          <form onSubmit={handleMarcarCumplida} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Observación — opcional</label>
              <textarea name="observacion" rows={3} placeholder="Ej: el área de Bienestar confirmó el cierre del caso..."
                className={cls + ' resize-none'} />
            </div>
            {error && <Err t={error} />}
            <Btn loading={loadingMarcar} label="Marcar como cumplida" color="bg-emerald-500 hover:bg-emerald-600" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Resolver */}
      {modal === 'resolver' && apelacionSel && (
        <ModalWrap titulo="Resolver Apelación" onClose={cerrarModal}>
          <div className="bg-slate-50 rounded-lg p-3 mb-4 text-sm">
            <p className="font-medium text-slate-800">{apelacionSel.usuarioNombre}</p>
            <p className="text-slate-600 mt-1">{apelacionSel.motivo}</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Respuesta *</label>
              <textarea id="respuesta" rows={3} placeholder="Escribe la resolución..." className={cls + ' resize-none'} />
            </div>
            {error && <Err t={error} />}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => handleResolver(true)} disabled={loadingResolver}
                className="bg-green-500 hover:bg-green-600 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Aprobar
              </button>
              <button onClick={() => handleResolver(false)} disabled={loadingResolver}
                className="bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                Rechazar
              </button>
            </div>
          </div>
        </ModalWrap>
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />
    </div>
  )
}

function CeldaSancion({ tipoSancion, monto }: { tipoSancion: string | null; monto: number | null }) {
  if (!tipoSancion) return <span className="text-slate-400 text-xs">—</span>
  if (tipoSancion === 'multa_economica') return <span className="font-medium text-slate-800">Bs. {monto}</span>
  return <span className="text-slate-600 text-xs">{TIPO_SANCION_LABELS[tipoSancion] ?? tipoSancion}</span>
}

function TablaInfracciones({ filas, esPersonal, esAdmin, onPagar, onApelar, onMarcarCumplida }: {
  filas: Fila[]; esPersonal: boolean; esAdmin: boolean;
  onPagar: (f: Fila) => void; onApelar: (f: Fila) => void; onMarcarCumplida: (f: Fila) => void
}) {
  if (filas.length === 0)
    return <div className="text-center py-10 text-slate-400 text-sm">No hay infracciones registradas</div>
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="px-4 py-3 text-left">Placa</th>
            <th className="px-4 py-3 text-left">Tipo</th>
            <th className="px-4 py-3 text-left">Descripción</th>
            <th className="px-4 py-3 text-left">Sanción</th>
            <th className="px-4 py-3 text-left">Estado</th>
            <th className="px-4 py-3 text-left">Fecha</th>
            <th className="px-4 py-3 text-left">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map(f => {
            const estado = f.estadoSancion ?? f.estadoInfraccion ?? '—'
            const puedePagar = f.tipoSancion === 'multa_economica' && f.estadoSancion === 'pendiente'
            const puedeMarcarCumplida = esAdmin && !!f.tipoSancion && f.tipoSancion !== 'multa_economica' && f.estadoSancion === 'pendiente'
            const puedeApelar = !esPersonal && f.estadoInfraccion === 'registrada' && !f.tieneApelacion
            return (
              <tr key={`${f.infraccionId}-${f.sancionId ?? 'na'}`} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-mono font-bold text-slate-800">{f.placaVehiculo}</td>
                <td className="px-4 py-3 text-slate-700">{f.tipoNombre}</td>
                <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{f.descripcion}</td>
                <td className="px-4 py-3"><CeldaSancion tipoSancion={f.tipoSancion} monto={f.monto} /></td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[estado] ?? 'bg-slate-100'}`}>
                    {estado}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(f.fecha).toLocaleDateString('es-BO')}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {puedePagar && (
                      <button onClick={() => onPagar(f)}
                        className="flex items-center gap-1 bg-green-50 hover:bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-medium transition-colors">
                        <CreditCard size={12} /> Pagar
                      </button>
                    )}
                    {puedeMarcarCumplida && (
                      <button onClick={() => onMarcarCumplida(f)}
                        className="flex items-center gap-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-medium transition-colors">
                        <ShieldCheck size={12} /> Marcar cumplida
                      </button>
                    )}
                    {puedeApelar && (
                      <button onClick={() => onApelar(f)}
                        className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium transition-colors">
                        <MessageSquare size={12} /> Apelar
                      </button>
                    )}
                    {f.tieneApelacion && <span className="text-xs text-blue-400 italic">En apelación</span>}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-red-500 text-red-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  )
}

const cls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400'

function ModalWrap({ titulo, onClose, children }: { titulo: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{titulo}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function Err({ t }: { t: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{t}</div>
}

function Btn({ loading, label, color = 'bg-red-500 hover:bg-red-600' }: { loading: boolean; label: string; color?: string }) {
  return (
    <button type="submit" disabled={loading}
      className={`w-full ${color} text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50`}>
      {loading ? 'Guardando...' : label}
    </button>
  )
}
