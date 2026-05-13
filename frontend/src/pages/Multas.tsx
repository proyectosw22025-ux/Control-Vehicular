import { useState, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { AlertTriangle, Plus, CreditCard, MessageSquare, CheckCircle, X, FileDown } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import {
  MULTAS_PENDIENTES_QUERY,
  MULTAS_VEHICULO_QUERY,
  TIPOS_MULTA_QUERY,
  APELACIONES_PENDIENTES_QUERY,
} from '../graphql/queries/multas'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import {
  REGISTRAR_MULTA_MUTATION,
  PAGAR_MULTA_MUTATION,
  APELAR_MULTA_MUTATION,
  RESOLVER_APELACION_MUTATION,
} from '../graphql/mutations/multas'

const ESTADO_BADGE: Record<string, string> = {
  pendiente: 'bg-orange-100 text-orange-700',
  pagada:    'bg-green-100 text-green-700',
  apelada:   'bg-blue-100 text-blue-700',
  cancelada: 'bg-slate-100 text-slate-500',
}

type Multa = {
  id: number; monto: number; descripcion: string; fecha: string; estado: string;
  tipo: { nombre: string }; placaVehiculo: string; registradoPorNombre: string; tieneApelacion: boolean
}
type Apelacion = {
  id: number; motivo: string; estado: string; respuesta: string; fecha: string; usuarioNombre: string
}

type Tab = 'pendientes' | 'todas' | 'apelaciones'
type Modal = 'registrar' | 'pagar' | 'apelar' | 'resolver' | null

export default function Multas() {
  const { usuario, esAdmin, esGuardia } = useAuth()
  const toast = useToast()
  const esPersonal = esAdmin || esGuardia
  const [tab, setTab] = useState<Tab>(esPersonal ? 'pendientes' : 'todas')
  const [modal, setModal] = useState<Modal>(null)
  const [seleccionada, setSeleccionada] = useState<Multa | null>(null)
  const [apelacionSel, setApelacionSel] = useState<Apelacion | null>(null)
  const [vehiculoFiltro, setVehiculoFiltro] = useState<number | null>(null)
  const [error, setError] = useState('')

  const { data: pendientesData, refetch: refetchPendientes } = useQuery(MULTAS_PENDIENTES_QUERY, {
    skip: !esPersonal,
  })
  // Solo vehículos activos — no 500 vehículos de toda la BD
  const { data: misVehiculosData } = useQuery(VEHICULOS_QUERY, {
    variables: {
      propietarioId: esPersonal ? undefined : usuario.id,
      estado: 'activo',
      porPagina: 100,
    },
    fetchPolicy: 'cache-and-network',
  })
  const { data: multasVehData, refetch: refetchVeh } = useQuery(MULTAS_VEHICULO_QUERY, {
    variables: { vehiculoId: vehiculoFiltro },
    skip: !vehiculoFiltro,
  })
  const { data: tiposData } = useQuery(TIPOS_MULTA_QUERY)
  const { data: apelacionesData, refetch: refetchApelaciones } = useQuery(APELACIONES_PENDIENTES_QUERY, {
    skip: !esAdmin,
  })

  const [registrarMulta, { loading: loadingRegistrar }] = useMutation(REGISTRAR_MULTA_MUTATION, {
    onCompleted(d) {
      cerrarModal(); refetchPendientes()
      toast.exito('Multa registrada', `${d.registrarMulta.placaVehiculo} sancionado`)
    },
    onError(e) { setError(e.message); toast.error('Error al registrar multa', e.message) },
  })
  const [pagarMulta, { loading: loadingPagar }] = useMutation(PAGAR_MULTA_MUTATION, {
    onCompleted() {
      cerrarModal(); refetchPendientes(); if (vehiculoFiltro) refetchVeh()
      toast.exito('Pago registrado', 'El vehículo ha sido rehabilitado si no tiene más multas')
    },
    onError(e) { setError(e.message); toast.error('Error al registrar pago', e.message) },
  })
  const [apelarMulta, { loading: loadingApelar }] = useMutation(APELAR_MULTA_MUTATION, {
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
        ? toast.exito('Apelación aprobada', 'La multa fue cancelada')
        : toast.alerta('Apelación rechazada', 'La multa vuelve a estado pendiente')
    },
    onError(e) { setError(e.message); toast.error('Error al resolver apelación', e.message) },
  })

  const misVehiculos = misVehiculosData?.vehiculos?.items ?? []
  const tipos = tiposData?.tiposMulta ?? []
  const multasPendientes: Multa[] = pendientesData?.multasPendientes ?? []
  const multasVehiculo: Multa[] = multasVehData?.multasVehiculo ?? []
  const apelaciones: Apelacion[] = apelacionesData?.apelacionesPendientes ?? []

  function cerrarModal() { setModal(null); setSeleccionada(null); setApelacionSel(null); setError('') }

  function handleRegistrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    const montoStr = f.get('montoOverride') as string
    registrarMulta({
      variables: {
        input: {
          vehiculoId:    parseInt(f.get('vehiculoId') as string),
          tipoId:        parseInt(f.get('tipoId') as string),
          descripcion:   (f.get('descripcion') as string).trim(),
          montoOverride: montoStr ? parseFloat(montoStr) : null,
        },
      },
    })
  }

  function handlePagar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    pagarMulta({
      variables: {
        input: {
          multaId:    seleccionada!.id,
          metodoPago: f.get('metodoPago') as string,
          comprobante:(f.get('comprobante') as string).trim(),
        },
      },
    })
  }

  function handleApelar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    apelarMulta({
      variables: {
        input: {
          multaId: seleccionada!.id,
          motivo:  (f.get('motivo') as string).trim(),
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

  return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-red-500 text-white p-2 rounded-xl"><AlertTriangle size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Multas</h1>
            <p className="text-slate-500 text-xs">
              {esPersonal ? 'Gestión de multas del sistema' : 'Multas de mis vehículos'}
            </p>
          </div>
        </div>
        {esPersonal && (
          <div className="flex gap-2">
            <button onClick={async () => {
              const t = localStorage.getItem('access_token') || ''
              const base = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
              const resp = await fetch(`${base}/api/pdf/multas/`, { headers: { Authorization: `Bearer ${t}` } })
              if (!resp.ok) { alert(`Error al generar PDF (${resp.status})`); return }
              const blob = await resp.blob()
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href = url; a.download = `multas_${new Date().toISOString().slice(0,10)}.pdf`; a.click(); URL.revokeObjectURL(url)
            }}
              className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-sm font-medium transition-colors">
              <FileDown size={15} /> PDF
            </button>
            <button onClick={() => setModal('registrar')}
              className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Plus size={16} /> Registrar Multa
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {esPersonal && (
          <TabBtn active={tab === 'pendientes'} onClick={() => setTab('pendientes')}
            label={`Pendientes${multasPendientes.length > 0 ? ` (${multasPendientes.length})` : ''}`} />
        )}
        <TabBtn active={tab === 'todas'} onClick={() => setTab('todas')} label="Por vehículo" />
        {esAdmin && (
          <TabBtn active={tab === 'apelaciones'} onClick={() => setTab('apelaciones')}
            label={`Apelaciones${apelaciones.length > 0 ? ` (${apelaciones.length})` : ''}`} />
        )}
      </div>

      {/* Pendientes */}
      {tab === 'pendientes' && esPersonal && (
        <TablaMultas multas={multasPendientes} esPersonal={esPersonal}
          onPagar={m => { setSeleccionada(m); setModal('pagar') }}
          onApelar={m => { setSeleccionada(m); setModal('apelar') }} />
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
            ? <TablaMultas multas={multasVehiculo} esPersonal={esPersonal}
                onPagar={m => { setSeleccionada(m); setModal('pagar') }}
                onApelar={m => { setSeleccionada(m); setModal('apelar') }} />
            : <div className="text-center py-10 text-slate-400 text-sm">Selecciona un vehículo para ver sus multas</div>
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
        <ModalWrap titulo="Registrar Multa" onClose={cerrarModal}>
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
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de multa *</label>
              <select name="tipoId" required className={cls}>
                <option value="">Seleccionar...</option>
                {tipos.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.nombre} — Bs. {t.montoBase}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Descripción *</label>
              <textarea name="descripcion" required rows={3} placeholder="Detalle de la infracción..."
                className={cls + ' resize-none'} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Monto personalizado (Bs.) — opcional</label>
              <input type="number" step="0.01" name="montoOverride" placeholder="Deja vacío para usar monto base" className={cls} />
            </div>
            {error && <Err t={error} />}
            <Btn loading={loadingRegistrar} label="Registrar multa" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Pagar */}
      {modal === 'pagar' && seleccionada && (
        <ModalWrap titulo={`Pagar Multa — Bs. ${seleccionada.monto}`} onClose={cerrarModal}>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 text-sm text-orange-700">
            <p className="font-medium">{seleccionada.tipo.nombre}</p>
            <p className="text-xs mt-1">{seleccionada.descripcion}</p>
            <p className="text-xs mt-1">Vehículo: <span className="font-mono">{seleccionada.placaVehiculo}</span></p>
          </div>
          <form onSubmit={handlePagar} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Método de pago *</label>
              <select name="metodoPago" required className={cls}>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Transferencia</option>
                <option value="qr_pago">QR de pago</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Número de comprobante</label>
              <input type="text" name="comprobante" placeholder="ej. REC-001234" className={cls} />
            </div>
            {error && <Err t={error} />}
            <Btn loading={loadingPagar} label="Confirmar pago" color="bg-green-500 hover:bg-green-600" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Apelar */}
      {modal === 'apelar' && seleccionada && (
        <ModalWrap titulo={`Apelar — ${seleccionada.tipo.nombre}`} onClose={cerrarModal}>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-700">
            <p>Monto: <strong>Bs. {seleccionada.monto}</strong></p>
            <p>Vehículo: <span className="font-mono">{seleccionada.placaVehiculo}</span></p>
          </div>
          <form onSubmit={handleApelar} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Motivo de apelación *</label>
              <textarea name="motivo" required rows={4} placeholder="Explica por qué apelas esta multa..."
                className={cls + ' resize-none'} />
            </div>
            {error && <Err t={error} />}
            <Btn loading={loadingApelar} label="Enviar apelación" color="bg-blue-500 hover:bg-blue-600" />
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

function TablaMultas({ multas, esPersonal, onPagar, onApelar }: {
  multas: Multa[]; esPersonal: boolean;
  onPagar: (m: Multa) => void; onApelar: (m: Multa) => void
}) {
  if (multas.length === 0)
    return <div className="text-center py-10 text-slate-400 text-sm">No hay multas registradas</div>
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
          <tr>
            <th className="px-4 py-3 text-left">Placa</th>
            <th className="px-4 py-3 text-left">Tipo</th>
            <th className="px-4 py-3 text-left">Descripción</th>
            <th className="px-4 py-3 text-left">Monto</th>
            <th className="px-4 py-3 text-left">Estado</th>
            <th className="px-4 py-3 text-left">Fecha</th>
            <th className="px-4 py-3 text-left">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {multas.map(m => (
            <tr key={m.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 font-mono font-bold text-slate-800">{m.placaVehiculo}</td>
              <td className="px-4 py-3 text-slate-700">{m.tipo.nombre}</td>
              <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{m.descripcion}</td>
              <td className="px-4 py-3 font-medium text-slate-800">Bs. {m.monto}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[m.estado] ?? 'bg-slate-100'}`}>
                  {m.estado}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">{new Date(m.fecha).toLocaleDateString('es-BO')}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  {m.estado === 'pendiente' && (
                    <button onClick={() => onPagar(m)}
                      className="flex items-center gap-1 bg-green-50 hover:bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-medium transition-colors">
                      <CreditCard size={12} /> Pagar
                    </button>
                  )}
                  {m.estado === 'pendiente' && !m.tieneApelacion && !esPersonal && (
                    <button onClick={() => onApelar(m)}
                      className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium transition-colors">
                      <MessageSquare size={12} /> Apelar
                    </button>
                  )}
                  {m.tieneApelacion && <span className="text-xs text-blue-400 italic">En apelación</span>}
                </div>
              </td>
            </tr>
          ))}
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
