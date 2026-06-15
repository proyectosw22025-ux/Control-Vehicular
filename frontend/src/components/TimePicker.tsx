/**
 * TimePicker — reemplazo del <input type="time"> nativo. Dos Dropdowns (hora y
 * minuto) reutilizando el componente Dropdown, para look y comportamiento
 * consistentes en toda la app.
 *
 * API drop-in: `value`/`onChange` usan el MISMO string 'HH:MM' que el input nativo.
 */
import { Dropdown } from './Dropdown'

interface Props {
  value: string                       // 'HH:MM' o ''
  onChange: (value: string) => void   // emite 'HH:MM'
  minuteStep?: number
  className?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))

export function TimePicker({ value, onChange, minuteStep = 5, className = '' }: Props) {
  const [h = '', m = ''] = (value || '').split(':')

  const baseMin = Array.from(
    { length: Math.ceil(60 / minuteStep) },
    (_, i) => String(i * minuteStep).padStart(2, '0'),
  )
  // Conservar el minuto actual aunque no caiga en el paso (ej. un valor previo "37").
  const minutes = m && !baseMin.includes(m) ? [...baseMin, m].sort() : baseMin

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Dropdown
        value={h}
        options={HOURS.map(x => ({ value: x, label: x }))}
        placeholder="HH"
        size="sm"
        className="flex-1"
        onChange={(nh) => onChange(`${nh}:${m || '00'}`)}
      />
      <span className="text-slate-400 font-bold">:</span>
      <Dropdown
        value={m}
        options={minutes.map(x => ({ value: x, label: x }))}
        placeholder="MM"
        size="sm"
        className="flex-1"
        onChange={(nm) => onChange(`${h || '00'}:${nm}`)}
      />
    </div>
  )
}
