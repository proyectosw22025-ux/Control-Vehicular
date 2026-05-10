import { useState, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { ParkingSquare, Plus, MapPin, Car, Clock, X } from 'lucide-react'
import {
  ZONAS_QUERY,
  ESPACIOS_POR_ZONA_QUERY,
  CATEGORIAS_ESPACIO_QUERY,
  HISTORIAL_SESIONES_QUERY,
} from '../graphql/queries/parqueos'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import {
  CREAR_ZONA_MUTATION,
  CREAR_ESPACIO_MUTATION,
  INICIAR_SESION_MUTATION,
  CERRAR_SESION_MUTATION,
} from '../graphql/mutations/parqueos'
import { useAuth } from '../hooks/useAuth'

const ESTADO_ESPACIO_COLOR: Record<string, string> = {
  disponible:       'bg-green-100 text-green-700 border-green-200',
  ocupado:          'bg-red-100 text-red-700 border-red-200',
  reservado:        'bg-blue-100 text-blue-700 border-blue-200',
  'fuera de servicio': 'bg-slate-100 text-slate-500 border-slate-200',
}

type Tab = 'zonas' | 'espacios' | 'sesion'

export default function Parqueos() {
  const { esAdmin, esGuardia } = useAuth()
  const esPersonal = esAdmin || esGuardia
  const [tab, setTab] = useState<Tab>('zonas')
  const [zonaSelId, setZonaSelId] = useState<number | null>(null)
  const [vehiculoHistId, setVehiculoHistId] = useState<number | null>(null)
  const [modal, setModal] = useState<'zona' | 'espacio' | 'sesion' | null>(null)
  const [error, setError] = useState('')

  const { data: zonasData, refetch: refetchZonas } = useQuery(ZONAS_QUERY, {
    variables: { soloActivas: false },
    fetchPolicy: 'cache-and-network',
  })
  const { data: espaciosData, refetch: refetchEspacios } = useQuery(ESPACIOS_POR_ZONA_QUERY, {
    variables: { zonaId: zonaSelId },
    skip: !zonaSelId,
  })
  const { data: categoriasData } = useQuery(CATEGORIAS_ESPACIO_QUERY)
  const { data: vehiculosData } = useQuery(VEHICULOS_QUERY, { variables: { porPagina: 500 } })
  const { data: historialData } = useQuery(HISTORIAL_SESIONES_QUERY, {
    variables: { vehiculoId: vehiculoHistId, limite: 15 },
    skip: !vehiculoHistId,
  })

  const [crearZona, { loading: loadingZona }] = useMutation(CREAR_ZONA_MUTATION, {
    onCompleted() { setModal(null); setError(''); refetchZonas() },
    onError(e) { setError(e.message) },
  })
  const [crearEspacio, { loading: loadingEspacio }] = useMutation(CREAR_ESPACIO_MUTATION, {
    onCompleted() { setModal(null); setError(''); if (zonaSelId) refetchEspacios() },
    onError(e) { setError(e.message) },
  })
  const [iniciarSesion, { loading: loadingIniciar }] = useMutation(INICIAR_SESION_MUTATION, {
    onCompleted() { setModal(null); setError(''); if (zonaSelId) refetchEspacios() },
    onError(e) { setError(e.message) },
  })
  const [cerrarSesion] = useMutation(CERRAR_SESION_MUTATION, {
    onCompleted() { if (zonaSelId) refetchEspacios() },
    onError(e) { alert(e.message) },
  })

  const zonas = zonasData?.zonas ?? []
  const espacios = espaciosData?.espaciosPorZona ?? []
  const categorias = categoriasData?.categoriasEspacio ?? []
  const vehiculos = vehiculosData?.vehiculos?.items ?? []
  const historial = historialData?.historialSesiones ?? []
  const zonaActual = zonas.find((z: any) => z.id === zonaSelId)

  function handleCrearZona(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    crearZona({
      variables: {
        input: {
          nombre:         (f.get('nombre') as string).trim(),
          descripcion:    (f.get('descripcion') as string).trim(),
          ubicacion:      (f.get('ubicacion') as string).trim(),
          capacidadTotal: parseInt(f.get('capacidadTotal') as string),
        },
      },
    })
  }

  function handleCrearEspacio(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    crearEspacio({
      variables: {
        input: {
          zonaId:              parseInt(f.get('zonaId') as string),
          categoriaId:         parseInt(f.get('categoriaId') as string),
          numero:              (f.get('numero') as string).trim(),
          ubicacionReferencia: (f.get('ubicacionReferencia') as string).trim(),
        },
      },
    })
  }

  function handleIniciarSesion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    iniciarSesion({
      variables: {
        input: {
          espacioId:  parseInt(f.get('espacioId') as string),
          vehiculoId: parseInt(f.get('vehiculoId') as string),
        },
      },
    })
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-violet-500 text-white p-2 rounded-xl"><ParkingSquare size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Parqueos</h1>
            <p className="text-slate-500 text-xs">Gestión de zonas y espacios de estacionamiento</p>
          </div>
        </div>
        {esAdmin && (
          <div className="flex gap-2">
            <button onClick={() => { setModal('zona'); setError('') }}
              className="flex items-center gap-1 bg-violet-100 hover:bg-violet-200 text-violet-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              <Plus size={14} /> Nueva zona
            </button>
            <button onClick={() => { setModal('espacio'); setError('') }}
              className="flex items-center gap-1 bg-violet-500 hover:bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
              <Plus size={14} /> Nuevo espacio
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <TabBtn active={tab === 'zonas'}    onClick={() => setTab('zonas')}    label="Zonas" />
        <TabBtn active={tab === 'espacios'} onClick={() => setTab('espacios')} label="Espacios" />
        <TabBtn active={tab === 'sesion'}   onClick={() => setTab('sesion')}   label="Historial sesiones" />
      </div>

      {/* Zonas */}
      {tab === 'zonas' && (
        zonas.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <ParkingSquare size={40} className="mx-auto mb-2 opacity-20" />
            <p>No hay zonas registradas</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {zonas.map((z: any) => {
              const pct = z.capacidadTotal > 0 ? Math.round((1 - z.espaciosDisponibles / z.capacidadTotal) * 100) : 0
              return (
                <div key={z.id}
                  onClick={() => { setZonaSelId(z.id); setTab('espacios') }}
                  className="bg-white rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-violet-200">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-slate-800">{z.nombre}</p>
                      {z.ubicacion && (
                        <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <MapPin size={11} /> {z.ubicacion}
                        </p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${z.activo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {z.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>{z.espaciosDisponibles} disponibles</span>
                      <span>{z.capacidadTotal} total</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-orange-400' : 'bg-green-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">{pct}% ocupado · clic para ver espacios</p>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Espacios */}
      {tab === 'espacios' && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <select value={zonaSelId ?? ''} onChange={e => setZonaSelId(e.target.value ? parseInt(e.target.value) : null)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400">
              <option value="">Seleccionar zona...</option>
              {zonas.map((z: any) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
            </select>
            {zonaActual && (
              <span className="text-sm text-slate-500">{zonaActual.espaciosDisponibles} de {zonaActual.capacidadTotal} disponibles</span>
            )}
          </div>

          {!zonaSelId ? (
            <div className="text-center py-10 text-slate-400 text-sm">Selecciona una zona para ver sus espacios</div>
          ) : espacios.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">No hay espacios en esta zona</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {espacios.map((e: any) => (
                <div key={e.id}
                  className={`border rounded-xl p-3 text-center text-xs font-medium transition-all ${ESTADO_ESPACIO_COLOR[e.estado] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  <div className="font-bold text-sm mb-1">#{e.numero}</div>
                  <div className="truncate">{e.estado}</div>
                  {e.estado === 'disponible' && esPersonal && (
                    <button
                      onClick={() => { setModal('sesion'); setError('') }}
                      className="mt-1.5 text-xs bg-white/60 hover:bg-white rounded px-1.5 py-0.5 border border-current"
                    >
                      Asignar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Historial sesiones */}
      {tab === 'sesion' && (
        <div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo</label>
            <select value={vehiculoHistId ?? ''} onChange={e => setVehiculoHistId(e.target.value ? parseInt(e.target.value) : null)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400 w-full max-w-xs">
              <option value="">Seleccionar vehículo...</option>
              {vehiculos.map((v: any) => <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>)}
            </select>
          </div>
          {!vehiculoHistId ? (
            <div className="text-center py-10 text-slate-400 text-sm">Selecciona un vehículo para ver su historial</div>
          ) : historial.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">Sin sesiones registradas</div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Espacio</th>
                    <th className="px-4 py-3 text-left">Entrada</th>
                    <th className="px-4 py-3 text-left">Salida</th>
                    <th className="px-4 py-3 text-left">Duración</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historial.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        #{s.espacio.numero} — {s.espacio.zona.nombre}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {new Date(s.horaEntrada).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {s.horaSalida ? new Date(s.horaSalida).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : <span className="text-green-600 font-medium">En curso</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {s.duracionMinutos !== null ? `${s.duracionMinutos} min` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.estado === 'activa' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {s.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal Crear Zona */}
      {modal === 'zona' && (
        <ModalWrap titulo="Nueva Zona de Parqueo" onClose={() => setModal(null)}>
          <form onSubmit={handleCrearZona} className="space-y-3">
            <Campo label="Nombre *" name="nombre" placeholder="Ej. Zona A — Edificio Central" />
            <Campo label="Descripción" name="descripcion" placeholder="Descripción opcional" />
            <Campo label="Ubicación" name="ubicacion" placeholder="Ej. Planta baja, Bloque 1" />
            <Campo label="Capacidad total *" name="capacidadTotal" type="number" placeholder="20" />
            {error && <Err t={error} />}
            <Btn loading={loadingZona} label="Crear zona" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Crear Espacio */}
      {modal === 'espacio' && (
        <ModalWrap titulo="Nuevo Espacio" onClose={() => setModal(null)}>
          <form onSubmit={handleCrearEspacio} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Zona *</label>
              <select name="zonaId" required defaultValue={zonaSelId ?? ''} className={cls}>
                <option value="">Seleccionar zona...</option>
                {zonas.map((z: any) => <option key={z.id} value={z.id}>{z.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Categoría *</label>
              <select name="categoriaId" required className={cls}>
                <option value="">Seleccionar...</option>
                {categorias.map((c: any) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <Campo label="Número *" name="numero" placeholder="Ej. A-01" />
            <Campo label="Referencia de ubicación" name="ubicacionReferencia" placeholder="Ej. Junto a la puerta norte" />
            {error && <Err t={error} />}
            <Btn loading={loadingEspacio} label="Crear espacio" />
          </form>
        </ModalWrap>
      )}

      {/* Modal Iniciar Sesión */}
      {modal === 'sesion' && (
        <ModalWrap titulo="Iniciar Sesión de Parqueo" onClose={() => setModal(null)}>
          <form onSubmit={handleIniciarSesion} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Espacio *</label>
              <select name="espacioId" required className={cls}>
                <option value="">Seleccionar espacio disponible...</option>
                {espacios.filter((e: any) => e.estado === 'disponible').map((e: any) => (
                  <option key={e.id} value={e.id}>#{e.numero} — {e.categoria?.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo *</label>
              <select name="vehiculoId" required className={cls}>
                <option value="">Seleccionar...</option>
                {vehiculos.map((v: any) => (
                  <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                ))}
              </select>
            </div>
            {error && <Err t={error} />}
            <Btn loading={loadingIniciar} label="Iniciar sesión" color="bg-violet-500 hover:bg-violet-600" />
          </form>
        </ModalWrap>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-violet-500 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  )
}

const cls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400'

function Campo({ label, name, type = 'text', placeholder = '' }: { label: string; name: string; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} name={name} placeholder={placeholder} className={cls} />
    </div>
  )
}

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

function Btn({ loading, label, color = 'bg-violet-500 hover:bg-violet-600' }: { loading: boolean; label: string; color?: string }) {
  return (
    <button type="submit" disabled={loading}
      className={`w-full ${color} text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50`}>
      {loading ? 'Guardando...' : label}
    </button>
  )
}
