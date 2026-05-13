import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import type { ToastItem } from '../hooks/useToast'

const CONFIG = {
  success: { bg: 'bg-emerald-600', icon: CheckCircle,    border: 'border-emerald-500' },
  error:   { bg: 'bg-red-600',     icon: XCircle,        border: 'border-red-500' },
  info:    { bg: 'bg-blue-600',    icon: Info,           border: 'border-blue-500' },
  warning: { bg: 'bg-amber-500',   icon: AlertTriangle,  border: 'border-amber-400' },
}

interface Props {
  toasts: ToastItem[]
  onClose: (id: number) => void
}

export function ToastContainer({ toasts, onClose }: Props) {
  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-xs sm:max-w-sm pointer-events-none">
      {toasts.map(t => {
        const { bg, icon: Icon, border } = CONFIG[t.tipo]
        return (
          <div
            key={t.id}
            className={`${bg} border ${border} text-white rounded-xl shadow-2xl p-4
                        flex gap-3 items-start pointer-events-auto
                        animate-in slide-in-from-right-4 duration-300`}
          >
            <Icon size={18} className="shrink-0 mt-0.5 opacity-90" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm leading-tight">{t.titulo}</p>
              {t.mensaje && (
                <p className="text-xs mt-0.5 opacity-85 leading-relaxed">{t.mensaje}</p>
              )}
            </div>
            <button
              onClick={() => onClose(t.id)}
              className="text-white/70 hover:text-white shrink-0 mt-0.5"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
