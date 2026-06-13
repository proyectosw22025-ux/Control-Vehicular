/**
 * Typeahead de vehículos server-side.
 *
 * Reemplaza el <select> que cargaba hasta 200 vehículos de golpe — inusable con
 * una flota real de miles. El guardia teclea la placa (o marca/dueño) y el
 * backend devuelve los primeros coincidentes vía `vehiculos(buscar:...)`, con
 * debounce para no consultar en cada tecla.
 */
import { useState, useEffect, useRef } from 'react'
import { useLazyQuery } from '@apollo/client'
import { Car, Loader2, X } from 'lucide-react'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'

interface Props {
  /** Si se pasa, restringe la búsqueda a los vehículos de ese propietario. */
  propietarioId?: number
  seleccionado: any | null
  onSelect: (vehiculo: any | null) => void
}

export function BuscadorVehiculo({ propietarioId, seleccionado, onSelect }: Props) {
  const [texto, setTexto]     = useState('')
  const [abierto, setAbierto] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contenedorRef = useRef<HTMLDivElement>(null)

  const [buscar, { data, loading }] = useLazyQuery(VEHICULOS_QUERY, {
    fetchPolicy: 'network-only',
  })
  const resultados = data?.vehiculos?.items ?? []

  // Búsqueda con debounce: 300ms tras la última tecla.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = texto.trim()
    if (q.length < 2) return  // evita consultas con 1 carácter
    debounceRef.current = setTimeout(() => {
      buscar({ variables: { buscar: q, estado: 'activo', porPagina: 8, propietarioId } })
      setAbierto(true)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [texto, propietarioId, buscar])

  // Cerrar el dropdown al hacer clic fuera.
  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [])

  const elegir = (v: any) => {
    onSelect(v)
    setTexto('')
    setAbierto(false)
  }

  const cls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400'

  // Vehículo ya seleccionado: mostrar como chip con botón de cambiar.
  if (seleccionado) {
    return (
      <div className="flex items-center justify-between gap-2 border border-violet-200 bg-violet-50 rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Car size={14} className="text-violet-500 shrink-0" />
          <span className="font-mono font-bold text-sm text-slate-800">{seleccionado.placa}</span>
          <span className="text-xs text-slate-500 truncate">{seleccionado.marca} {seleccionado.modelo}</span>
        </div>
        <button type="button" onClick={() => onSelect(null)}
          className="text-slate-400 hover:text-slate-600 shrink-0" aria-label="Cambiar vehículo">
          <X size={15} />
        </button>
      </div>
    )
  }

  return (
    <div ref={contenedorRef} className="relative">
      <input
        type="text"
        value={texto}
        onChange={e => setTexto(e.target.value.toUpperCase())}
        onFocus={() => { if (resultados.length) setAbierto(true) }}
        placeholder="Buscar por placa, marca o propietario..."
        className={cls}
        autoComplete="off"
      />
      {loading && (
        <Loader2 size={15} className="animate-spin text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
      )}

      {abierto && texto.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto scrollbar-slim-light">
          {loading ? (
            <p className="px-3 py-3 text-xs text-slate-400">Buscando…</p>
          ) : resultados.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-400">Sin coincidencias para "{texto.trim()}"</p>
          ) : (
            resultados.map((v: any) => (
              <button key={v.id} type="button" onClick={() => elegir(v)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-violet-50 text-left transition-colors border-b border-slate-50 last:border-0">
                <span className="font-mono font-bold text-sm text-slate-800">{v.placa}</span>
                <span className="text-xs text-slate-500 truncate">
                  {v.marca} {v.modelo} ({v.anio}) · {v.propietarioNombre}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
