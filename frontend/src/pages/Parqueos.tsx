import { useState, useEffect, FormEvent } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  ParkingSquare, Plus, MapPin, Car, Clock, X, FileDown,
  CheckCircle2, AlertTriangle, User, CreditCard, Shield, Info,
} from 'lucide-react'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import {
  ZONAS_QUERY, ESPACIOS_POR_ZONA_QUERY, CATEGORIAS_ESPACIO_QUERY,
  HISTORIAL_SESIONES_QUERY, SESIONES_ACTIVAS_QUERY, MAPA_PARQUEO_QUERY,
} from '../graphql/queries/parqueos'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import {
  CREAR_ZONA_MUTATION, CREAR_ESPACIO_MUTATION,
  INICIAR_SESION_MUTATION, CERRAR_SESION_MUTATION,
  CAMBIAR_ESTADO_ESPACIO_MUTATION,
} from '../graphql/mutations/parqueos'
import { useAuth } from '../hooks/useAuth'
import { BuscadorVehiculo } from '../components/BuscadorVehiculo'
import { Dropdown } from '../components/Dropdown'
import { API_BASE } from '../config/endpoints'

const ESTADO_COLOR: Record<string, string> = {
  disponible:    'bg-green-100 text-green-700 border-green-200',
  ocupado:       'bg-red-100 text-red-700 border-red-200',
  reservado:     'bg-blue-100 text-blue-700 border-blue-200',
  mantenimiento: 'bg-slate-100 text-slate-500 border-slate-200',
}

// Categorías que requieren rol específico
const CATEGORIA_ROL: Record<string, string[]> = {
  'Docente':                ['Docente'],
  'Estudiante':             ['Estudiante'],
  'Personal Administrativo':['Personal Administrativo'],
  'Discapacitado':          [],  // requiere permiso especial
  'General':                [],  // todos
  'Visitante':              [],  // todos
}

function compatibilidadCategoria(categoriaNombre: string, roles: string[], esDiscapacidad?: boolean): 'ok' | 'warn' {
  // Espacios de discapacidad siempre piden confirmación del guardia:
  // el sistema no registra permisos de discapacidad, la verificación es presencial.
  if (esDiscapacidad) return 'warn'
  const requeridos = CATEGORIA_ROL[categoriaNombre]
  if (requeridos === undefined || requeridos.length === 0) return 'ok'
  if (roles.some(r => requeridos.includes(r))) return 'ok'
  return 'warn'
}

type Tab = 'zonas' | 'espacios' | 'activas' | 'historial' | 'mapa'

