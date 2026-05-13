import { useState, useCallback } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: number
  tipo: ToastType
  titulo: string
  mensaje?: string
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const mostrar = useCallback((tipo: ToastType, titulo: string, mensaje?: string, duracion = 4000) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, tipo, titulo, mensaje }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duracion)
  }, [])

  const exito   = useCallback((titulo: string, mensaje?: string) => mostrar('success', titulo, mensaje), [mostrar])
  const error   = useCallback((titulo: string, mensaje?: string) => mostrar('error',   titulo, mensaje), [mostrar])
  const info    = useCallback((titulo: string, mensaje?: string) => mostrar('info',    titulo, mensaje), [mostrar])
  const alerta  = useCallback((titulo: string, mensaje?: string) => mostrar('warning', titulo, mensaje), [mostrar])
  const cerrar  = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  return { toasts, exito, error, info, alerta, cerrar }
}
