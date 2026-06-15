/**
 * Dropdown — reemplazo del <select> nativo con la estética de la app.
 *
 * Diseñado con criterio sobre el mal uso habitual del <select>:
 *   - `searchable`: para listas largas (vehículos, usuarios, dependencias) donde
 *     el select nativo obliga a desplazarse a ciegas. Filtra por label y hint.
 *   - Muestra el LABEL seleccionado, no el value crudo.
 *   - `hint`: texto secundario por opción (ej. CI, placa) para desambiguar.
 *
 * API alineada con un <select> controlado: `value` + `onChange(value)`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
  hint?: string
}

interface Props {
  value: string | null | undefined
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
  searchable?: boolean
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export function Dropdown({
  value, onChange, options, placeholder = 'Seleccionar…',
  searchable, disabled, className = '', size = 'md',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value) || null

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.hint?.toLowerCase().includes(q) ?? false))
  }, [options, query, searchable])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    if (searchable) setTimeout(() => searchRef.current?.focus(), 30)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, searchable])

  const pad = size === 'sm' ? 'px-3 py-2 text-sm' : 'px-3.5 py-2.5 text-sm'

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 border-2 rounded-xl ${pad} outline-none transition-colors bg-slate-50 ${
          open ? 'border-blue-400 bg-white' : 'border-slate-200 hover:border-slate-300'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <span className={`truncate text-left ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[10rem] bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-slate-100">
              <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-2.5 py-1.5">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar…"
                  className="bg-transparent outline-none text-sm w-full"
                />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">Sin resultados</p>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  o.value === value ? 'text-blue-700 font-semibold' : 'text-slate-700'
                }`}
              >
                <span className="truncate">
                  {o.label}
                  {o.hint && <span className="text-slate-400 font-normal ml-1.5 text-xs">{o.hint}</span>}
                </span>
                {o.value === value && <Check size={15} className="shrink-0 text-blue-600" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
