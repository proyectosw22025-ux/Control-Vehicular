/**
 * DestinoSelector — elige entre anfitrión (persona) o dependencia (oficina/área).
 *
 * Resuelve el caso real: un visitante que no conoce a nadie específico
 * va a "Secretaría de Admisiones" o "Biblioteca", no a una persona concreta.
 */
import { useState } from 'react'
import { useQuery } from '@apollo/client'
import { User, Building2, Search, X, MapPin } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { AnfitrionCombobox } from './AnfitrionCombobox'
import { DEPENDENCIAS_QUERY } from '../graphql/queries/visitantes'

type Dependencia = { id: number; nombre: string; codigo: string; descripcion: string; ubicacion: string }

type Modo = 'anfitrion' | 'dependencia'

interface Props {
  anfitrionId: number | null
  dependenciaId: number | null
  onAnfitrionChange: (id: number | null) => void
  onDependenciaChange: (id: number | null) => void
}

export function DestinoSelector({ anfitrionId, dependenciaId, onAnfitrionChange, onDependenciaChange }: Props) {
  const [modo, setModo]                   = useState<Modo>('dependencia')
  const [busqueda, setBusqueda]           = useState('')
  const [depSel, setDepSel]              = useState<Dependencia | null>(null)

  const busquedaDebounced = useDebounce(busqueda, 300)

  const { data } = useQuery(DEPENDENCIAS_QUERY, {
    variables: { buscar: busquedaDebounced || undefined },
    fetchPolicy: 'cache-and-network',
    skip: modo !== 'dependencia',
  })

  const dependencias: Dependencia[] = data?.dependenciasUagrm ?? []

  function seleccionarDep(d: Dependencia) {
    setDepSel(d)
    setBusqueda('')
    onDependenciaChange(d.id)
    onAnfitrionChange(null)
  }

  function limpiarDep() {
    setDepSel(null)
    onDependenciaChange(null)
  }

  function cambiarModo(m: Modo) {
    setModo(m)
    // Limpiar el otro modo al cambiar
    if (m === 'anfitrion') { setDepSel(null); onDependenciaChange(null) }
    if (m === 'dependencia') { onAnfitrionChange(null) }
  }

  return (
    <div className="space-y-2">
      {/* Toggle modo */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cambiarModo('dependencia')}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
            modo === 'dependencia'
              ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
              : 'border-slate-200 text-slate-500 hover:border-slate-300'
          }`}
        >
          <Building2 size={15} className="shrink-0" />
          <div className="text-left">
            <p className="text-xs font-semibold leading-tight">Oficina / Área</p>
            <p className="text-[10px] opacity-70 leading-tight">No conoce a nadie</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => cambiarModo('anfitrion')}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
            modo === 'anfitrion'
              ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
              : 'border-slate-200 text-slate-500 hover:border-slate-300'
          }`}
        >
          <User size={15} className="shrink-0" />
          <div className="text-left">
            <p className="text-xs font-semibold leading-tight">Persona específica</p>
            <p className="text-[10px] opacity-70 leading-tight">Visita a alguien en UAGRM</p>
          </div>
        </button>
      </div>

      {/* Selector de dependencia */}
      {modo === 'dependencia' && (
        depSel ? (
          <div className="flex items-start gap-2 border border-cyan-400 rounded-xl px-3 py-2.5 bg-cyan-50">
            <div className="bg-cyan-100 p-1.5 rounded-lg shrink-0 mt-0.5">
              <Building2 size={14} className="text-cyan-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-cyan-800 leading-tight">{depSel.nombre}</p>
              {depSel.ubicacion && (
                <p className="text-[11px] text-cyan-600 mt-0.5 flex items-center gap-1">
                  <MapPin size={9} /> {depSel.ubicacion}
                </p>
              )}
            </div>
            <button type="button" onClick={limpiarDep} className="text-cyan-400 hover:text-cyan-700 shrink-0">
              <X size={15} />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar oficina, facultad o área..."
                className="w-full pl-9 border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-slate-200 bg-white p-1">
              {dependencias.length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">
                  {busqueda ? `Sin resultados para "${busqueda}"` : 'Escribe para buscar'}
                </p>
              )}
              {dependencias.map(d => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => seleccionarDep(d)}
                  className="w-full text-left px-3 py-2 hover:bg-cyan-50 rounded-lg transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono shrink-0 mt-0.5">
                      {d.codigo}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 leading-tight truncate">{d.nombre}</p>
                      {d.ubicacion && (
                        <p className="text-[10px] text-slate-400 leading-tight">{d.ubicacion}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {/* Selector de anfitrión */}
      {modo === 'anfitrion' && (
        <AnfitrionCombobox
          value={anfitrionId}
          onChange={(id) => { onAnfitrionChange(id); onDependenciaChange(null) }}
          placeholder="Escribe el nombre o CI del docente/administrativo..."
        />
      )}
    </div>
  )
}
