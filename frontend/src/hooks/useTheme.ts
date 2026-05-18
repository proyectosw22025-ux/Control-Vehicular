/**
 * useTheme — gestiona modo claro/oscuro con persistencia en localStorage.
 *
 * Detección automática por horario:
 *   6:00 PM – 5:59 AM → oscuro
 *   6:00 AM – 5:59 PM → claro
 *
 * La preferencia manual sobreescribe la automática y persiste entre sesiones.
 */
import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark' | 'auto'

const STORAGE_KEY = 'uagrm_theme'

function getAutoTheme(): 'light' | 'dark' {
  const hora = new Date().getHours()
  return hora >= 18 || hora < 6 ? 'dark' : 'light'
}

function getResolvedTheme(pref: Theme): 'light' | 'dark' {
  return pref === 'auto' ? getAutoTheme() : pref
}

function applyTheme(resolved: 'light' | 'dark') {
  const html = document.documentElement
  if (resolved === 'dark') {
    html.classList.add('dark')
  } else {
    html.classList.remove('dark')
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<Theme>(() => {
    return (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'auto'
  })

  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    getResolvedTheme((localStorage.getItem(STORAGE_KEY) as Theme) ?? 'auto')
  )

  // Aplicar tema al montar y cuando cambia la preferencia
  useEffect(() => {
    const r = getResolvedTheme(preference)
    setResolved(r)
    applyTheme(r)
    localStorage.setItem(STORAGE_KEY, preference)
  }, [preference])

  // Actualizar si cambia en otra pestaña
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        const pref = e.newValue as Theme
        setPreference(pref)
        applyTheme(getResolvedTheme(pref))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Si es 'auto', recalcular cada hora
  useEffect(() => {
    if (preference !== 'auto') return
    const id = setInterval(() => {
      const r = getAutoTheme()
      setResolved(r)
      applyTheme(r)
    }, 60_000)
    return () => clearInterval(id)
  }, [preference])

  return {
    preference,
    resolved,
    isDark: resolved === 'dark',
    setTheme: (t: Theme) => setPreference(t),
    toggle: () => setPreference(p => p === 'dark' ? 'light' : p === 'light' ? 'dark' : 'light'),
  }
}
