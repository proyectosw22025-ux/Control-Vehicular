import { useState, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { UserCheck, Plus, Search, LogIn, LogOut, X } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import {
  VISITANTES_QUERY,
  VISITAS_ACTIVAS_QUERY,
  TIPOS_VISITA_QUERY,
} from '../graphql/queries/visitantes'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { USUARIOS_QUERY } from '../graphql/queries/usuarios'
import {
  REGISTRAR_VISITANTE_MUTATION,
  REGISTRAR_VISITA_MUTATION,
  INICIAR_VISITA_MUTATION,
  FINALIZAR_VISITA_MUTATION,
} from '../graphql/mutations/visitantes'

const ESTADO_BADGE: Record<string, string> = {
  pendiente:  'bg-yellow-100 text-yellow-700',
  activa:     'bg-green-100 text-green-700',
  completada: 'bg-slate-100 text-slate-500',
}

type Tab = 'activas' | 'registrar' | 'buscar'

export default function Visitantes() {
  const { usuario } = useAuth()
  const [tab, setTab] = useState<Tab>('activas')
  const [busqueda, setBusqueda] = useState('')
  const [visitanteEncontrado, setVisitanteEncontrado] = useState<any>(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const { data: visitasData, refetch: refetchVisitas } = useQuery(VISITAS_ACTIVAS_QUERY, {
    fetchPolicy: 'cache-and-network',
  })
  const { data: tiposData } = useQuery(TIPOS_VISITA_QUERY)
  const { data: vehiculosData } = useQuery(VEHICULOS_QUERY, { variables: { porPagina: 500 } })
  const { data: usuariosData } = useQuery(USUARIOS_QUERY)
  const { data: visitantesData, refetch: refetchBusqueda } = useQuery(VISITANTES_QUERY, {
    variables: { buscar: busqueda || null },
    skip: tab !== 'buscar',
  })

  const [registrarVisitante, { loading: loadingVisitante }] = useMutation(REGISTRAR_VISITANTE_MUTATION, {
    onCompleted(d) {
      setVisitanteEncontrado(d.registrarVisitante)
      setError('')
    },
    onError(e) { setError(e.message) },
  })

  const [registrarVisita, { loading: loadingVisita }] = useMutation(REGISTRAR_VISITA_MUTATION, {
    onCompleted() {
      setExito('Visita registrada correctamente')
      setVisitanteEncontrado(null)
      setTimeout(() => { setExito(''); setTab('activas'); refetchVisitas() }, 1500)
    },
    onError(e) { setError(e.message) },
  })

  const [iniciarVisita] = useMutation(INICIAR_VISITA_MUTATION, {
    onCompleted() { refetchVisitas() },
    onError(e) { alert(e.message) },
  })

  const [finalizarVisita] = useMutation(FINALIZAR_VISITA_MUTATION, {
    onCompleted() { refetchVisitas() },
    onError(e) { alert(e.message) },
  })

  const visitasActivas = visitasData?.visitasActivas ?? []
  const tipos = tiposData?.tiposVisita ?? []
  const vehiculos = vehiculosData?.vehiculos?.items ?? []
  const usuarios = usuariosData?.usuarios ?? []
  const visitantesResultado = visitantesData?.visitantes ?? []

  function handleBuscarVisitante(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const ci = (f.get('ci') as string).trim()
    if (!ci) return
    setBusqueda(ci)
    refetchBusqueda()
  }

  function handleCrearVisitante(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    registrarVisitante({
      variables: {
        input: {
          nombre:   (f.get('nombre') as string).trim(),
          apellido: (f.get('apellido') as string).trim(),
          ci:       (f.get('ci') as string).trim(),
          telefono: (f.get('telefono') as string).trim(),
          email:    (f.get('email') as string).trim(),
        },
      },
    })
  }

  function handleRegistrarVisita(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    const vehId = f.get('vehiculoId') as string
    const tipoId = f.get('tipoVisitaId') as string
    registrarVisita({
      variables: {
        input: {
          visitanteId: visitanteEncontrado.id,
          anfitrionId: parseInt(f.get('anfitrionId') as string),
          motivo:      (f.get('motivo') as string).trim(),
          tipoVisitaId: tipoId ? parseInt(tipoId) : null,
          vehiculoId:   vehId  ? parseInt(vehId)  : null,
        },
      },
    })
  }

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-cyan-500 text-white p-2 rounded-xl"><UserCheck size={20} /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Visitantes</h1>
          <p className="text-slate-500 text-xs">Registro y gestión de visitas</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        <TabBtn active={tab === 'activas'}   onClick={() => setTab('activas')}   label={`Activas (${visitasActivas.length})`} />
        <TabBtn active={tab === 'registrar'} onClick={() => setTab('registrar')} label="Registrar Visita" />
        <TabBtn active={tab === 'buscar'}    onClick={() => setTab('buscar')}    label="Buscar Visitante" />
      </div>

      {/* Visitas activas */}
      {tab === 'activas' && (
        visitasActivas.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <UserCheck size={40} className="mx-auto mb-2 opacity-20" />
            <p>No hay visitas activas en este momento</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visitasActivas.map((v: any) => (
              <div key={v.id} className="bg-white rounded-xl shadow-sm p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-800">{v.visitante.nombreCompleto}</p>
                      <span className="text-xs text-slate-400">CI: {v.visitante.ci}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[v.estado] ?? ''}`}>
                        {v.estado}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">
                      <span className="font-medium">Anfitrión:</span> {v.anfitrionNombre}
                    </p>
                    <p className="text-sm text-slate-600 mt-0.5">
                      <span className="font-medium">Motivo:</span> {v.motivo}
                    </p>
                    {v.tipoVisita && (
                      <p className="text-xs text-slate-400 mt-0.5">Tipo: {v.tipoVisita.nombre}</p>
                    )}
                    {v.placaVehiculo && (
                      <p className="text-xs text-slate-400 mt-0.5">Vehículo: <span className="font-mono">{v.placaVehiculo}</span></p>
                    )}
                    {v.fechaEntrada && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Entrada: {new Date(v.fechaEntrada).toLocaleTimeString('es-BO')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 ml-4">
                    {v.estado === 'pendiente' && (
                      <button
                        onClick={() => iniciarVisita({ variables: { visitaId: v.id } })}
                        className="flex items-center gap-1 bg-green-50 hover:bg-green-100 text-green-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        <LogIn size={13} /> Iniciar
                      </button>
                    )}
                    {v.estado === 'activa' && (
                      <button
                        onClick={() => finalizarVisita({ variables: { visitaId: v.id, observaciones: '' } })}
                        className="flex items-center gap-1 bg-orange-50 hover:bg-orange-100 text-orange-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        <LogOut size={13} /> Finalizar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Registrar visita */}
      {tab === 'registrar' && (
        <div className="max-w-xl">
          {exito && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 mb-4">
              {exito}
            </div>
          )}

          {!visitanteEncontrado ? (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Paso 1 — Ingresa el CI del visitante</p>
              <form onSubmit={handleBuscarVisitante} className="flex gap-2 mb-4">
                <input type="text" name="ci" placeholder="Número de CI..." className={cls + ' flex-1'} />
                <button type="submit" className="bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1">
                  <Search size={15} /> Buscar
                </button>
              </form>

              {busqueda && visitantesResultado.length === 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
                  <p className="text-sm font-medium text-slate-700 mb-3">
                    Visitante no encontrado. Regístralo:
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
                    {error && <Err t={error} />}
                    <Btn loading={loadingVisitante} label="Registrar visitante" />
                  </form>
                </div>
              )}

              {visitantesResultado.length > 0 && (
                <div className="space-y-2">
                  {visitantesResultado.map((vt: any) => (
                    <div key={vt.id}
                      onClick={() => setVisitanteEncontrado(vt)}
                      className="bg-white border border-slate-200 hover:border-cyan-400 rounded-xl p-3 cursor-pointer transition-colors">
                      <p className="font-medium text-slate-800 text-sm">{vt.nombreCompleto}</p>
                      <p className="text-xs text-slate-400">CI: {vt.ci} · {vt.telefono}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-slate-700">Paso 2 — Datos de la visita</p>
                <button onClick={() => setVisitanteEncontrado(null)}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  <X size={13} /> Cambiar visitante
                </button>
              </div>
              <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-3 mb-4 text-sm text-cyan-800">
                <strong>{visitanteEncontrado.nombreCompleto}</strong> · CI: {visitanteEncontrado.ci}
              </div>
              <form onSubmit={handleRegistrarVisita} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Anfitrión *</label>
                  <select name="anfitrionId" required className={cls}>
                    <option value="">Seleccionar...</option>
                    {usuarios.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.nombreCompleto}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Motivo *</label>
                  <input type="text" name="motivo" required placeholder="Ej. Reunión académica" className={cls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de visita</label>
                  <select name="tipoVisitaId" className={cls}>
                    <option value="">Sin tipo específico</option>
                    {tipos.map((t: any) => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo (opcional)</label>
                  <select name="vehiculoId" className={cls}>
                    <option value="">Sin vehículo</option>
                    {vehiculos.map((v: any) => (
                      <option key={v.id} value={v.id}>{v.placa} — {v.marca} {v.modelo}</option>
                    ))}
                  </select>
                </div>
                {error && <Err t={error} />}
                <Btn loading={loadingVisita} label="Registrar visita" color="bg-cyan-500 hover:bg-cyan-600" />
              </form>
            </div>
          )}
        </div>
      )}

      {/* Buscar visitante */}
      {tab === 'buscar' && (
        <div className="max-w-xl">
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por CI, nombre o apellido..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full pl-9 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
          </div>
          {visitantesResultado.length === 0 && busqueda && (
            <div className="text-center py-8 text-slate-400 text-sm">No se encontraron resultados</div>
          )}
          <div className="space-y-2">
            {visitantesResultado.map((vt: any) => (
              <div key={vt.id} className="bg-white rounded-xl shadow-sm p-4">
                <p className="font-semibold text-slate-800">{vt.nombreCompleto}</p>
                <div className="flex gap-4 mt-1 text-xs text-slate-500">
                  <span>CI: {vt.ci}</span>
                  {vt.telefono && <span>Tel: {vt.telefono}</span>}
                  {vt.email && <span>{vt.email}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${active ? 'border-cyan-500 text-cyan-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  )
}

const cls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400'

function Campo({ label, name, type = 'text', defaultValue = '' }: { label: string; name: string; type?: string; defaultValue?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} name={name} defaultValue={defaultValue} className={cls} />
    </div>
  )
}

function Err({ t }: { t: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{t}</div>
}

function Btn({ loading, label, color = 'bg-cyan-500 hover:bg-cyan-600' }: { loading: boolean; label: string; color?: string }) {
  return (
    <button type="submit" disabled={loading}
      className={`w-full ${color} text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50`}>
      {loading ? 'Guardando...' : label}
    </button>
  )
}
