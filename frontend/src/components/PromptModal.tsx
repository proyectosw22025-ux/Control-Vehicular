/**
 * Modal de entrada de texto — reemplazo de window.prompt() con la estética de la
 * app (Tailwind + lucide), sin el cuadro nativo del navegador.
 *
 * Controlado: el padre maneja `open` y recibe el valor en onConfirmar.
 */
import { useEffect, useRef, useState } from 'react'
import { X, Check } from 'lucide-react'

interface Props {
  open: boolean
  titulo: string
  mensaje?: string
  placeholder?: string
  confirmLabel?: string
  /** Botón de confirmar en rojo, para acciones sensibles (alerta, bloqueo). */
  peligro?: boolean
  onConfirmar: (valor: string) => void
  onCancelar: () => void
}

export function PromptModal({
  open, titulo, mensaje, placeholder,
  confirmLabel = 'Confirmar', peligro, onConfirmar, onCancelar,
}: Props) {
  const [valor, setValor] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValor('')
      // Foco tras el render del modal.
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancelar])

  if (!open) return null

  const confirmar = () => { if (valor.trim()) onConfirmar(valor.trim()) }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancelar}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold text-slate-800 leading-snug">{titulo}</h3>
          <button onClick={onCancelar} className="text-slate-400 hover:text-slate-600 shrink-0">
            <X size={18} />
          </button>
        </div>
        {mensaje && <p className="text-sm text-slate-500 mt-1">{mensaje}</p>}
        <input
          ref={inputRef}
          value={valor}
          onChange={e => setValor(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirmar() }}
          placeholder={placeholder}
          className="mt-3 w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <div className="flex gap-2 mt-4">
          <button
            onClick={onCancelar}
            className="flex-1 py-2 rounded-xl border border-slate-300 text-slate-600 text-sm hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            disabled={!valor.trim()}
            onClick={confirmar}
            className={`flex-1 py-2 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-colors ${
              peligro ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-800 hover:bg-slate-900'
            }`}
          >
            <Check size={15} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
