import { useState } from 'react'
import { useQuery } from '@apollo/client'
import { gql } from '@apollo/client'
import { Shield, RefreshCw, Search } from 'lucide-react'

const AUDIT_LOG_QUERY = gql`
  query AuditLog($limite: Int) {
    auditLog(limite: $limite) {
      id
      accion
      descripcion
      usuarioNombre
      ip
      createdAt
    }
  }
`

const ACCION_BADGE: Record<string, string> = {
  registrar_acceso:    'bg-green-100 text-green-700',
  acceso_manual:       'bg-teal-100 text-teal-700',
  registrar_multa:     'bg-red-100 text-red-700',
  pagar_multa:         'bg-emerald-100 text-emerald-700',
  aprobar_vehiculo:    'bg-blue-100 text-blue-700',
  rechazar_vehiculo:   'bg-orange-100 text-orange-700',
  crear_zona:          'bg-violet-100 text-violet-700',
  crear_espacio:       'bg-purple-100 text-purple-700',
  login:               'bg-slate-100 text-slate-600',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Auditoria() {
  const [busqueda, setBusqueda] = useState('')
  const [limite, setLimite] = useState(200)

  const { data, loading, refetch } = useQuery(AUDIT_LOG_QUERY, {
    variables: { limite },
    fetchPolicy: 'cache-and-network',
  })

  const logs: any[] = (data?.auditLog ?? []).filter((l: any) => {
    if (!busqueda) return true
    const q = busqueda.toLowerCase()
    return (
      l.accion.includes(q) ||
      l.descripcion.toLowerCase().includes(q) ||
      (l.usuarioNombre || '').toLowerCase().includes(q) ||
      (l.ip || '').includes(q)
    )
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-slate-700 text-white p-2 rounded-xl">
            <Shield size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Auditoría del Sistema</h1>
            <p className="text-slate-500 text-xs">Registro completo de acciones realizadas en el sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={limite}
            onChange={e => setLimite(parseInt(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value={100}>Últimos 100</option>
            <option value={200}>Últimos 200</option>
            <option value={500}>Últimos 500</option>
          </select>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Buscador */}
      <div className="relative max-w-sm mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar acción, usuario, IP..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {/* Estadísticas rápidas */}
      {!loading && data?.auditLog && (
        <div className="flex flex-wrap gap-3 mb-4">
          {Object.entries(
            (data.auditLog as any[]).reduce((acc: Record<string, number>, l: any) => {
              acc[l.accion] = (acc[l.accion] ?? 0) + 1
              return acc
            }, {})
          )
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([accion, count]) => (
              <span key={accion} className={`px-2.5 py-1 rounded-full text-xs font-medium ${ACCION_BADGE[accion] ?? 'bg-slate-100 text-slate-600'}`}>
                {accion.replace(/_/g, ' ')}: {count}
              </span>
            ))}
        </div>
      )}

      {/* Tabla */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl h-12 animate-pulse" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Shield size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{busqueda ? 'Sin resultados para esta búsqueda' : 'No hay registros de auditoría'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Acción</th>
                <th className="px-4 py-3 text-left">Descripción</th>
                <th className="px-4 py-3 text-left">Usuario</th>
                <th className="px-4 py-3 text-left">IP</th>
                <th className="px-4 py-3 text-left">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l: any) => (
                <tr key={l.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${ACCION_BADGE[l.accion] ?? 'bg-slate-100 text-slate-600'}`}>
                      {l.accion.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-xs max-w-xs">{l.descripcion}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{l.usuarioNombre ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{l.ip ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmt(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-400">
            {logs.length} registro{logs.length !== 1 ? 's' : ''}{busqueda ? ` encontrado${logs.length !== 1 ? 's' : ''}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
