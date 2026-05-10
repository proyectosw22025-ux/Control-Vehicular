import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import {
  ArrowLeft, Car, DoorOpen, AlertTriangle, ParkingSquare, Clock, RefreshCw,
} from 'lucide-react'
import { VEHICULO_QUERY } from '../graphql/queries/vehiculos'
import { REGISTROS_ACCESO_QUERY } from '../graphql/queries/acceso'
import { MULTAS_VEHICULO_QUERY } from '../graphql/queries/multas'
import { HISTORIAL_SESIONES_QUERY } from '../graphql/queries/parqueos'

type Tab = 'accesos' | 'multas' | 'sesiones'

const ESTADO_BADGE: Record<string, string> = {
  pendiente:  'bg-amber-100 text-amber-700',
  activo:     'bg-green-100 text-green-700',
  inactivo:   'bg-slate-100 text-slate-600',
  sancionado: 'bg-red-100 text-red-700',
}
const MULTA_BADGE: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  pagada:    'bg-green-100 text-green-700',
  apelada:   'bg-blue-100 text-blue-700',
  cancelada: 'bg-slate-100 text-slate-500',
}
const METODO_LABEL: Record<string, string> = {
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
  const { data: acData, loading: acLoad, refetch: refetchAc } = useQuery(REGISTROS_ACCESO_QUERY, {
    variables: { vehiculoId: id, limite: 100 },
    skip: !id || tab !== 'accesos',
    fetchPolicy: 'cache-and-network',
  })
  const { data: muData, loading: muLoad, refetch: refetchMu } = useQuery(MULTAS_VEHICULO_QUERY, {
    variables: { vehiculoId: id },
    skip: !id || tab !== 'multas',
    fetchPolicy: 'cache-and-network',
  })
  const { data: seData, loading: seLoad, refetch: refetchSe } = useQuery(HISTORIAL_SESIONES_QUERY, {
    variables: { vehiculoId: id, limite: 100 },
    skip: !id || tab !== 'sesiones',
    fetchPolicy: 'cache-and-network',
  })

  const vehiculo = vData?.vehiculo
  const accesos  = acData?.registrosAcceso ?? []
  const multas   = muData?.multasVehiculo ?? []
  const sesiones = seData?.historialSesiones ?? []

  const tabLoad = tab === 'accesos' ? acLoad : tab === 'multas' ? muLoad : seLoad
  function refetchTab() {
    if (tab === 'accesos') refetchAc()
    else if (tab === 'multas') refetchMu()
    else refetchSe()
  }

  if (vLoad) {
    return (
      <div className="p-8">
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
    <div className="p-8">
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

      {/* Tabs */}
      <div className="flex gap-0 mb-4 border-b border-slate-200">
        <TabBtn active={tab === 'accesos'} onClick={() => setTab('accesos')}>
          <DoorOpen size={14} /> Accesos ({acLoad ? '…' : accesos.length})
        </TabBtn>
        <TabBtn active={tab === 'multas'} onClick={() => setTab('multas')}>
          <AlertTriangle size={14} /> Multas ({muLoad ? '…' : multas.length})
        </TabBtn>
        <TabBtn active={tab === 'sesiones'} onClick={() => setTab('sesiones')}>
          <ParkingSquare size={14} /> Sesiones de parqueo ({seLoad ? '…' : sesiones.length})
        </TabBtn>
      </div>

      {/* ── Accesos ── */}
      {tab === 'accesos' && (
        acLoad ? <SkeletonRows /> :
        accesos.length === 0 ? (
          <EmptyState icon={DoorOpen} text="Sin registros de acceso" />
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
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
                    <td className="px-4 py-3 text-slate-400 text-xs">{a.observacion || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Multas ── */}
      {tab === 'multas' && (
        muLoad ? <SkeletonRows /> :
        multas.length === 0 ? (
          <EmptyState icon={AlertTriangle} text="Sin multas registradas" />
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Fecha</th>
                  <th className="px-4 py-3 text-left">Tipo</th>
                  <th className="px-4 py-3 text-left">Descripción</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3 text-left">Estado</th>
                  <th className="px-4 py-3 text-left">Registrado por</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {multas.map((m: any) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-slate-500 text-xs">{fmt(m.fecha)}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs">{m.tipo?.nombre}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs max-w-xs truncate">{m.descripcion}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">Bs {Number(m.monto).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MULTA_BADGE[m.estado] ?? 'bg-slate-100 text-slate-500'}`}>
                        {m.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{m.registradoPorNombre ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Sesiones de parqueo ── */}
      {tab === 'sesiones' && (
        seLoad ? <SkeletonRows /> :
        sesiones.length === 0 ? (
          <EmptyState icon={ParkingSquare} text="Sin sesiones de parqueo" />
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
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
        )
      )}
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
