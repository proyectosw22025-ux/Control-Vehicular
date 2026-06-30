import { useState } from 'react'
import { API_BASE } from '../config/endpoints'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { useState as useLocalState } from 'react'
import {
  ArrowLeft, Car, DoorOpen, AlertTriangle, ParkingSquare, Clock, RefreshCw,
  Upload, FileCheck, ExternalLink, GitBranch, ChevronDown, ChevronUp,
} from 'lucide-react'
import { VEHICULO_QUERY, HISTORIAL_ESTADOS_QUERY } from '../graphql/queries/vehiculos'
import { REGISTROS_ACCESO_QUERY } from '../graphql/queries/acceso'
import { INFRACCIONES_VEHICULO_QUERY } from '../graphql/queries/infracciones'
import { HISTORIAL_SESIONES_QUERY } from '../graphql/queries/parqueos'

type Tab = 'accesos' | 'infracciones' | 'sesiones' | 'documentos' | 'timeline'

const ESTADO_BADGE: Record<string, string> = {
  pendiente:  'bg-amber-100 text-amber-700',
  activo:     'bg-green-100 text-green-700',
  inactivo:   'bg-slate-100 text-slate-600',
  sancionado: 'bg-red-100 text-red-700',
}
// Semáforo de documentos
const DOC_SEMAFORO: Record<string, { bg: string; text: string; label: string }> = {
  valido:     { bg: 'bg-emerald-50', text: 'text-emerald-700', label: '✓ Vigente' },
  por_vencer: { bg: 'bg-amber-50',   text: 'text-amber-700',   label: '⚠ Por vencer' },
  vencido:    { bg: 'bg-red-50',     text: 'text-red-700',     label: '🚨 Vencido' },
}

const DOC_NOMBRES: Record<string, string> = {
  soat:        'SOAT',
  tecnica:     'Revisión Técnica',
  circulacion: 'Permiso de Circulación',
  otro:        'Otro',
}

const ESTADO_INFRACCION_BADGE: Record<string, string> = {
  registrada: 'bg-amber-100 text-amber-700',
  confirmada: 'bg-green-100 text-green-700',
  apelada:    'bg-blue-100 text-blue-700',
  anulada:    'bg-slate-100 text-slate-500',
}
const TIPO_SANCION_LABELS: Record<string, string> = {
  amonestacion:      'Amonestación',
  multa_economica:   'Multa económica',
  suspension_acceso: 'Suspensión de acceso',
  reporte_bienestar: 'Reporte a Bienestar',
}
const METODO_LABEL: Record<string, string> = {
  qr_dinamico:   'QR Dinámico',
  qr_permanente: 'QR Permanente',
  qr_delegacion: 'QR Delegación',
  pase_temporal:  'Pase Temporal',
  manual:         'Manual (guardia)',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })
}

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-emerald-500 text-emerald-600'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function EmptyState({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return (
    <div className="text-center py-16 text-slate-400">
      <Icon size={36} className="mx-auto mb-2 opacity-25" />
      <p className="text-sm">{text}</p>
    </div>
  )
}

