/**
 * AnfitrionCombobox — Selector de usuario con búsqueda en tiempo real.
 * Reemplaza el <select> nativo que no escala con 1000+ usuarios.
 *
 * Comportamiento:
 * - El guardia escribe el nombre o CI → resultados filtrados en tiempo real (debounce 350ms)
 * - Máximo 10 resultados por búsqueda (no carga toda la BD)
 * - Si no hay texto, muestra los primeros 8 usuarios ordenados por apellido
 * - Al seleccionar, muestra el nombre y oculta la lista
 * - Clic fuera cierra el dropdown
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@apollo/client'
import { Search, X, ChevronDown, User } from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { USUARIOS_BUSCAR_QUERY } from '../graphql/queries/usuarios'

type Usuario = { id: number; nombreCompleto: string; ci: string; roles: { nombre: string }[] }

interface Props {
  value: number | null
  onChange: (id: number | null, usuario: Usuario | null) => void
  required?: boolean
  placeholder?: string
  name?: string
}

export function AnfitrionCombobox({
  value,
  onChange,
  required = false,
  placeholder = 'Escribe nombre o CI del anfitrión...',
  name = 'anfitrionId',
}: Props) {
  const [inputVal, setInputVal]     = useState('')
  const [abierto, setAbierto]       = useState(false)
  const [seleccionado, setSelected] = useState<Usuario | null>(null)
  const containerRef                = useRef<HTMLDivElement>(null)

  const busquedaDebounced = useDebounce(inputVal, 350)

  const { data, loading } = useQuery(USUARIOS_BUSCAR_QUERY, {
    variables: { buscar: busquedaDebounced || undefined },
    fetchPolicy: 'cache-and-network',
  })

  const usuarios: Usuario[] = (data?.usuarios ?? []).slice(0, 10)

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const seleccionar = useCallback((u: Usuario) => {
    setSelected(u)
    setInputVal('')
    setAbierto(false)
    onChange(u.id, u)
  }, [onChange])

  const limpiar = useCallback(() => {
    setSelected(null)
    setInputVal('')
    onChange(null, null)
  }, [onChange])

  // ── Si ya hay uno seleccionado: muestra la tarjeta con botón de limpiar ──
  if (seleccionado) {
    return (
      <div className="flex items-center gap-2 border border-cyan-400 rounded-xl px-3 py-2.5 bg-cyan-50">
        <input type="hidden" name={name} value={seleccionado.id} />
        <div className="bg-cyan-100 p-1 rounded-lg shrink-0">
          <User size={14} className="text-cyan-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-cyan-800 truncate">{seleccionado.nombreCompleto}</p>
          <p className="text-[11px] text-cyan-600">
            CI: {seleccionado.ci}
            {seleccionado.roles?.[0]?.nombre && ` · ${seleccionado.roles[0].nombre}`}
          </p>
        </div>
        <button type="button" onClick={limpiar} className="text-cyan-400 hover:text-cyan-700 shrink-0 transition-colors" title="Cambiar anfitrión">
          <X size={15} />
        </button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Input oculto para que el form pueda requerir el campo */}
      <input type="hidden" name={name} value={value ?? ''} required={required} />

      {/* Input de búsqueda */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setAbierto(true) }}
          onFocus={() => setAbierto(true)}
          placeholder={placeholder}
          className="w-full pl-9 pr-8 border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      </div>

      {/* Dropdown */}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          {loading && (
            <div className="px-4 py-3 text-xs text-slate-400 text-center">Buscando...</div>
          )}

          {!loading && usuarios.length === 0 && busquedaDebounced && (
            <div className="px-4 py-3 text-xs text-slate-400 text-center">
              No hay usuarios con "{busquedaDebounced}"
            </div>
          )}

          {!loading && usuarios.length === 0 && !busquedaDebounced && (
            <div className="px-4 py-3 text-xs text-slate-400 text-center">
              Escribe para buscar por nombre o CI
            </div>
          )}

          <ul className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            {usuarios.map(u => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => seleccionar(u)}
                  className="w-full text-left px-4 py-2.5 hover:bg-cyan-50 transition-colors flex items-center gap-3"
                >
                  <div className="bg-slate-100 p-1.5 rounded-lg shrink-0">
                    <User size={13} className="text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{u.nombreCompleto}</p>
                    <p className="text-[11px] text-slate-400">
                      CI: {u.ci}
                      {u.roles?.[0]?.nombre && <span className="ml-2 text-cyan-600">{u.roles[0].nombre}</span>}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {usuarios.length === 10 && (
            <div className="px-4 py-2 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100">
              Mostrando 10 resultados. Escribe más para precisar la búsqueda.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