export default function Parqueos() {
  const { esAdmin, esGuardia, usuario } = useAuth()
  const toast = useToast()
  const esPersonal = esAdmin || esGuardia

  const [tab, setTab]               = useState<Tab>('zonas')
  const [zonaSelId, setZonaSelId]   = useState<number | null>(null)
  const [vehiculoHistId, setVehHistId] = useState<number | null>(null)
  const [modal, setModal]           = useState<'zona' | 'espacio' | 'sesion' | null>(null)
  const [error, setError]           = useState('')

  // Selects de los formularios modales. El submit los lee vía FormData a través
  // de inputs hidden con el name correspondiente. Se reinician al abrir el modal.
  const [formZonaId, setFormZonaId]           = useState('')
  const [formCategoriaId, setFormCategoriaId] = useState('')
  const [formEspacioId, setFormEspacioId]     = useState('')

  // Al abrir cada modal, reiniciar sus selects (pre-llenando la zona en curso).
  useEffect(() => {
    if (modal === 'espacio') {
      setFormZonaId(zonaSelId != null ? String(zonaSelId) : '')
      setFormCategoriaId('')
    }
    if (modal === 'sesion') setFormEspacioId('')
  }, [modal, zonaSelId])

  // ── Estado del modal de sesión (controlado) ───────────────────────────────
  const [espacioSel, setEspacioSel] = useState<any>(null)   // espacio clickeado
  const [vehiculoSel, setVehSel]    = useState<any>(null)   // vehículo elegido en modal

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: zonasData,    refetch: refetchZonas }    = useQuery(ZONAS_QUERY, { variables: { soloActivas: false }, fetchPolicy: 'cache-and-network' })
  const { data: espaciosData, refetch: refetchEspacios } = useQuery(ESPACIOS_POR_ZONA_QUERY, { variables: { zonaId: zonaSelId }, skip: !zonaSelId })
  const { data: categoriasData }  = useQuery(CATEGORIAS_ESPACIO_QUERY)
  // Admin/Guardia ven todos los vehículos (para asignar espacios).
  // Otros roles solo ven los suyos (historial personal de parqueo).
  const esPersonalFlag = esAdmin || esGuardia
  const { data: vehiculosData } = useQuery(VEHICULOS_QUERY, {
    variables: {
      propietarioId: esPersonalFlag ? undefined : usuario?.id,
      estado: 'activo', porPagina: 200,
    },
  })
  const { data: historialData }   = useQuery(HISTORIAL_SESIONES_QUERY, { variables: { vehiculoId: vehiculoHistId, limite: 15 }, skip: !vehiculoHistId })
  const { data: sesionesData,     refetch: refetchActivas } = useQuery(SESIONES_ACTIVAS_QUERY, { fetchPolicy: 'cache-and-network', skip: tab !== 'activas' })
  const { data: mapaData }        = useQuery(MAPA_PARQUEO_QUERY, { pollInterval: 15_000, fetchPolicy: 'cache-and-network', skip: tab !== 'mapa' })

  const zonas          = zonasData?.zonas          ?? []
  const espacios       = espaciosData?.espaciosPorZona ?? []
  const categorias     = categoriasData?.categoriasEspacio ?? []
  const vehiculos      = vehiculosData?.vehiculos?.items ?? []
  const historial      = historialData?.historialSesiones ?? []
  const sesionesActivas = sesionesData?.sesionesActivas ?? []
  const zonasMapa      = mapaData?.mapaParqueo ?? []
  const zonaActual     = zonas.find((z: any) => z.id === zonaSelId)

  // ── Mutations ─────────────────────────────────────────────────────────────
  const [crearZona,    { loading: lZona }]   = useMutation(CREAR_ZONA_MUTATION,    { onCompleted() { cerrarModal(); refetchZonas() }, onError(e) { setError(e.message) } })
  const [crearEspacio, { loading: lEspacio }]= useMutation(CREAR_ESPACIO_MUTATION, { onCompleted() { cerrarModal(); if (zonaSelId) refetchEspacios() }, onError(e) { setError(e.message) } })
  const [iniciarSesion,{ loading: lIniciar }]= useMutation(INICIAR_SESION_MUTATION, {
    onCompleted(d) {
      const s = d.iniciarSesionParqueo
      toast.exito('Sesión iniciada', `${s.placaVehiculo} asignado al espacio #${s.espacio.numero} (${s.espacio.zona.nombre})`)
      cerrarModal(); if (zonaSelId) refetchEspacios(); refetchActivas()
    },
    onError(e) { setError(e.message) },
  })
  const [cerrarSesion, { loading: lCerrar }] = useMutation(CERRAR_SESION_MUTATION, {
    onCompleted(d) {
      const s = d.cerrarSesionParqueo
      toast.exito('Salida registrada', `${s.placaVehiculo} salió del parqueo (${s.duracionMinutos} min)`)
      if (zonaSelId) refetchEspacios(); refetchZonas(); refetchActivas()
    },
    onError(e) { toast.error('Error al cerrar sesión', e.message) },
  })
  const [cambiarEstadoEspacio, { loading: lMant }] = useMutation(CAMBIAR_ESTADO_ESPACIO_MUTATION, {
    onCompleted(d) {
      const e = d.cambiarEstadoEspacio
      toast.exito(e.estado === 'mantenimiento' ? 'Espacio fuera de servicio' : 'Espacio reactivado',
        `#${e.numero} ahora está ${e.estado}`)
      if (zonaSelId) refetchEspacios(); refetchZonas()
    },
    onError(e) { toast.error('No se pudo cambiar el estado', e.message) },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────
  function cerrarModal() { setModal(null); setError(''); setEspacioSel(null); setVehSel(null) }

  function abrirModalSesion(espacio?: any) {
    setError('')
    setEspacioSel(espacio ?? null)
    setVehSel(null)
    setModal('sesion')
  }

  function handleIniciarSesion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    const espacioId  = espacioSel?.id   ?? parseInt(f.get('espacioId') as string)
    const vehiculoId = vehiculoSel?.id  ?? parseInt(f.get('vehiculoId') as string)
    if (!espacioId || !vehiculoId) { setError('Selecciona un espacio y un vehículo'); return }
    // Si el guardia confirma a pesar de la advertencia de categoría, se envía el
    // override explícito — el backend lo registra en el log de auditoría.
    const espacio  = espacioSel ?? espacios.find((esp: any) => esp.id === espacioId)
    const vehiculo = vehiculoSel ?? vehiculos.find((v: any) => v.id === vehiculoId)
    const incompatible = espacio?.categoria
      ? compatibilidadCategoria(espacio.categoria.nombre, vehiculo?.propietarioRoles ?? [], espacio.categoria.esDiscapacidad) === 'warn'
      : false
    iniciarSesion({ variables: { input: { espacioId, vehiculoId, permitirCategoriaIncompatible: incompatible } } })
  }

  function handleCrearZona(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    crearZona({ variables: { input: { nombre: (f.get('nombre') as string).trim(), descripcion: (f.get('descripcion') as string).trim(), ubicacion: (f.get('ubicacion') as string).trim(), capacidadTotal: parseInt(f.get('capacidadTotal') as string) } } })
  }

  function handleCrearEspacio(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    crearEspacio({ variables: { input: { zonaId: parseInt(f.get('zonaId') as string), categoriaId: parseInt(f.get('categoriaId') as string), numero: (f.get('numero') as string).trim(), ubicacionReferencia: (f.get('ubicacionReferencia') as string).trim() } } })
  }

  async function descargarPDF(tipo: string) {
    const t = localStorage.getItem('access_token') || ''
    const base = API_BASE
    try {
      const resp = await fetch(`${base}/api/pdf/${tipo}/`, { headers: { Authorization: `Bearer ${t}` } })
      if (!resp.ok) throw new Error('Sin acceso al PDF')
      const blob = await resp.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `${tipo}_${new Date().toISOString().slice(0, 10)}.pdf`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast.error('No se pudo generar el PDF', e instanceof Error ? e.message : undefined) }
  }

  // Compatibilidad de categoría
  const compCat = vehiculoSel && espacioSel?.categoria
    ? compatibilidadCategoria(espacioSel.categoria.nombre, vehiculoSel.propietarioRoles ?? [], espacioSel.categoria.esDiscapacidad)
    : 'ok'

  // Hora actual formateada
  const horaAhora = new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="p-4 sm:p-8">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-violet-500 text-white p-2 rounded-xl"><ParkingSquare size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Parqueos</h1>
            <p className="text-slate-500 text-xs">Gestión de zonas y espacios de estacionamiento</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {esAdmin && (
            <>
              <button onClick={() => { setModal('zona'); setError('') }}
                className="flex items-center gap-1 bg-violet-100 hover:bg-violet-200 text-violet-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                <Plus size={14} /> Nueva zona
              </button>
              <button onClick={() => { setModal('espacio'); setError('') }}
                className="flex items-center gap-1 bg-violet-500 hover:bg-violet-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                <Plus size={14} /> Nuevo espacio
              </button>
              <button onClick={() => descargarPDF('vehiculos')}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                <FileDown size={14} /> PDF Vehículos
              </button>
              <button onClick={() => descargarPDF('sesiones')}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors">
                <FileDown size={14} /> PDF Sesiones
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
        {(['zonas','espacios'] as Tab[]).map(t => (
          <TabBtn key={t} active={tab === t} onClick={() => setTab(t)} label={t === 'zonas' ? 'Zonas' : 'Espacios'} />
        ))}
        {esPersonal && (
          <TabBtn active={tab === 'activas'} onClick={() => setTab('activas')}
            label={`Sesiones activas${sesionesActivas.length > 0 ? ` (${sesionesActivas.length})` : ''}`} />
        )}
        <TabBtn active={tab === 'historial'} onClick={() => setTab('historial')} label="Historial" />
        <TabBtn active={tab === 'mapa'} onClick={() => setTab('mapa')} label="Mapa en vivo" />
      </div>

      {/* ── TAB: ZONAS ── */}
      {tab === 'zonas' && (
        zonas.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><ParkingSquare size={40} className="mx-auto mb-2 opacity-20" /><p>No hay zonas registradas</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {zonas.map((z: any) => {
              const reg  = z.totalRegistrados ?? 0
              const ocup = z.espaciosOcupados ?? 0
              const pct  = reg > 0 ? Math.round((ocup / reg) * 100) : 0
              return (
                <div key={z.id} onClick={() => { setZonaSelId(z.id); setTab('espacios') }}
                  className="bg-white rounded-xl shadow-sm p-5 cursor-pointer hover:shadow-md transition-shadow border border-transparent hover:border-violet-200">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-slate-800">{z.nombre}</p>
                      {z.ubicacion && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin size={11} />{z.ubicacion}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${z.activo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {z.activo ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <div className="mb-2">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span className="text-green-600 font-medium">{z.espaciosDisponibles} disponibles</span>
                      <span>{reg} registrados · cap. {z.capacidadTotal}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-orange-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">{reg === 0 ? 'Sin espacios registrados' : `${pct}% ocupado (${ocup}/${reg})`}</p>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* ── TAB: ESPACIOS ── */}
      {tab === 'espacios' && (
        <div>
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <Dropdown
              className="w-56"
              placeholder="Seleccionar zona…"
              value={zonaSelId != null ? String(zonaSelId) : ''}
              onChange={v => setZonaSelId(v ? parseInt(v) : null)}
              options={zonas.map((z: any) => ({ value: String(z.id), label: z.nombre }))}
            />
            {zonaActual && <span className="text-sm text-slate-500 font-medium text-green-600">{zonaActual.espaciosDisponibles} de {zonaActual.capacidadTotal} disponibles</span>}
          </div>

          {!zonaSelId ? (
            <div className="text-center py-10 text-slate-400 text-sm">Selecciona una zona para ver sus espacios</div>
          ) : espacios.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">No hay espacios en esta zona</div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
              {espacios.map((e: any) => (
                <div key={e.id}
                  className={`border rounded-xl p-3 text-center text-xs font-medium transition-all ${ESTADO_COLOR[e.estado] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  <div className="font-bold text-sm mb-0.5">#{e.numero}</div>
                  {e.estado === 'ocupado' && e.placaVehiculoActivo && (
                    <div className="font-mono text-[10px] opacity-80 mb-0.5">{e.placaVehiculoActivo}</div>
                  )}
                  <div className="truncate text-[10px] opacity-70">{e.categoria?.nombre}</div>
                  {e.estado === 'disponible' && esPersonal && (
                    <button onClick={() => abrirModalSesion(e)}
                      className="mt-1.5 text-xs bg-white/70 hover:bg-white rounded px-2 py-0.5 border border-current font-semibold transition-colors">
                      Asignar
                    </button>
                  )}
                  {e.estado === 'ocupado' && esPersonal && e.sesionActivaId && (
                    <button onClick={() => cerrarSesion({ variables: { sesionId: e.sesionActivaId } })} disabled={lCerrar}
                      className="mt-1.5 text-[10px] bg-white/70 hover:bg-white rounded px-1.5 py-0.5 border border-current transition-colors disabled:opacity-40">
                      Salida
                    </button>
                  )}
                  {/* Mantenimiento — solo admin. Disponible→fuera de servicio y viceversa. */}
                  {esAdmin && e.estado === 'disponible' && (
                    <button onClick={() => cambiarEstadoEspacio({ variables: { espacioId: e.id, enMantenimiento: true } })} disabled={lMant}
                      title="Poner fuera de servicio"
                      className="mt-1 block w-full text-[9px] text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40">
                      ⚙ Fuera de servicio
                    </button>
                  )}
                  {esAdmin && e.estado === 'mantenimiento' && (
                    <button onClick={() => cambiarEstadoEspacio({ variables: { espacioId: e.id, enMantenimiento: false } })} disabled={lMant}
                      className="mt-1.5 text-[10px] bg-white/70 hover:bg-white rounded px-1.5 py-0.5 border border-current font-semibold transition-colors disabled:opacity-40">
                      Reactivar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: SESIONES ACTIVAS ── */}
      {tab === 'activas' && (
        sesionesActivas.length === 0 ? (
          <div className="text-center py-12 text-slate-400"><Car size={40} className="mx-auto mb-2 opacity-20" /><p>No hay vehículos en el parqueo en este momento</p></div>
        ) : (
          <div>
            {/* Tabla — desktop */}
            <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Vehículo</th>
                    <th className="px-4 py-3 text-left">Espacio</th>
                    <th className="px-4 py-3 text-left">Zona</th>
                    <th className="px-4 py-3 text-left">Entrada</th>
                    <th className="px-4 py-3 text-left">Duración</th>
                    {esPersonal && <th className="px-4 py-3 text-center">Acción</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sesionesActivas.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-800">{s.placaVehiculo}</td>
                      <td className="px-4 py-3 text-slate-600">#{s.espacio.numero}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{s.espacio.zona.nombre}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{new Date(s.horaEntrada).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 text-violet-600 font-medium text-xs"><Clock size={12} />{s.duracionMinutos !== null ? `${s.duracionMinutos} min` : '—'}</span>
                      </td>
                      {esPersonal && (
                        <td className="px-4 py-3 text-center">
                          <button disabled={lCerrar} onClick={() => cerrarSesion({ variables: { sesionId: s.id } })}
                            className="bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                            Registrar salida
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 bg-slate-50 border-t text-xs text-slate-400">{sesionesActivas.length} vehículo{sesionesActivas.length !== 1 ? 's' : ''} en parqueo ahora</div>
            </div>

            {/* Tarjetas — móvil */}
            <div className="sm:hidden space-y-2">
              {sesionesActivas.map((s: any) => (
                <div key={s.id} className="bg-white rounded-xl shadow-sm p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-slate-800">{s.placaVehiculo}</span>
                    <span className="flex items-center gap-1 text-violet-600 font-medium text-xs"><Clock size={12} />{s.duracionMinutos !== null ? `${s.duracionMinutos} min` : '—'}</span>
                  </div>
                  <p className="text-xs text-slate-500">Espacio #{s.espacio.numero} · {s.espacio.zona.nombre}</p>
                  <p className="text-xs text-slate-500">Entrada: {new Date(s.horaEntrada).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</p>
                  {esPersonal && (
                    <button disabled={lCerrar} onClick={() => cerrarSesion({ variables: { sesionId: s.id } })}
                      className="w-full mt-1 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50">
                      Registrar salida
                    </button>
                  )}
                </div>
              ))}
              <p className="text-xs text-slate-400 px-1">{sesionesActivas.length} vehículo{sesionesActivas.length !== 1 ? 's' : ''} en parqueo ahora</p>
            </div>
          </div>
        )
      )}

      {/* ── TAB: HISTORIAL ── */}
      {tab === 'historial' && (
        <div>
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Vehículo</label>
            <Dropdown
              searchable
              className="max-w-xs"
              placeholder="Seleccionar vehículo…"
              value={vehiculoHistId != null ? String(vehiculoHistId) : ''}
              onChange={v => setVehHistId(v ? parseInt(v) : null)}
              options={vehiculos.map((v: any) => ({ value: String(v.id), label: `${v.placa} — ${v.marca} ${v.modelo}` }))}
            />
          </div>
          {!vehiculoHistId ? (
            <div className="text-center py-10 text-slate-400 text-sm">Selecciona un vehículo para ver su historial de parqueo</div>
          ) : historial.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">Sin sesiones registradas para este vehículo</div>
          ) : (
            <div>
              {/* Tabla — desktop */}
              <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
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
                        <td className="px-4 py-3 font-medium text-slate-800">#{s.espacio.numero} — {s.espacio.zona.nombre}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{new Date(s.horaEntrada).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{s.horaSalida ? new Date(s.horaSalida).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : <span className="text-green-600 font-medium">En curso</span>}</td>
                        <td className="px-4 py-3 text-xs"><span className="flex items-center gap-1"><Clock size={12} />{s.duracionMinutos !== null ? `${s.duracionMinutos} min` : '—'}</span></td>
                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.estado === 'activa' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{s.estado}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarjetas — móvil */}
              <div className="sm:hidden space-y-2">
                {historial.map((s: any) => (
                  <div key={s.id} className="bg-white rounded-xl shadow-sm p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800">#{s.espacio.numero} — {s.espacio.zona.nombre}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${s.estado === 'activa' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{s.estado}</span>
                    </div>
                    <p className="text-xs text-slate-500">Entrada: {new Date(s.horaEntrada).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}</p>
                    <p className="text-xs text-slate-500">Salida: {s.horaSalida ? new Date(s.horaSalida).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' }) : <span className="text-green-600 font-medium">En curso</span>}</p>
                    <p className="flex items-center gap-1 text-xs text-slate-600"><Clock size={12} />{s.duracionMinutos !== null ? `${s.duracionMinutos} min` : '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: MAPA ── */}
      {tab === 'mapa' && (
        <MapaParqueoLive zonas={zonasMapa} esPersonal={esPersonal}
          onCerrarSesion={(sesionId) => cerrarSesion({ variables: { sesionId } })} />
      )}

      {/* ── MODAL: Crear Zona ── */}
      {modal === 'zona' && (
        <ModalWrap titulo="Nueva Zona de Parqueo" onClose={cerrarModal}>
          <form onSubmit={handleCrearZona} className="space-y-3">
            <Campo label="Nombre *" name="nombre" placeholder="Ej. Zona A — Edificio Central" />
            <Campo label="Descripción" name="descripcion" placeholder="Descripción opcional" />
            <Campo label="Ubicación" name="ubicacion" placeholder="Ej. Planta baja, Bloque 1" />
            <Campo label="Capacidad total *" name="capacidadTotal" type="number" placeholder="20" />
            {error && <Err t={error} />}
            <Btn loading={lZona} label="Crear zona" />
          </form>
        </ModalWrap>
      )}

      {/* ── MODAL: Crear Espacio ── */}
      {modal === 'espacio' && (
        <ModalWrap titulo="Nuevo Espacio de Parqueo" onClose={cerrarModal}>
          <form onSubmit={handleCrearEspacio} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Zona *</label>
              <Dropdown
                placeholder="Seleccionar zona…"
                value={formZonaId}
                onChange={setFormZonaId}
                options={zonas.map((z: any) => ({ value: String(z.id), label: z.nombre }))}
              />
              <input type="hidden" name="zonaId" value={formZonaId} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Categoría *</label>
              <Dropdown
                placeholder="Seleccionar…"
                value={formCategoriaId}
                onChange={setFormCategoriaId}
                options={categorias.map((c: any) => ({ value: String(c.id), label: c.nombre }))}
              />
              <input type="hidden" name="categoriaId" value={formCategoriaId} />
            </div>
            <Campo label="Número *" name="numero" placeholder="Ej. A-01" />
            <Campo label="Referencia de ubicación" name="ubicacionReferencia" placeholder="Ej. Junto a la puerta norte" />
            {error && <Err t={error} />}
            <Btn loading={lEspacio} label="Crear espacio" />
          </form>
        </ModalWrap>
      )}

      {/* ── MODAL: Iniciar Sesión de Parqueo — MEJORADO ── */}
      {modal === 'sesion' && (
        <ModalWrap titulo="Asignar espacio de parqueo" onClose={cerrarModal} ancho="max-w-lg">
          <form onSubmit={handleIniciarSesion} className="space-y-4">

            {/* ── Sección: Espacio ── */}
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wide mb-3 flex items-center gap-1.5">
                <ParkingSquare size={12} /> Espacio de parqueo
              </p>
              {espacioSel ? (
                /* Espacio pre-seleccionado desde la vista de espacios */
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-black text-2xl text-slate-800 font-mono">#{espacioSel.numero}</p>
                    <p className="text-sm text-slate-600">{espacioSel.zona?.nombre}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">disponible</span>
                      {espacioSel.categoria && (
                        <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
                          {espacioSel.categoria.esDiscapacidad ? '♿ ' : ''}{espacioSel.categoria.nombre}
                        </span>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => setEspacioSel(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 underline">
                    Cambiar
                  </button>
                </div>
              ) : (
                /* Sin preselección: dropdown de espacios disponibles */
                <div>
                  {!zonaSelId ? (
                    <p className="text-xs text-amber-600">Selecciona una zona en la vista de Espacios para ver los disponibles, o elige aquí:</p>
                  ) : null}
                  <Dropdown
                    searchable
                    placeholder="Seleccionar espacio disponible…"
                    value={formEspacioId}
                    onChange={setFormEspacioId}
                    options={espacios.filter((e: any) => e.estado === 'disponible').map((e: any) => ({
                      value: String(e.id),
                      label: `#${e.numero} — ${e.zona?.nombre} · ${e.categoria?.nombre}`,
                    }))}
                  />
                  <input type="hidden" name="espacioId" value={formEspacioId} />
                </div>
              )}
            </div>

            {/* ── Sección: Vehículo y propietario ── */}
            <div className="rounded-2xl border border-slate-200 p-4 bg-slate-50">
              <p className="text-xs font-bold uppercase text-slate-400 tracking-wide mb-3 flex items-center gap-1.5">
                <Car size={12} /> Vehículo a estacionar
              </p>
              {/* Typeahead server-side: busca por placa/marca/dueño sin cargar
                  toda la flota. Para usuarios no-personal, restringido a los suyos. */}
              <BuscadorVehiculo
                propietarioId={esPersonalFlag ? undefined : (usuario?.id ? Number(usuario.id) : undefined)}
                seleccionado={vehiculoSel}
                onSelect={setVehSel}
              />

              {/* Info del propietario — aparece al seleccionar vehículo */}
              {vehiculoSel && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Propietario registrado</p>
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800 text-sm">{vehiculoSel.propietarioNombre}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CreditCard size={14} className="text-slate-400 shrink-0" />
                    <span className="text-slate-600 text-sm font-mono">CI: {vehiculoSel.propietarioCi}</span>
                  </div>
                  {vehiculoSel.propietarioRoles?.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Shield size={14} className="text-slate-400 shrink-0" />
                      <div className="flex gap-1 flex-wrap">
                        {vehiculoSel.propietarioRoles.map((r: string) => (
                          <span key={r} className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Validación de categoría */}
                  {espacioSel?.categoria && (
                    <div className={`flex items-start gap-2 rounded-xl px-3 py-2 mt-1 ${
                      compCat === 'ok'   ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                      compCat === 'warn' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                      'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {compCat === 'ok'
                        ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
                        : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
                      <p className="text-xs font-medium">
                        {compCat === 'ok'
                          ? `El rol del propietario es compatible con el espacio "${espacioSel.categoria.nombre}"`
                          : `Este espacio es categoría "${espacioSel.categoria.nombre}". Verifica el permiso del propietario — al confirmar, la excepción queda registrada en auditoría.`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Hora de registro ── */}
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-200">
              <Clock size={13} className="text-slate-400" />
              <span>Hora de registro:</span>
              <span className="font-semibold text-slate-700">{horaAhora}</span>
              <Info size={11} className="text-slate-300 ml-auto" />
            </div>

            {/* ── Instrucción para el guardia ── */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 text-xs text-blue-700 flex items-start gap-2">
              <Info size={13} className="shrink-0 mt-0.5" />
              <p>Verifica el carnet de identidad del propietario antes de confirmar la asignación.</p>
            </div>

            {error && <Err t={error} />}
            <Btn loading={lIniciar} label="Confirmar asignación de espacio" color="bg-violet-500 hover:bg-violet-600" />
          </form>
        </ModalWrap>
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />
    </div>
  )
}

// ── Mapa visual en vivo ───────────────────────────────────────────────────

const ESTADO_MAPA: Record<string, { bg: string; border: string; text: string; symbol: string }> = {
  disponible:    { bg: 'bg-green-50',  border: 'border-green-400', text: 'text-green-800', symbol: '✓' },
  ocupado:       { bg: 'bg-red-50',    border: 'border-red-400',   text: 'text-red-800',   symbol: '●' },
  reservado:     { bg: 'bg-blue-50',   border: 'border-blue-400',  text: 'text-blue-800',  symbol: '⏱' },
  mantenimiento: { bg: 'bg-slate-100', border: 'border-slate-300', text: 'text-slate-500', symbol: '⚙' },
}

function EspacioBtn({ esp, onCerrar, esPersonal }: { esp: any; onCerrar: () => void; esPersonal: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = ESTADO_MAPA[esp.estado] ?? ESTADO_MAPA.mantenimiento
  const esDisc = esp.categoria?.esDiscapacidad

  return (
    <div className="relative">
      <button onClick={() => setExpanded(v => !v)} aria-label={`Espacio ${esp.numero}`}
        className={`min-w-[56px] min-h-[52px] w-full rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 px-1 py-2 transition-all cursor-pointer select-none ${cfg.bg} ${cfg.border} ${cfg.text} hover:brightness-95 active:scale-95`}>
        <span className="font-bold text-xs leading-none">{esDisc ? '♿' : cfg.symbol} {esp.numero}</span>
        {esp.placaVehiculoActivo
          ? <span className="font-mono text-[9px] leading-none opacity-90">{esp.placaVehiculoActivo}</span>
          : <span className="text-[9px] leading-none opacity-60 truncate max-w-[52px]">{esp.categoria?.nombre?.slice(0,5)}</span>}
      </button>
      {expanded && (
        <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-slate-800 text-white text-xs rounded-xl p-3 shadow-xl space-y-1" onClick={() => setExpanded(false)}>
          <p className="font-bold">#{esp.numero}</p>
          <p className="opacity-80">{esp.categoria?.nombre}</p>
          <p className="capitalize font-medium">{esp.estado}</p>
          {esp.placaVehiculoActivo && <p className="font-mono bg-white/20 rounded px-1 py-0.5 text-center">{esp.placaVehiculoActivo}</p>}
          {esp.ubicacionReferencia && <p className="opacity-60 text-[10px]">{esp.ubicacionReferencia}</p>}
          {esPersonal && esp.estado === 'ocupado' && (
            <button onClick={(e) => { e.stopPropagation(); onCerrar(); setExpanded(false) }}
              className="w-full mt-1 bg-orange-500 hover:bg-orange-600 text-white rounded-lg py-1.5 font-medium text-[10px] transition-colors">
              Registrar salida
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function MapaParqueoLive({ zonas, esPersonal, onCerrarSesion }: { zonas: any[]; esPersonal: boolean; onCerrarSesion: (sesionId: number) => void }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4 bg-white rounded-xl p-4 shadow-sm">
        <span className="text-xs font-semibold text-slate-500">Estado:</span>
        {Object.entries(ESTADO_MAPA).map(([key, cfg]) => (
          <span key={key} className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-lg border ${cfg.bg} ${cfg.border} ${cfg.text}`}>
            {cfg.symbol} {key.charAt(0).toUpperCase() + key.slice(1)}
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-400 italic">Actualiza cada 15s · toca para detalles</span>
      </div>
      {zonas.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">No hay zonas de parqueo activas</div>
      ) : zonas.map((zona: any) => {
        const esps  = zona.espacios ?? []
        const cDisp = esps.filter((e: any) => e.estado === 'disponible').length
        const cOcup = esps.filter((e: any) => e.estado === 'ocupado').length
        const pct   = esps.length > 0 ? Math.round((cOcup / esps.length) * 100) : 0
        return (
          <div key={zona.id} className="bg-white rounded-xl shadow-sm p-5">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">{zona.nombre}</h3>
                {zona.ubicacion && <p className="text-xs text-slate-400 mt-0.5">{zona.ubicacion}</p>}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{cDisp} libre{cDisp !== 1 ? 's' : ''}</span>
                {cOcup > 0 && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">{cOcup} ocupado{cOcup !== 1 ? 's' : ''}</span>}
              </div>
            </div>
            <div className="mb-4">
              <div className="flex justify-between text-[10px] text-slate-400 mb-1"><span>Ocupación</span><span>{pct}%</span></div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-orange-400' : 'bg-green-400'}`} style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>
            {esps.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Sin espacios registrados</p>
            ) : (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
                {esps.map((esp: any) => (
                  <EspacioBtn key={esp.id} esp={esp} esPersonal={esPersonal}
                    onCerrar={() => { if (esp.sesionActivaId) onCerrarSesion(esp.sesionActivaId) }} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Auxiliares ────────────────────────────────────────────────────────────

const cls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400'

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${active ? 'border-violet-500 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
      {label}
    </button>
  )
}

function Campo({ label, name, type = 'text', placeholder = '' }: { label: string; name: string; type?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} name={name} placeholder={placeholder} className={cls} />
    </div>
  )
}

function ModalWrap({ titulo, onClose, children, ancho = 'max-w-md' }: { titulo: string; onClose: () => void; children: React.ReactNode; ancho?: string }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${ancho} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{titulo}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:rotate-90 transition-transform duration-200"><X size={18} /></button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function Err({ t }: { t: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-start gap-2"><AlertTriangle size={14} className="shrink-0 mt-0.5" />{t}</div>
}

function Btn({ loading, label, color = 'bg-violet-500 hover:bg-violet-600' }: { loading: boolean; label: string; color?: string }) {
  return (
    <button type="submit" disabled={loading} className={`w-full ${color} text-white font-medium py-3 rounded-xl text-sm transition-colors disabled:opacity-50`}>
      {loading ? 'Procesando...' : label}
    </button>
  )
}