export default function HistorialVehiculo() {
  const { vehiculoId } = useParams<{ vehiculoId: string }>()
  const navigate = useNavigate()
  const id = parseInt(vehiculoId || '0', 10)
  const [tab, setTab] = useState<Tab>('accesos')

  const { data: vData, loading: vLoad } = useQuery(VEHICULO_QUERY, {
    variables: { id },
    skip: !id,
  })
  // Cargar las 3 queries simultáneamente para obtener counts inmediatos en tabs
  // (no lazy-by-tab: el historial es una página de consulta, no de escritura)
  const { data: acData, loading: acLoad, refetch: refetchAc } = useQuery(REGISTROS_ACCESO_QUERY, {
    variables: { vehiculoId: id, limite: 100 },
    skip: !id,
    fetchPolicy: 'cache-and-network',
  })
  const { data: muData, loading: muLoad, refetch: refetchMu } = useQuery(INFRACCIONES_VEHICULO_QUERY, {
    variables: { vehiculoId: id },
    skip: !id,
    fetchPolicy: 'cache-and-network',
  })
  const { data: seData, loading: seLoad, refetch: refetchSe } = useQuery(HISTORIAL_SESIONES_QUERY, {
    variables: { vehiculoId: id, limite: 100 },
    skip: !id,
    fetchPolicy: 'cache-and-network',
  })
  const { data: tlData, loading: tlLoad } = useQuery(HISTORIAL_ESTADOS_QUERY, {
    variables: { vehiculoId: id },
    skip: !id,
    fetchPolicy: 'cache-and-network',
  })

  const vehiculo         = vData?.vehiculo
  const accesos          = acData?.registrosAcceso ?? []
  const infracciones     = muData?.infraccionesVehiculo ?? []
  const sesiones         = seData?.historialSesiones ?? []
  const historialEstados = tlData?.historialEstadosVehiculo ?? []

  // Resumen estadístico — disponible en cuanto lleguen los datos
  const sancionesPendientesTotal = infracciones
    .filter((i: any) => i.sancion?.tipoSancion === 'multa_economica' && i.sancion?.estado === 'pendiente')
    .reduce((s: number, i: any) => s + Number(i.sancion.monto), 0)
  const minutosParqueo = sesiones
    .filter((s: any) => s.duracionMinutos != null)
    .reduce((s: number, se: any) => s + se.duracionMinutos, 0)

  const tabLoad = tab === 'accesos' ? acLoad : tab === 'infracciones' ? muLoad : seLoad
  function refetchTab() { refetchAc(); refetchMu(); refetchSe() }

  if (vLoad) {
    return (
      <div className="p-4 sm:p-8">
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl h-12 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (!vehiculo) {
    return (
      <div className="p-8 text-center text-slate-400">
        <Car size={40} className="mx-auto mb-2 opacity-20" />
        <p>Vehículo no encontrado</p>
        <button onClick={() => navigate(-1)} className="mt-3 text-sm text-emerald-600 hover:underline">
          Volver
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Botón volver */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm mb-5 transition-colors"
      >
        <ArrowLeft size={15} /> Volver a vehículos
      </button>

      {/* Tarjeta del vehículo */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 mb-6 flex items-center gap-5">
        <div className="bg-emerald-100 text-emerald-600 p-4 rounded-2xl shrink-0">
          <Car size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-2xl font-bold font-mono text-slate-800">{vehiculo.placa}</span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${ESTADO_BADGE[vehiculo.estado] ?? 'bg-slate-100 text-slate-600'}`}>
              {vehiculo.estado}
            </span>
          </div>
          <p className="text-slate-600 text-sm mt-0.5">
            {vehiculo.marca} {vehiculo.modelo} · {vehiculo.anio} · {vehiculo.color}
          </p>
          <p className="text-slate-400 text-xs mt-0.5">
            {vehiculo.tipo?.nombre} · Propietario: {vehiculo.propietarioNombre}
          </p>
        </div>
        <button
          onClick={refetchTab}
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          title="Actualizar"
        >
          <RefreshCw size={15} className={tabLoad ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Resumen estadístico — se muestra cuando al menos uno de los datos llegó */}
      {(accesos.length > 0 || infracciones.length > 0 || sesiones.length > 0) && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-xl p-3 text-center border border-slate-100 shadow-sm">
            <p className="text-lg font-bold text-slate-800">{accesos.length}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Accesos registrados</p>
          </div>
          <div className={`bg-white rounded-xl p-3 text-center border shadow-sm ${sancionesPendientesTotal > 0 ? 'border-red-200' : 'border-slate-100'}`}>
            <p className={`text-lg font-bold ${sancionesPendientesTotal > 0 ? 'text-red-600' : 'text-slate-800'}`}>
              {sancionesPendientesTotal > 0 ? `Bs ${sancionesPendientesTotal.toFixed(0)}` : infracciones.length}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {sancionesPendientesTotal > 0 ? 'Sanciones pendientes' : 'Sin sanciones pendientes'}
            </p>
          </div>
          <div className="bg-white rounded-xl p-3 text-center border border-slate-100 shadow-sm">
            <p className="text-lg font-bold text-slate-800">
              {minutosParqueo >= 60 ? `${Math.round(minutosParqueo / 60)}h` : `${minutosParqueo}m`}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Tiempo en parqueo</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 mb-4 border-b border-slate-200 flex-wrap">
        <TabBtn active={tab === 'accesos'} onClick={() => setTab('accesos')}>
          <DoorOpen size={14} /> Accesos ({acLoad ? '…' : accesos.length})
        </TabBtn>
        <TabBtn active={tab === 'infracciones'} onClick={() => setTab('infracciones')}>
          <AlertTriangle size={14} />
          Infracciones ({muLoad ? '…' : infracciones.length})
          {infracciones.filter((i: any) => i.sancion?.estado === 'pendiente').length > 0 && (
            <span className="ml-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
              {infracciones.filter((i: any) => i.sancion?.estado === 'pendiente').length}
            </span>
          )}
        </TabBtn>
        <TabBtn active={tab === 'sesiones'} onClick={() => setTab('sesiones')}>
          <ParkingSquare size={14} /> Sesiones ({seLoad ? '…' : sesiones.length})
        </TabBtn>
        <TabBtn active={tab === 'documentos'} onClick={() => setTab('documentos')}>
          <AlertTriangle size={14} /> Documentos
          {vehiculo?.documentos?.some((d: any) => d.estado === 'vencido') && (
            <span className="ml-1 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">!</span>
          )}
        </TabBtn>
        <TabBtn active={tab === 'timeline'} onClick={() => setTab('timeline')}>
          <GitBranch size={14} /> Línea de tiempo ({tlLoad ? '…' : historialEstados.length})
        </TabBtn>
      </div>

      {/* ── Accesos ── */}
      {tab === 'accesos' && (
        acLoad ? <SkeletonRows /> :
        accesos.length === 0 ? (
          <EmptyState icon={DoorOpen} text="Sin registros de acceso" />
        ) : (
          <>
            {/* Tabla — desktop */}
            <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Tipo</th>
                    <th className="px-4 py-3 text-left">Punto de acceso</th>
                    <th className="px-4 py-3 text-left">Método</th>
                    <th className="px-4 py-3 text-left">Fecha y hora</th>
                    <th className="px-4 py-3 text-left">Observación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accesos.map((a: any) => (
                    <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.tipo === 'entrada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {a.tipo === 'entrada' ? '↑ Entrada' : '↓ Salida'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{a.puntoNombre}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{METODO_LABEL[a.metodoAcceso] ?? a.metodoAcceso}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{fmt(a.timestamp)}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {a.imagenUrl ? (
                          <a href={a.imagenUrl} target="_blank" rel="noreferrer"
                            className="inline-block" title="Ver evidencia del acceso">
                            <img src={a.imagenUrl} alt="Evidencia"
                              className="w-12 h-9 object-cover rounded border border-slate-200 hover:ring-2 hover:ring-violet-300" />
                          </a>
                        ) : (a.observacion || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas — móvil */}
            <div className="sm:hidden space-y-2">
              {accesos.map((a: any) => (
                <div key={a.id} className="bg-white rounded-xl shadow-sm p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${a.tipo === 'entrada' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                      {a.tipo === 'entrada' ? '↑ Entrada' : '↓ Salida'}
                    </span>
                    <span className="text-[11px] text-slate-500">{fmt(a.timestamp)}</span>
                  </div>
                  <p className="text-sm text-slate-700">{a.puntoNombre}</p>
                  <p className="text-xs text-slate-500">{METODO_LABEL[a.metodoAcceso] ?? a.metodoAcceso}</p>
                  {a.imagenUrl ? (
                    <a href={a.imagenUrl} target="_blank" rel="noreferrer" className="inline-block" title="Ver evidencia del acceso">
                      <img src={a.imagenUrl} alt="Evidencia" className="w-16 h-12 object-cover rounded border border-slate-200" />
                    </a>
                  ) : (a.observacion && <p className="text-xs text-slate-400">{a.observacion}</p>)}
                </div>
              ))}
            </div>
          </>
        )
      )}

      {/* ── Infracciones ── */}
      {tab === 'infracciones' && (
        muLoad ? <SkeletonRows /> :
        infracciones.length === 0 ? (
          <EmptyState icon={AlertTriangle} text="Sin infracciones registradas" />
        ) : (
          <>
            {/* Tabla — desktop */}
            <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Fecha</th>
                    <th className="px-4 py-3 text-left">Tipo</th>
                    <th className="px-4 py-3 text-left">Descripción</th>
                    <th className="px-4 py-3 text-left">Sanción</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                    <th className="px-4 py-3 text-left">Registrado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {infracciones.map((i: any) => (
                    <tr key={i.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-500 text-xs">{fmt(i.fecha)}</td>
                      <td className="px-4 py-3 text-slate-700 text-xs">{i.tipo?.nombre}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs max-w-xs truncate">{i.descripcion}</td>
                      <td className="px-4 py-3 text-slate-700 text-xs">
                        {i.sancion ? (
                          <>
                            {TIPO_SANCION_LABELS[i.sancion.tipoSancion] ?? i.sancion.tipoSancion}
                            {i.sancion.tipoSancion === 'multa_economica' && i.sancion.monto != null && (
                              <span className="font-semibold text-slate-800"> · Bs {Number(i.sancion.monto).toFixed(2)}</span>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ESTADO_INFRACCION_BADGE[i.estado] ?? 'bg-slate-100 text-slate-500'}`}>
                          {i.estado}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{i.registradoPorNombre ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas — móvil */}
            <div className="sm:hidden space-y-2">
              {infracciones.map((i: any) => (
                <div key={i.id} className="bg-white rounded-xl shadow-sm p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700 font-medium">{i.tipo?.nombre}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${ESTADO_INFRACCION_BADGE[i.estado] ?? 'bg-slate-100 text-slate-500'}`}>
                      {i.estado}
                    </span>
                  </div>
                  {i.descripcion && <p className="text-xs text-slate-500 line-clamp-2">{i.descripcion}</p>}
                  <p className="text-xs text-slate-700">
                    {i.sancion ? (
                      <>
                        {TIPO_SANCION_LABELS[i.sancion.tipoSancion] ?? i.sancion.tipoSancion}
                        {i.sancion.tipoSancion === 'multa_economica' && i.sancion.monto != null && (
                          <span className="font-semibold text-slate-800"> · Bs {Number(i.sancion.monto).toFixed(2)}</span>
                        )}
                      </>
                    ) : 'Sin sanción'}
                  </p>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>{fmt(i.fecha)}</span>
                    <span>{i.registradoPorNombre ?? '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {/* ── Sesiones de parqueo ── */}
      {tab === 'sesiones' && (
        seLoad ? <SkeletonRows /> :
        sesiones.length === 0 ? (
          <EmptyState icon={ParkingSquare} text="Sin sesiones de parqueo" />
        ) : (
          <>
            {/* Tabla — desktop */}
            <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">Espacio</th>
                    <th className="px-4 py-3 text-left">Zona</th>
                    <th className="px-4 py-3 text-left">Entrada</th>
                    <th className="px-4 py-3 text-left">Salida</th>
                    <th className="px-4 py-3 text-left">Duración</th>
                    <th className="px-4 py-3 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sesiones.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800">#{s.espacio.numero}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{s.espacio.zona.nombre}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{fmt(s.horaEntrada)}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {s.horaSalida ? fmt(s.horaSalida) : <span className="text-green-600 font-medium">En curso</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1 text-violet-600 text-xs font-medium">
                          <Clock size={12} />
                          {s.duracionMinutos != null ? `${s.duracionMinutos} min` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s.estado === 'activa' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                          {s.estado}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas — móvil */}
            <div className="sm:hidden space-y-2">
              {sesiones.map((s: any) => (
                <div key={s.id} className="bg-white rounded-xl shadow-sm p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-slate-800">#{s.espacio.numero} — {s.espacio.zona.nombre}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.estado === 'activa' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.estado}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Entrada: {fmt(s.horaEntrada)}</p>
                  <p className="text-xs text-slate-500">Salida: {s.horaSalida ? fmt(s.horaSalida) : <span className="text-green-600 font-medium">En curso</span>}</p>
                  <p className="flex items-center gap-1 text-xs text-violet-600 font-medium">
                    <Clock size={12} />{s.duracionMinutos != null ? `${s.duracionMinutos} min` : '—'}
                  </p>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {/* ── Documentos con semáforo ── */}
      {tab === 'documentos' && (
        <div>
          {(!vehiculo?.documentos || vehiculo.documentos.length === 0) ? (
            <EmptyState icon={AlertTriangle} text="No hay documentos registrados para este vehículo" />
          ) : (
            <div className="space-y-3">
              {/* Alerta si hay documentos críticos */}
              {vehiculo.documentos.some((d: any) => d.estado === 'vencido' && ['soat', 'tecnica'].includes(d.tipoDoc)) && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                  <span className="text-2xl shrink-0">🚨</span>
                  <div>
                    <p className="font-bold text-red-700 text-sm">Documentos críticos vencidos</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      El SOAT o la Revisión Técnica están vencidos. Este vehículo no debería circular.
                      El guardia recibirá una advertencia al escanear el QR.
                    </p>
                  </div>
                </div>
              )}

              {/* Tarjetas de documentos */}
              {vehiculo.documentos.map((doc: any) => {
                const sem = DOC_SEMAFORO[doc.estado] ?? DOC_SEMAFORO.valido
                const esCritico = ['soat', 'tecnica'].includes(doc.tipoDoc)
                return (
                  <div key={doc.id} className={`rounded-xl border p-4 ${sem.bg}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="font-bold text-slate-800 text-sm">
                            {DOC_NOMBRES[doc.tipoDoc] ?? doc.tipoDoc}
                          </p>
                          {esCritico && (
                            <span className="text-[10px] bg-slate-700 text-white px-1.5 py-0.5 rounded font-semibold">
                              OBLIGATORIO
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">N° {doc.numero}</p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Vence: <strong>{new Date(doc.fechaVencimiento).toLocaleDateString('es-BO')}</strong>
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${sem.text} ${sem.bg} border`}
                          style={{ borderColor: 'currentColor', borderWidth: 1 }}>
                          {sem.label}
                        </span>
                        <p className={`text-xs mt-1.5 font-semibold ${sem.text}`}>
                          {doc.diasParaVencer > 0
                            ? `${doc.diasParaVencer} días restantes`
                            : `Venció hace ${Math.abs(doc.diasParaVencer)} días`}
                        </p>
                      </div>
                    </div>

                    {/* Upload + previsualización del archivo */}
                    <SubirArchivo
                      documentoId={doc.id}
                      archivoUrl={(doc as any).archivoUrl ?? null}
                      onSubido={() => window.location.reload()}
                    />
                  </div>
                )
              })}

              {/* Leyenda de alertas */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-slate-600">Sistema de alertas automáticas</p>
                <p>✉ El sistema envía notificaciones automáticas con <strong>30, 15 y 5 días de anticipación</strong> al vencimiento del SOAT y la Revisión Técnica.</p>
                <p>📱 Las notificaciones llegan por email y en el panel de notificaciones del sistema.</p>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ── Línea de tiempo de estados ── */}
      {tab === 'timeline' && (
        tlLoad ? <SkeletonRows /> :
        historialEstados.length === 0 ? (
          <EmptyState icon={GitBranch} text="Sin historial de estados registrado" />
        ) : (
          <div className="relative">
            {/* Línea vertical */}
            <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-slate-200" />
            <div className="space-y-0">
              {historialEstados.map((h: any, idx: number) => (
                <TimelineEvento key={h.id} evento={h} ultimo={idx === historialEstados.length - 1} />
              ))}
            </div>
          </div>
        )
      )}
    </div>
  )
}

// ── Línea de tiempo: un evento ────────────────────────────────────────────
const ESTADO_COLOR: Record<string, { bg: string; ring: string; dot: string }> = {
  activo:     { bg: 'bg-emerald-50 border-emerald-200', ring: 'ring-emerald-400', dot: 'bg-emerald-500' },
  pendiente:  { bg: 'bg-amber-50 border-amber-200',     ring: 'ring-amber-400',   dot: 'bg-amber-400'   },
  sancionado: { bg: 'bg-red-50 border-red-200',         ring: 'ring-red-400',     dot: 'bg-red-500'     },
  inactivo:   { bg: 'bg-slate-50 border-slate-200',     ring: 'ring-slate-400',   dot: 'bg-slate-400'   },
}

const ESTADO_LABEL: Record<string, string> = {
  activo: 'Activado', pendiente: 'Pendiente', sancionado: 'Sancionado', inactivo: 'Desactivado',
}

const ESTADO_ICON: Record<string, string> = {
  activo: '✅', pendiente: '⏳', sancionado: '🚫', inactivo: '⬛', '': '🆕',
}

function TimelineEvento({ evento, ultimo }: { evento: any; ultimo: boolean }) {
  const [expandido, setExpandido] = useState(false)
  const esInicial = !evento.estadoAnterior
  const colores   = ESTADO_COLOR[evento.estadoNuevo] ?? ESTADO_COLOR.inactivo

  return (
    <div className="relative flex gap-4 pb-6">
      {/* Punto en la línea */}
      <div className="relative z-10 flex-shrink-0 mt-1">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 border-white ring-2 ${colores.ring} ${colores.dot === 'bg-emerald-500' ? 'bg-emerald-500' : colores.dot === 'bg-amber-400' ? 'bg-amber-400' : colores.dot === 'bg-red-500' ? 'bg-red-500' : 'bg-slate-400'}`}>
          <span className="text-white text-xs font-bold">
            {esInicial ? '★' : '→'}
          </span>
        </div>
      </div>

      {/* Contenido del evento */}
      <div className={`flex-1 rounded-xl border p-3 transition-all ${colores.bg}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {esInicial ? (
                <span className="text-sm font-semibold text-slate-700">
                  {ESTADO_ICON[evento.estadoNuevo]} Vehículo registrado
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    (estado: {ESTADO_LABEL[evento.estadoNuevo] ?? evento.estadoNuevo})
                  </span>
                </span>
              ) : (
                <span className="text-sm font-semibold text-slate-700">
                  <span className="text-slate-400">{ESTADO_LABEL[evento.estadoAnterior] ?? evento.estadoAnterior}</span>
                  {' → '}
                  <span>{ESTADO_ICON[evento.estadoNuevo]} {ESTADO_LABEL[evento.estadoNuevo] ?? evento.estadoNuevo}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(evento.fecha).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })}
              {evento.usuarioNombre && <> · <span className="text-slate-500">{evento.usuarioNombre}</span></>}
            </p>
          </div>
          {evento.motivo && (
            <button onClick={() => setExpandido(v => !v)}
              className="text-slate-400 hover:text-slate-600 shrink-0 p-1">
              {expandido ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
        {expandido && evento.motivo && (
          <p className="text-xs text-slate-600 mt-2 pt-2 border-t border-slate-200">
            {evento.motivo}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Subir archivo de documento a Cloudinary ────────────────
function SubirArchivo({
  documentoId, archivoUrl, onSubido,
}: { documentoId: number; archivoUrl: string | null; onSubido: () => void }) {
  const [subiendo, setSubiendo] = useLocalState(false)
  const [error, setError]       = useLocalState('')
  const [exito, setExito]       = useLocalState(false)
  const esPDF = archivoUrl?.toLowerCase().endsWith('.pdf')

  async function handleArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    if (!archivo) return
    setSubiendo(true); setError(''); setExito(false)
    const form = new FormData()
    form.append('archivo', archivo)
    const token = localStorage.getItem('access_token') ?? ''
    const base  = API_BASE
    try {
      const resp = await fetch(`${base}/api/documentos/${documentoId}/subir/`, {
        method: 'POST', body: form,
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await resp.json()
      if (!resp.ok) { setError(json.error ?? 'Error al subir'); return }
      setExito(true)
      setTimeout(onSubido, 1200)
    } catch {
      setError('Error de red al subir el archivo')
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      {/* Previsualización si ya hay archivo */}
      {archivoUrl && (
        <div className="flex items-center gap-2 mb-2">
          {esPDF ? (
            <a href={archivoUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium">
              <ExternalLink size={12} /> Ver PDF del documento
            </a>
          ) : (
            <a href={archivoUrl} target="_blank" rel="noreferrer">
              <img src={archivoUrl} alt="Documento" className="h-16 rounded-lg border border-slate-200 object-cover" />
            </a>
          )}
          <span className="text-[10px] text-emerald-600 flex items-center gap-1">
            <FileCheck size={11} /> Archivo subido
          </span>
        </div>
      )}

      {/* Botón de upload */}
      <label className={`inline-flex items-center gap-1.5 cursor-pointer text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
        subiendo ? 'bg-slate-50 text-slate-400 border-slate-200' : 'bg-white text-blue-600 border-blue-200 hover:bg-blue-50'
      }`}>
        <Upload size={12} />
        {subiendo ? 'Subiendo...' : archivoUrl ? 'Reemplazar archivo' : 'Subir foto/PDF'}
        <input type="file" className="hidden" accept="image/*,.pdf" onChange={handleArchivo} disabled={subiendo} />
      </label>
      <p className="text-[10px] text-slate-400 mt-1">JPG, PNG o PDF · máx. 5 MB</p>
      {error  && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
      {exito  && <p className="text-[10px] text-emerald-600 mt-1">✓ Subido correctamente</p>}
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl h-12 animate-pulse" />
      ))}
    </div>
  )
}
