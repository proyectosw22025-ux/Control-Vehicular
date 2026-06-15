/**
 * DatePicker — reemplazo del <input type="date"> nativo (inconsistente entre
 * navegadores/OS) por un calendario propio con react-day-picker.
 *
 * API drop-in: `value`/`onChange` usan el MISMO string 'YYYY-MM-DD' que el input
 * nativo, así que la lógica de los formularios (que arma ISO datetimes) no cambia.
 */
import { useEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { format, parse, isValid } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar, ChevronDown } from 'lucide-react'
import 'react-day-picker/style.css'

interface Props {
  value: string                       // 'YYYY-MM-DD' o ''
  onChange: (value: string) => void   // emite 'YYYY-MM-DD'
  min?: string                        // 'YYYY-MM-DD'
  max?: string
  placeholder?: string
  className?: string
  size?: 'sm' | 'md'
  /** Borde rojo para validación (ej. fecha vencida obligatoria). */
  error?: boolean
}

const toDate = (s?: string) => {
  if (!s) return undefined
  const d = parse(s, 'yyyy-MM-dd', new Date())
  return isValid(d) ? d : undefined
}

export function DatePicker({
  value, onChange, min, max, placeholder = 'Seleccionar fecha',
  className = '', size = 'md', error,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = toDate(value)
  const pad = size === 'sm' ? 'px-3 py-2 text-sm' : 'px-3.5 py-2.5 text-sm'

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const minD = toDate(min)
  const maxD = toDate(max)
  const disabled = [
    ...(minD ? [{ before: minD }] : []),
    ...(maxD ? [{ after: maxD }] : []),
  ]

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between gap-2 border-2 rounded-xl ${pad} outline-none transition-colors bg-slate-50 ${
          error ? 'border-red-400 bg-red-50'
            : open ? 'border-blue-400 bg-white' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Calendar size={15} className="text-slate-400 shrink-0" />
          <span className={`truncate ${selected ? 'text-slate-800' : 'text-slate-400'}`}>
            {selected ? format(selected, "d 'de' MMMM, yyyy", { locale: es }) : placeholder}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg p-2">
          <DayPicker
            mode="single"
            locale={es}
            selected={selected}
            defaultMonth={selected}
            disabled={disabled}
            onSelect={(d) => { if (d) { onChange(format(d, 'yyyy-MM-dd')); setOpen(false) } }}
          />
        </div>
      )}
    </div>
  )
}
