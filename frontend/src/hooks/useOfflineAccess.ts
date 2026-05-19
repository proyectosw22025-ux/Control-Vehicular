/**
 * Hook que registra el Service Worker y gestiona el estado offline del Panel Guardia.
 *
 * Expone:
 *   - online: boolean — conectividad actual
 *   - pendientes: number — accesos guardados localmente sin sincronizar
 *   - sincronizando: boolean — sync en progreso
 *   - sincronizarAhora(): dispara sync manual
 */
import { useState, useEffect, useCallback } from 'react'

export function useOfflineAccess() {
  const [online,         setOnline]         = useState(navigator.onLine)
  const [pendientes,     setPendientes]     = useState(0)
  const [sincronizando,  setSincronizando]  = useState(false)
  const [swRegistrado,   setSwRegistrado]   = useState(false)
  const [ultimaSync,     setUltimaSync]     = useState<string | null>(null)

  // Registrar SW al montar
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register('/sw.js')
      .then(reg => {
        setSwRegistrado(true)
        // Escuchar mensajes del SW
        navigator.serviceWorker.addEventListener('message', handleSwMessage)
        // Pedir sync si regresa la red
        window.addEventListener('online',  handleOnline)
        window.addEventListener('offline', handleOffline)
      })
      .catch(err => console.error('[SW] Error al registrar:', err))

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage)
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleSwMessage(event: MessageEvent) {
    const { tipo, pendientes: n, sincronizados } = event.data ?? {}
    switch (tipo) {
      case 'acceso_offline_guardado':
        setPendientes(n ?? 0)
        break
      case 'acceso_registrado_online':
        // acceso confirmado online — no hace falta actualizar pendientes
        break
      case 'sync_completada':
        setSincronizando(false)
        setPendientes(prev => Math.max(0, prev - (sincronizados ?? 0)))
        setUltimaSync(new Date().toLocaleTimeString('es-BO'))
        break
    }
  }

  function handleOnline()  { setOnline(true);  dispararSync() }
  function handleOffline() { setOnline(false) }

  const dispararSync = useCallback(() => {
    if (!('serviceWorker' in navigator)) return
    setSincronizando(true)
    navigator.serviceWorker.controller?.postMessage({ tipo: 'sync_ahora' })
    // Timeout de seguridad — si el SW no responde en 10s, quitar el spinner
    setTimeout(() => setSincronizando(false), 10_000)
  }, [])

  const sincronizarAhora = useCallback(() => {
    if (!online) return
    dispararSync()
  }, [online, dispararSync])

  return {
    online,
    pendientes,
    sincronizando,
    swRegistrado,
    ultimaSync,
    sincronizarAhora,
  }
}
