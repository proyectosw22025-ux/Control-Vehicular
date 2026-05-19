import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Car, Users, AlertTriangle, UserCheck, Loader2 } from 'lucide-react'
import { useBusquedaGlobal, ResultadoBusqueda } from '../hooks/useBusquedaGlobal'

const TIPO_ICON: Record<string, React.ElementType> = {
  vehiculo:  Car,
  usuario:   Users,
  multa:     AlertTriangle,
  visitante: UserCheck,
}

const TIPO_COLOR: Record<string, string> = {
  vehiculo:  'text-emerald-600 bg-emerald-50',
  usuario:   'text-blue-600 bg-blue-50',
  multa:     'text-amber-600 bg-amber-50',
  visitante: 'text-violet-600 bg-violet-50',
}

const ESTADO_BADGE: Record<string, string> = {
  activo:     'bg-green-100 text-green-700',
  pendiente:  'bg-amber-100 text-amber-700',
  sancionado: 'bg-red-100 text-red-700',
  inactivo:   'bg-slate-100 text-slate-500',
  pagada:     'bg-green-100 text-green-700',
  pagada_revision: 'bg-blue-100 text-blue-700',
}

const HINTS = [
  { prefijo: 'v:', desc: 'solo vehículos' },
  { prefijo: 'u:', desc: 'solo usuarios' },
  { prefijo: 'm:', desc: 'solo multas' },
  { prefijo: 'vis:', desc: 'solo visitantes' },
]

interface Props {
  onClose: () => void
}

export default function BusquedaGlobalModal({ onClose }: Props) {
  const navigate  = useNavigate()
  const inputRef  = useRef<HTMLInputElement>(null)
  const { termino, grupos, cargando, totalResultados, buscar, limpiar } = useBusquedaGlobal()
  const [cursor, setCursor] = useState(-1)

  // Aplanar resultados para navegación con teclado
  const todosResultados: ResultadoBusqueda[] = grupos.flatMap(g => g.items)

  // Auto-focus al montar
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Cerrar con Escape
  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Reset cursor cuando cambian los resultados
  useEffect(() => { setCursor(-1) }, [grupos])

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, todosResultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, -1))
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault()
      seleccionar(todosResultados[cursor])
    }
  }

  function seleccionar(res: ResultadoBusqueda) {
    limpiar()
    onClose()
    navigate(res.url)
  }

  let cursorGlobal = -1

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-start justify-center pt-[10vh] px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-flip-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          {cargando
            ? <Loader2 size={18} className="text-slate-400 shrink-0 animate-spin" />
            : <Search size={18} className="text-slate-400 shrink-0" />}
          <input
            ref={inputRef}
            type="text"
            value={termino}
            onChange={e => buscar(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar vehículo, usuario, multa... (v: u: m: vis:)"
            className="flex-1 text-sm outline-none placeholder:text-slate-400 bg-transparent"
          />
          {termino && (
            <button onClick={() => { limpiar(); inputRef.current?.focus() }}
              className="text-slate-400 hover:text-slate-600 shrink-0">
              <X size={16} />
            </button>
          )}
          <kbd className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5 font-mono shrink-0">
            ESC
          </kbd>
        </div>

        {/* Resultados */}
        <div className="max-h-[60vh] overflow-y-auto">
          {termino.length >= 2 && !cargando && totalResultados === 0 && (
            <div className="py-12 text-center text-slate-400">
              <Search size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin resultados para "{termino}"</p>
            </div>
          )}

          {grupos.map(grupo => {
            const Icon = TIPO_ICON[grupo.tipo] ?? Search
            const colorCls = TIPO_COLOR[grupo.tipo] ?? 'text-slate-600 bg-slate-50'
            return (
              <div key={grupo.tipo}>
                {/* Cabecera de grupo */}
                <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <span className={`p-1 rounded-lg ${colorCls}`}>
                    <Icon size={12} />
                  </span>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {grupo.label}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">{grupo.items.length}</span>
                </div>
                {/* Items */}
                {grupo.items.map(res => {
                  cursorGlobal++
                  const idx = cursorGlobal
                  const activo = idx === cursor
                  return (
                    <button
                      key={`${res.tipo}-${res.id}`}
                      onClick={() => seleccionar(res)}
                      onMouseEnter={() => setCursor(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50 last:border-0
                        ${activo ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                    >
                      <div className={`p-1.5 rounded-lg shrink-0 ${colorCls}`}>
                        <Icon size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{res.titulo}</p>
                        {res.subtitulo && (
                          <p className="text-xs text-slate-500 truncate">{res.subtitulo}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {res.meta && (
                          <span className="text-xs text-slate-400">{res.meta}</span>
                        )}
                        {res.estado && ESTADO_BADGE[res.estado] && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${ESTADO_BADGE[res.estado]}`}>
                            {res.estado}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Estado vacío inicial */}
          {!termino && (
            <div className="px-4 py-6">
              <p className="text-xs font-semibold text-slate-400 uppercase mb-3">Prefijos de búsqueda</p>
              <div className="grid grid-cols-2 gap-2">
                {HINTS.map(h => (
                  <button key={h.prefijo}
                    onClick={() => { buscar(h.prefijo + ' '); inputRef.current?.focus() }}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-left transition-colors">
                    <kbd className="text-xs font-mono text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                      {h.prefijo}
                    </kbd>
                    <span className="text-xs text-slate-500">{h.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-slate-100 bg-slate-50">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <kbd className="border border-slate-300 rounded px-1 py-0.5 font-mono text-[10px]">↑↓</kbd>
            <span>navegar</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <kbd className="border border-slate-300 rounded px-1 py-0.5 font-mono text-[10px]">↵</kbd>
            <span>abrir</span>
          </div>
          {totalResultados > 0 && (
            <span className="ml-auto text-xs text-slate-400">{totalResultados} resultado{totalResultados !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  )
}
