import { useState, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useNavigate } from 'react-router-dom'
import {
  Car, Plus, RefreshCw, FileText, Edit, QrCode, X,
  AlertTriangle, Search, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Clock, History,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { QrDinamico } from '../components/QrDinamico'
import { VEHICULOS_QUERY, VEHICULOS_PENDIENTES_QUERY, TIPOS_VEHICULO_QUERY } from '../graphql/queries/vehiculos'
import {
  REGISTRAR_VEHICULO_MUTATION,
  ACTUALIZAR_VEHICULO_MUTATION,
  REGENERAR_QR_MUTATION,
  AGREGAR_DOCUMENTO_MUTATION,
  APROBAR_VEHICULO_MUTATION,
  RECHAZAR_VEHICULO_MUTATION,
} from '../graphql/mutations/vehiculos'
import { USUARIOS_QUERY } from '../graphql/queries/usuarios'

const ESTADO_BADGE: Record<string, string> = {
  pendiente:  'bg-amber-100 text-amber-700',
  activo:     'bg-green-100 text-green-700',
  inactivo:   'bg-slate-100 text-slate-600',
  sancionado: 'bg-red-100 text-red-700',
}

const TIPO_DOC_LABELS: Record<string, string> = {
  soat:        'SOAT',
  tecnica:     'Técnica',
  circulacion: 'Circulación',
  otro:        'Otro',
}

type Documento = { id: number; tipoDoc: string; numero: string; fechaVencimiento: string }
type Vehiculo = {
  id: number; placa: string; marca: string; modelo: string; anio: number;
  color: string; estado: string; codigoQr: string; createdAt: string;
  tipo: { id: number; nombre: string }; propietarioNombre: string;
  documentos: Documento[]
}

type Tab   = 'lista' | 'pendientes'
type Modal = 'registrar' | 'editar' | 'documento' | 'qr' | 'rechazar' | null

const POR_PAGINA = 15

export default function Vehiculos() {
  const { usuario, esAdmin } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab]                     = useState<Tab>('lista')
  const [modal, setModal]                 = useState<Modal>(null)
  const [seleccionado, setSeleccionado]   = useState<Vehiculo | null>(null)
  const [confirmarRegen, setConfirmarRegen] = useState(false)
  const [error, setError]                 = useState('')
  const [filtroEstado, setFiltroEstado]   = useState('')
  const [busqueda, setBusqueda]           = useState('')
  const [pagina, setPagina]               = useState(1)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  const propietarioId = esAdmin ? undefined : usuario.id

  const { data, loading, refetch } = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId, buscar: busqueda || undefined, estado: filtroEstado || undefined, pagina, porPagina: POR_PAGINA },
    fetchPolicy: 'cache-and-network',
  })
  const { data: pendientesData, refetch: refetchPendientes } = useQuery(VEHICULOS_PENDIENTES_QUERY, {
    skip: !esAdmin,
    fetchPolicy: 'cache-and-network',
  })
  const { data: tiposData }    = useQuery(TIPOS_VEHICULO_QUERY)
  const { data: usuariosData } = useQuery(USUARIOS_QUERY, { skip: !esAdmin })

  const [registrarVehiculo, { loading: loadingRegistrar }] = useMutation(REGISTRAR_VEHICULO_MUTATION, {
    onCompleted() { cerrarModal(); refetch(); refetchPendientes() },
    onError(e) { setError(e.message) },
  })
  const [actualizarVehiculo, { loading: loadingActualizar }] = useMutation(ACTUALIZAR_VEHICULO_MUTATION, {
    onCompleted() { cerrarModal(); refetch() },
    onError(e) { setError(e.message) },
  })
  const [aprobarVehiculo, { loading: loadingAprobar }] = useMutation(APROBAR_VEHICULO_MUTATION, {
    onCompleted() { refetch(); refetchPendientes() },
    onError(e) { setError(e.message) },
  })
  const [rechazarVehiculo, { loading: loadingRechazar }] = useMutation(RECHAZAR_VEHICULO_MUTATION, {
    onCompleted() { cerrarModal(); refetch(); refetchPendientes() },
    onError(e) { setError(e.message) },
  })
  const [regenerarQr] = useMutation(REGENERAR_QR_MUTATION, {
    onCompleted(d) {
      setSeleccionado(prev => prev ? { ...prev, codigoQr: d.regenerarQr.codigoQr } : prev)
      refetch()
    },
    onError(e) { setError(e.message) },
  })
  const [agregarDocumento, { loading: loadingDoc }] = useMutation(AGREGAR_DOCUMENTO_MUTATION, {
    onCompleted() { cerrarModal(); refetch() },
    onError(e) { setError(e.message) },
  })

  const page      = data?.vehiculos
  const vehiculos: Vehiculo[] = page?.items ?? []
  const total: number         = page?.total ?? 0
  const totalPaginas: number  = page?.totalPaginas ?? 1
  const tipos    = tiposData?.tiposVehiculo ?? []
  const usuarios = usuariosData?.usuarios ?? []
  const pendientes: Vehiculo[] = pendientesData?.vehiculosPendientes ?? []

  function cerrarModal() {
    setModal(null); setSeleccionado(null); setError(''); setConfirmarRegen(false); setMotivoRechazo('')
  }
  function abrirQr(v: Vehiculo)       { setSeleccionado(v); setModal('qr') }
  function abrirEditar(v: Vehiculo)   { setSeleccionado(v); setModal('editar') }
  function abrirDocumento(v: Vehiculo){ setSeleccionado(v); setModal('documento') }
  function abrirRechazar(v: Vehiculo) { setSeleccionado(v); setModal('rechazar') }

  function cambioBusqueda(val: string) { setBusqueda(val); setPagina(1) }
  function cambioEstado(val: string)   { setFiltroEstado(val); setPagina(1) }

  function handleRegistrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    const placa = (f.get('placa') as string).trim().toUpperCase()
    if (!/^[A-Z0-9\-]{3,10}$/.test(placa)) {
      setError('La placa debe tener entre 3 y 10 caracteres alfanuméricos'); return
    }
    const propietarioId = esAdmin
      ? parseInt(f.get('propietarioId') as string)
      : usuario.id
    registrarVehiculo({
      variables: {
        input: {
          placa,
          tipoId: parseInt(f.get('tipoId') as string),
          propietarioId,
          marca:  (f.get('marca') as string).trim(),
          modelo: (f.get('modelo') as string).trim(),
          anio:   parseInt(f.get('anio') as string),
          color:  (f.get('color') as string).trim(),
        },
      },
    })
  }

  function handleActualizar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    actualizarVehiculo({
      variables: {
        id: seleccionado!.id,
        input: {
          marca:  (f.get('marca') as string).trim() || null,
          modelo: (f.get('modelo') as string).trim() || null,
          anio:   parseInt(f.get('anio') as string) || null,
          color:  (f.get('color') as string).trim() || null,
          estado: (f.get('estado') as string) || null,
        },
      },
    })
  }

  function handleDocumento(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    agregarDocumento({
      variables: {
        input: {
          vehiculoId:       seleccionado!.id,
          tipoDoc:          f.get('tipoDoc') as string,
          numero:           (f.get('numero') as string).trim(),
          fechaVencimiento: f.get('fechaVencimiento') as string,
        },
      },
    })
  }

  function handleRechazar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    if (!motivoRechazo.trim()) { setError('Debes indicar el motivo del rechazo'); return }
    rechazarVehiculo({ variables: { vehiculoId: seleccionado!.id, motivo: motivoRechazo.trim() } })
  }

  return (
    <div className="p-8">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 text-white p-2 rounded-xl"><Car size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Vehículos</h1>
            <p className="text-slate-500 text-xs">
              {esAdmin ? 'Gestión completa de vehículos' : 'Mis vehículos registrados'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setModal('registrar')}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Registrar Vehículo
        </button>
      </div>

      {/* Tabs (solo admin) */}
      {esAdmin && (
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          <TabBtn active={tab === 'lista'} onClick={() => setTab('lista')}>
            Lista de vehículos
          </TabBtn>
          <TabBtn active={tab === 'pendientes'} onClick={() => setTab('pendientes')}>
            <span className="flex items-center gap-1.5">
              <Clock size={13} />
              Pendientes de aprobación
              {pendientes.length > 0 && (
                <span className="bg-amber-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full font-bold">
                  {pendientes.length > 9 ? '9+' : pendientes.length}
                </span>
              )}
            </span>
          </TabBtn>
        </div>
      )}

      {/* ── TAB: LISTA ── */}
      {tab === 'lista' && (
        <>
          {/* Barra de búsqueda y filtros */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por placa, marca, modelo, propietario..."
                value={busqueda}
                onChange={e => cambioBusqueda(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <select
              value={filtroEstado}
              onChange={e => cambioEstado(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="sancionado">Sancionado</option>
            </select>
            {(busqueda || filtroEstado) && (
              <button
                onClick={() => { cambioBusqueda(''); cambioEstado('') }}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Limpiar
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl h-14 animate-pulse" />
              ))}
            </div>
          ) : vehiculos.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Car size={40} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-slate-600">
                {busqueda || filtroEstado ? 'Sin resultados para esta búsqueda' : 'No hay vehículos registrados'}
              </p>
              {!esAdmin && !busqueda && (
                <p className="text-xs mt-1">Usa el botón "Registrar Vehículo" para agregar tu primer vehículo</p>
              )}
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Placa</th>
                      <th className="px-4 py-3 text-left">Tipo</th>
                      <th className="px-4 py-3 text-left">Marca / Modelo</th>
                      <th className="px-4 py-3 text-left">Año</th>
                      <th className="px-4 py-3 text-left">Color</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      {esAdmin && <th className="px-4 py-3 text-left">Propietario</th>}
                      <th className="px-4 py-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vehiculos.map(v => (
                      <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono font-bold text-slate-800">{v.placa}</td>
                        <td className="px-4 py-3 text-slate-600">{v.tipo?.nombre}</td>
                        <td className="px-4 py-3 text-slate-700">{v.marca} {v.modelo}</td>
                        <td className="px-4 py-3 text-slate-600">{v.anio}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize">{v.color}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[v.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                            {v.estado}
                          </span>
                        </td>
                        {esAdmin && <td className="px-4 py-3 text-slate-600">{v.propietarioNombre}</td>}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => abrirQr(v)} title="Ver QR"
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                              <QrCode size={15} />
                            </button>
                            <button onClick={() => navigate(`/vehiculos/${v.id}/historial`)} title="Ver historial"
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                              <History size={15} />
                            </button>
                            {esAdmin && (
                              <>
                                <button onClick={() => abrirEditar(v)} title="Editar"
                                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <Edit size={15} />
                                </button>
                                    <button onClick={() => abrirDocumento(v)} title="Documentos"
                                  className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
                                  <FileText size={15} />
                                </button>
                              </>
                            )}
                            {/* Propietario también puede subir sus documentos */}
                            {!esAdmin && v.propietarioNombre && (
                              <button onClick={() => abrirDocumento(v)} title="Mis documentos"
                                className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
                                <FileText size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              {totalPaginas > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
                  <span>{total} vehículo{total !== 1 ? 's' : ''} · Página {pagina} de {totalPaginas}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPagina(p => Math.max(1, p - 1))}
                      disabled={pagina === 1}
                      className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPaginas || Math.abs(p - pagina) <= 1)
                      .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…')
                        acc.push(p); return acc
                      }, [])
                      .map((p, i) =>
                        p === '…' ? (
                          <span key={`e${i}`} className="px-2">…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setPagina(p as number)}
                            className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                              pagina === p
                                ? 'bg-emerald-500 text-white'
                                : 'hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                    <button
                      onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                      disabled={pagina === totalPaginas}
                      className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
              {totalPaginas === 1 && total > 0 && (
                <p className="text-center text-xs text-slate-400 mt-3">{total} vehículo{total !== 1 ? 's' : ''}</p>
              )}
            </>
          )}
        </>
      )}

      {/* ── TAB: PENDIENTES ── */}
      {tab === 'pendientes' && esAdmin && (
        <>
          {pendientes.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <CheckCircle size={40} className="mx-auto mb-2 text-emerald-400 opacity-60" />
              <p className="font-medium text-slate-600">No hay vehículos pendientes</p>
              <p className="text-xs mt-1">Todos los vehículos han sido revisados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendientes.map(v => (
                <div key={v.id} className="bg-white rounded-xl shadow-sm border border-amber-200 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono font-bold text-slate-800 text-lg">{v.placa}</span>
                        <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Clock size={10} /> Pendiente
                        </span>
                      </div>
                      <p className="text-slate-600 text-sm">{v.marca} {v.modelo} · {v.anio} · <span className="capitalize">{v.color}</span></p>
                      <p className="text-slate-500 text-xs mt-0.5">Tipo: {v.tipo?.nombre} · Propietario: {v.propietarioNombre}</p>
                      <p className="text-slate-400 text-xs mt-0.5">
                        Registrado: {new Date(v.createdAt).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                      {v.documentos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {v.documentos.map(d => (
                            <span key={d.id} className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                              {TIPO_DOC_LABELS[d.tipoDoc]} · vence {d.fechaVencimiento}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => aprobarVehiculo({ variables: { vehiculoId: v.id } })}
                        disabled={loadingAprobar}
                        className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium"
                      >
                        <CheckCircle size={15} /> Aprobar
                      </button>
                      <button
                        onClick={() => abrirRechazar(v)}
                        className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm px-3 py-2 rounded-lg transition-colors font-medium border border-red-200"
                      >
                        <XCircle size={15} /> Rechazar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── MODALES ── */}

      {/* Modal Registrar */}
      {modal === 'registrar' && (
        <ModalWrapper titulo="Registrar Vehículo" onClose={cerrarModal}>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            El vehículo quedará en estado <strong>Pendiente</strong> hasta que sea aprobado.
          </p>
          <form onSubmit={handleRegistrar} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Placa *" name="placa" placeholder="ABC-123" />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
                <select name="tipoId" required className={inputCls}>
                  <option value="">Seleccionar...</option>
                  {tipos.map((t: any) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </div>
            </div>
            {esAdmin ? (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Propietario *</label>
                <select name="propietarioId" required className={inputCls}>
                  <option value="">Seleccionar usuario...</option>
                  {usuarios.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.nombreCompleto} — {u.ci}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600">
                Propietario: <strong>{usuario.nombreCompleto}</strong> (tú)
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Marca *" name="marca" placeholder="Toyota" />
              <Campo label="Modelo *" name="modelo" placeholder="Corolla" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Año *" name="anio" type="number" placeholder="2020" />
              <Campo label="Color *" name="color" placeholder="Blanco" />
            </div>
            {error && <MsgError texto={error} />}
            <BtnSubmit loading={loadingRegistrar} label="Registrar vehículo" />
          </form>
        </ModalWrapper>
      )}

      {/* Modal Rechazar */}
      {modal === 'rechazar' && seleccionado && (
        <ModalWrapper titulo={`Rechazar — ${seleccionado.placa}`} onClose={cerrarModal}>
          <form onSubmit={handleRechazar} className="space-y-3">
            <p className="text-sm text-slate-600">
              Indica el motivo del rechazo. El propietario recibirá una notificación.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Motivo *</label>
              <textarea
                value={motivoRechazo}
                onChange={e => setMotivoRechazo(e.target.value)}
                rows={3}
                placeholder="Ej: Documentación incompleta, placa ilegible..."
                className={`${inputCls} resize-none`}
              />
            </div>
            {error && <MsgError texto={error} />}
            <button
              type="submit"
              disabled={loadingRechazar}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loadingRechazar ? 'Rechazando...' : 'Confirmar rechazo'}
            </button>
          </form>
        </ModalWrapper>
      )}

      {/* Modal Editar */}
      {modal === 'editar' && seleccionado && (
        <ModalWrapper titulo={`Editar — ${seleccionado.placa}`} onClose={cerrarModal}>
          <form onSubmit={handleActualizar} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Marca" name="marca" defaultValue={seleccionado.marca} />
              <Campo label="Modelo" name="modelo" defaultValue={seleccionado.modelo} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Año" name="anio" type="number" defaultValue={String(seleccionado.anio)} />
              <Campo label="Color" name="color" defaultValue={seleccionado.color} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Estado</label>
              <select name="estado" defaultValue={seleccionado.estado} className={inputCls}>
                <option value="pendiente">Pendiente de aprobación</option>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="sancionado">Sancionado</option>
              </select>
            </div>
            {error && <MsgError texto={error} />}
            <BtnSubmit loading={loadingActualizar} label="Guardar cambios" />
          </form>
        </ModalWrapper>
      )}

      {/* Modal Documento */}
      {modal === 'documento' && seleccionado && (
        <ModalWrapper titulo={`Documentos — ${seleccionado.placa}`} onClose={cerrarModal}>
          {seleccionado.documentos.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-medium text-slate-500 mb-2">Documentos registrados</p>
              <div className="space-y-1">
                {seleccionado.documentos.map(d => (
                  <div key={d.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium text-slate-700">{TIPO_DOC_LABELS[d.tipoDoc] ?? d.tipoDoc}</span>
                    <span className="text-slate-500">{d.numero}</span>
                    <span className="text-slate-400 text-xs">Vence: {d.fechaVencimiento}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-200 my-4" />
            </div>
          )}
          <p className="text-xs font-medium text-slate-500 mb-3">Agregar documento</p>
          <form onSubmit={handleDocumento} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
              <select name="tipoDoc" required className={inputCls}>
                <option value="soat">SOAT</option>
                <option value="tecnica">Revisión Técnica</option>
                <option value="circulacion">Permiso de Circulación</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <Campo label="Número de documento *" name="numero" placeholder="P-12345" />
            <Campo label="Fecha de vencimiento *" name="fechaVencimiento" type="date" />
            {error && <MsgError texto={error} />}
            <BtnSubmit loading={loadingDoc} label="Agregar documento" />
          </form>
        </ModalWrapper>
      )}

      {/* Modal QR Dinámico */}
      {modal === 'qr' && seleccionado && (
        <ModalWrapper titulo={`Código QR — ${seleccionado.placa}`} onClose={cerrarModal}>
          <div className="flex flex-col items-center gap-4">

            {seleccionado.estado === 'pendiente' && (
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2 text-amber-700 text-xs">
                <Clock size={14} className="shrink-0 mt-0.5" />
                Vehículo <strong>pendiente de aprobación</strong>. El QR no será aceptado en portería hasta que un administrador lo apruebe.
              </div>
            )}

            {seleccionado.estado === 'sancionado' && (
              <div className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-red-700 text-xs">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Vehículo <strong>sancionado</strong>. El QR será rechazado hasta regularizar todas las multas pendientes.
              </div>
            )}

            {seleccionado.estado === 'activo' && (
              <QrDinamico vehiculoId={seleccionado.id} placa={seleccionado.placa} />
            )}

            {seleccionado.estado === 'inactivo' && (
              <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center text-slate-500 text-sm">
                Vehículo inactivo. Contacta a la administración para reactivarlo.
              </div>
            )}

            {/* Botón de emergencia: invalidar secret si hubo compromiso */}
            {seleccionado.estado === 'activo' && (
              !confirmarRegen ? (
                <button
                  onClick={() => setConfirmarRegen(true)}
                  className="flex items-center gap-2 text-xs text-slate-400 hover:text-orange-600 border border-slate-200 hover:border-orange-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw size={12} /> Invalidar QR por seguridad
                </button>
              ) : (
                <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-amber-800 text-sm font-medium mb-1">¿Invalidar QR actual?</p>
                  <p className="text-amber-700 text-xs mb-3">
                    Úsalo solo si crees que alguien tuvo acceso a tu pantalla en el momento exacto del código.
                    Se generará un nuevo secreto — los códigos anteriores dejarán de funcionar.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { regenerarQr({ variables: { vehiculoId: seleccionado.id } }); setConfirmarRegen(false) }}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm py-2 rounded-lg transition-colors"
                    >
                      Sí, invalidar
                    </button>
                    <button onClick={() => setConfirmarRegen(false)}
                      className="flex-1 border border-slate-300 text-slate-600 text-sm py-2 rounded-lg hover:bg-slate-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              )
            )}
            {error && <MsgError texto={error} />}
          </div>
        </ModalWrapper>
      )}
    </div>
  )
}

// ── Componentes auxiliares ────────────────────────────────────────

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400'

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-emerald-500 text-emerald-600'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function Campo({ label, name, type = 'text', placeholder = '', defaultValue = '' }: {
  label: string; name: string; type?: string; placeholder?: string; defaultValue?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type} name={name} placeholder={placeholder} defaultValue={defaultValue}
        className={inputCls}
      />
    </div>
  )
}

function ModalWrapper({ titulo, onClose, children }: {
  titulo: string; onClose: () => void; children: React.ReactNode
}) {
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

function MsgError({ texto }: { texto: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-start gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      {texto}
    </div>
  )
}

function BtnSubmit({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit" disabled={loading}
      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
    >
      {loading ? 'Guardando...' : label}
    </button>
  )
}
