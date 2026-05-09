import { useState, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { Car, Plus, RefreshCw, FileText, Edit, QrCode, X, AlertTriangle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { QrImage } from '../components/QrImage'
import { VEHICULOS_QUERY, TIPOS_VEHICULO_QUERY } from '../graphql/queries/vehiculos'
import {
  REGISTRAR_VEHICULO_MUTATION,
  ACTUALIZAR_VEHICULO_MUTATION,
  REGENERAR_QR_MUTATION,
  AGREGAR_DOCUMENTO_MUTATION,
} from '../graphql/mutations/vehiculos'
import { USUARIOS_QUERY } from '../graphql/queries/usuarios'

const ESTADO_BADGE: Record<string, string> = {
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

type Vehiculo = {
  id: number; placa: string; marca: string; modelo: string; anio: number;
  color: string; estado: string; codigoQr: string; createdAt: string;
  tipo: { id: number; nombre: string }; propietarioNombre: string;
  documentos: { id: number; tipoDoc: string; numero: string; fechaVencimiento: string }[]
}

type Modal = 'registrar' | 'editar' | 'documento' | 'qr' | null

export default function Vehiculos() {
  const { usuario, esAdmin } = useAuth()
  const [modal, setModal] = useState<Modal>(null)
  const [seleccionado, setSeleccionado] = useState<Vehiculo | null>(null)
  const [confirmarRegen, setConfirmarRegen] = useState(false)
  const [error, setError] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')

  const propietarioId = esAdmin ? undefined : usuario.id

  const { data, loading, refetch } = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId },
    fetchPolicy: 'cache-and-network',
  })
  const { data: tiposData } = useQuery(TIPOS_VEHICULO_QUERY)
  const { data: usuariosData } = useQuery(USUARIOS_QUERY, { skip: !esAdmin })

  const [registrarVehiculo, { loading: loadingRegistrar }] = useMutation(REGISTRAR_VEHICULO_MUTATION, {
    onCompleted() { cerrarModal(); refetch() },
    onError(e) { setError(e.message) },
  })
  const [actualizarVehiculo, { loading: loadingActualizar }] = useMutation(ACTUALIZAR_VEHICULO_MUTATION, {
    onCompleted() { cerrarModal(); refetch() },
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

  const vehiculos: Vehiculo[] = data?.vehiculos ?? []
  const tipos = tiposData?.tiposVehiculo ?? []
  const usuarios = usuariosData?.usuarios ?? []

  const vehiculosFiltrados = filtroEstado
    ? vehiculos.filter(v => v.estado === filtroEstado)
    : vehiculos

  function cerrarModal() { setModal(null); setSeleccionado(null); setError(''); setConfirmarRegen(false) }

  function abrirQr(v: Vehiculo) { setSeleccionado(v); setModal('qr') }
  function abrirEditar(v: Vehiculo) { setSeleccionado(v); setModal('editar') }
  function abrirDocumento(v: Vehiculo) { setSeleccionado(v); setModal('documento') }

  function handleRegistrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    registrarVehiculo({
      variables: {
        input: {
          placa:        (f.get('placa') as string).trim().toUpperCase(),
          tipoId:       parseInt(f.get('tipoId') as string),
          propietarioId:parseInt(f.get('propietarioId') as string),
          marca:        (f.get('marca') as string).trim(),
          modelo:       (f.get('modelo') as string).trim(),
          anio:         parseInt(f.get('anio') as string),
          color:        (f.get('color') as string).trim(),
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
          marca:   (f.get('marca') as string).trim() || null,
          modelo:  (f.get('modelo') as string).trim() || null,
          anio:    parseInt(f.get('anio') as string) || null,
          color:   (f.get('color') as string).trim() || null,
          estado:  (f.get('estado') as string) || null,
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
          vehiculoId:      seleccionado!.id,
          tipoDoc:         f.get('tipoDoc') as string,
          numero:          (f.get('numero') as string).trim(),
          fechaVencimiento:f.get('fechaVencimiento') as string,
        },
      },
    })
  }

  return (
    <div className="p-8">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 text-white p-2 rounded-xl">
            <Car size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Vehículos</h1>
            <p className="text-slate-500 text-xs">
              {esAdmin ? 'Gestión completa de vehículos' : 'Mis vehículos registrados'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filtroEstado}
            onChange={e => setFiltroEstado(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <option value="">Todos los estados</option>
            <option value="activo">Activo</option>
            <option value="inactivo">Inactivo</option>
            <option value="sancionado">Sancionado</option>
          </select>
          {esAdmin && (
            <button
              onClick={() => setModal('registrar')}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus size={16} /> Registrar Vehículo
            </button>
          )}
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Cargando vehículos...</div>
      ) : vehiculosFiltrados.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Car size={40} className="mx-auto mb-2 opacity-30" />
          <p>No hay vehículos registrados</p>
          {!esAdmin && <p className="text-xs mt-1">Solicita al administrador que registre tu vehículo</p>}
        </div>
      ) : (
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
              {vehiculosFiltrados.map(v => (
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
                      <button
                        onClick={() => abrirQr(v)}
                        title="Ver QR"
                        className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      >
                        <QrCode size={15} />
                      </button>
                      {esAdmin && (
                        <>
                          <button
                            onClick={() => abrirEditar(v)}
                            title="Editar"
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit size={15} />
                          </button>
                          <button
                            onClick={() => abrirDocumento(v)}
                            title="Documentos"
                            className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                          >
                            <FileText size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Registrar */}
      {modal === 'registrar' && (
        <ModalWrapper titulo="Registrar Vehículo" onClose={cerrarModal}>
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
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Propietario *</label>
              <select name="propietarioId" required className={inputCls}>
                <option value="">Seleccionar usuario...</option>
                {usuarios.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.nombreCompleto} — {u.ci}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Marca *" name="marca" placeholder="Toyota" />
              <Campo label="Modelo *" name="modelo" placeholder="Corolla" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Año *" name="anio" type="number" placeholder="2020" />
              <Campo label="Color *" name="color" placeholder="Blanco" />
            </div>
            {error && <MsgError texto={error} />}
            <BtnSubmit loading={loadingRegistrar} label="Registrar" />
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

      {/* Modal QR */}
      {modal === 'qr' && seleccionado && (
        <ModalWrapper titulo={`Código QR — ${seleccionado.placa}`} onClose={cerrarModal}>
          <div className="flex flex-col items-center gap-4">

            {/* Info del vehículo */}
            <div className="w-full bg-slate-50 rounded-xl px-4 py-3 text-center">
              <p className="font-mono font-bold text-slate-800 text-lg">{seleccionado.placa}</p>
              <p className="text-slate-500 text-sm">{seleccionado.marca} {seleccionado.modelo} · {seleccionado.anio}</p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[seleccionado.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                {seleccionado.estado}
              </span>
            </div>

            {/* QR real */}
            <QrImage
              value={seleccionado.codigoQr}
              size={220}
              label={`QR permanente — ${seleccionado.placa}`}
              showDownload
              downloadName={`QR-${seleccionado.placa}`}
            />

            {/* Alerta de estado sancionado */}
            {seleccionado.estado === 'sancionado' && (
              <div className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-red-700 text-xs">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Este vehículo está sancionado. El QR puede ser rechazado en los puntos de acceso.
              </div>
            )}

            {/* Regenerar QR */}
            {!confirmarRegen ? (
              <button
                onClick={() => setConfirmarRegen(true)}
                className="flex items-center gap-2 text-sm text-orange-600 hover:text-orange-800 border border-orange-200 hover:border-orange-400 px-4 py-2 rounded-xl transition-colors"
              >
                <RefreshCw size={14} /> Regenerar QR
              </button>
            ) : (
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-amber-800 text-sm font-medium mb-1">¿Confirmar regeneración?</p>
                <p className="text-amber-700 text-xs mb-3">
                  El código QR actual quedará <strong>invalidado permanentemente</strong>. El vehículo necesitará este nuevo QR para acceder.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      regenerarQr({ variables: { vehiculoId: seleccionado.id } })
                      setConfirmarRegen(false)
                    }}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm py-2 rounded-lg transition-colors"
                  >
                    Sí, regenerar
                  </button>
                  <button
                    onClick={() => setConfirmarRegen(false)}
                    className="flex-1 border border-slate-300 text-slate-600 text-sm py-2 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {error && <MsgError texto={error} />}
          </div>
        </ModalWrapper>
      )}
    </div>
  )
}

// ── Componentes auxiliares ──────────────────────────────

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400'

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
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function MsgError({ texto }: { texto: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
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
