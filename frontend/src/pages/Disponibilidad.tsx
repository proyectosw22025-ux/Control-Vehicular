/**
 * Disponibilidad — Página pública del semáforo de parqueo UAGRM.
 *
 * Accesible SIN login: /disponibilidad
 * El estudiante escanea un QR físico en la entrada del campus y ve en tiempo real
 * cuántos espacios hay disponibles en cada zona antes de entrar.
 *
 * Características:
 *  - Sin layout de la app (no sidebar, no header de sistema)
 *  - Mobile-first: diseñada para celular en 3 segundos
 *  - Polling cada 30s (cache Redis de 30s en el backend)
 *  - QR de esta misma página para que el admin lo imprima y coloque en la entrada
 *  - Meta tags og: para compartir por WhatsApp con información correcta
 */
import { useState, useEffect } from 'react'
import { useQuery } from '@apollo/client'
import { Link } from 'react-router-dom'
import { MapPin, RefreshCw, QrCode, Wifi, WifiOff } from 'lucide-react'
import { DISPONIBILIDAD_ZONAS_QUERY } from '../graphql/queries/parqueos'

const ESTADOS_CONFIG = {
  disponible: { label: 'DISPONIBLE',  emoji: '🟢', bg: '#dcfce7', border: '#22c55e', text: '#166534', barColor: '#22c55e' },
  limitado:   { label: 'LIMITADO',    emoji: '🟡', bg: '#fef9c3', border: '#eab308', text: '#854d0e', barColor: '#eab308' },
  saturado:   { label: 'SATURADO',    emoji: '🟠', bg: '#ffedd5', border: '#f97316', text: '#9a3412', barColor: '#f97316' },
  lleno:      { label: 'SIN ESPACIO', emoji: '🔴', bg: '#fee2e2', border: '#ef4444', text: '#991b1b', barColor: '#ef4444' },
  sin_datos:  { label: 'SIN DATOS',   emoji: '⚪', bg: '#f1f5f9', border: '#94a3b8', text: '#475569', barColor: '#94a3b8' },
}

function tiempoDesde(isoStr: string): string {
  if (!isoStr) return '—'
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 5)  return 'Ahora mismo'
  if (diff < 60) return `Hace ${diff}s`
  return `Hace ${Math.floor(diff / 60)}min`
}

export default function Disponibilidad() {
  const [showQr, setShowQr]     = useState(false)
  const [qrUrl,  setQrUrl]      = useState('')
  const [ahora,  setAhora]      = useState(Date.now())

  // Actualizar reloj "hace Xs" cada 5 segundos
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 5_000)
    return () => clearInterval(t)
  }, [])

  const { data, loading, error, refetch } = useQuery(DISPONIBILIDAD_ZONAS_QUERY, {
    pollInterval:  30_000,
    fetchPolicy:   'network-only',
  })

  const zonas = data?.disponibilidadZonas ?? []
  const ultima = zonas[0]?.ultimaActualizacion ?? ''

  // Generar QR de esta misma página
  useEffect(() => {
    if (!showQr || qrUrl) return
    const url = window.location.origin + '/disponibilidad'
    import('qrcode').then(QR =>
      QR.toDataURL(url, { width: 200, margin: 2, errorCorrectionLevel: 'H' })
        .then(setQrUrl)
    )
  }, [showQr, qrUrl])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <MapPin size={18} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-tight">Parqueo Campus UAGRM</p>
              <p className="text-slate-400 text-[10px]">Disponibilidad en tiempo real</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => refetch()}
              className="text-slate-400 hover:text-white transition-colors p-1.5">
              <RefreshCw size={15} />
            </button>
            <button onClick={() => setShowQr(v => !v)}
              className="text-slate-400 hover:text-white transition-colors p-1.5">
              <QrCode size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">

        {/* Estado de conexión */}
        {!loading && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-slate-400">
              {error ? <WifiOff size={11} className="text-red-400" /> : <Wifi size={11} className="text-emerald-400" />}
              {error
                ? <span className="text-red-400">Sin conexión — mostrando último dato</span>
                : <span>Actualiza cada 30 segundos</span>}
            </div>
            {ultima && (
              <span className="text-slate-500">{tiempoDesde(ultima)}</span>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !zonas.length && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 bg-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        )}

        {/* Tarjetas de zonas */}
        {zonas.map((zona: any) => {
          const cfg = ESTADOS_CONFIG[zona.estado as keyof typeof ESTADOS_CONFIG] ?? ESTADOS_CONFIG.sin_datos
          const ocupacion = Math.round(100 - zona.porcentajeLibre)
          return (
            <div key={zona.id}
              className="rounded-2xl overflow-hidden shadow-xl border-2"
              style={{ borderColor: cfg.border, background: cfg.bg }}>
              <div className="px-5 pt-5 pb-4">
                {/* Nombre + badge estado */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="font-black text-slate-800 text-lg leading-tight">{zona.nombre}</p>
                    {zona.ubicacion && (
                      <p className="text-slate-500 text-xs mt-0.5">{zona.ubicacion}</p>
                    )}
                  </div>
                  <span className="shrink-0 font-bold text-[11px] px-2.5 py-1 rounded-full border"
                    style={{ color: cfg.text, background: cfg.bg, borderColor: cfg.border }}>
                    {cfg.emoji} {cfg.label}
                  </span>
                </div>

                {/* Número grande */}
                <div className="flex items-end gap-3 mb-4">
                  <span className="font-black leading-none"
                    style={{ fontSize: '64px', color: cfg.border, lineHeight: 1 }}>
                    {zona.libres}
                  </span>
                  <div className="mb-2">
                    <p className="font-semibold text-slate-700 text-sm">espacios libres</p>
                    <p className="text-slate-400 text-xs">de {zona.capacidadTotal} en total</p>
                  </div>
                </div>

                {/* Barra de ocupación */}
                <div>
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>Ocupación: {ocupacion}%</span>
                    {zona.enMantenimiento > 0 && (
                      <span>{zona.enMantenimiento} en mantenimiento</span>
                    )}
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-3">
                    <div
                      className="h-3 rounded-full transition-all duration-700"
                      style={{ width: `${ocupacion}%`, background: cfg.barColor }} />
                  </div>
                </div>
              </div>

              {/* Footer de la tarjeta */}
              {zona.estado === 'lleno' && (
                <div className="px-5 py-2 text-center text-xs font-semibold"
                  style={{ background: cfg.border, color: 'white' }}>
                  Busca parqueo en otra zona
                </div>
              )}
            </div>
          )
        })}

        {/* Leyenda */}
        <div className="bg-slate-800/60 rounded-xl px-4 py-3">
          <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide mb-2">Leyenda</p>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(ESTADOS_CONFIG).filter(([k]) => k !== 'sin_datos').map(([, cfg]) => (
              <div key={cfg.label} className="flex items-center gap-1.5">
                <span className="text-sm">{cfg.emoji}</span>
                <span className="text-slate-400 text-[10px]">{cfg.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Botón al mapa completo */}
        <Link to="/login"
          className="flex items-center justify-center gap-2 w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-sm transition-colors shadow-lg">
          <MapPin size={16} />
          Ver mapa completo de parqueo
        </Link>

        {/* QR de esta página */}
        {showQr && (
          <div className="bg-white rounded-2xl p-6 text-center shadow-xl">
            <p className="text-slate-800 font-bold mb-1">Código QR de esta página</p>
            <p className="text-slate-500 text-xs mb-4">
              Imprime este QR y colócalo en la entrada del campus
            </p>
            {qrUrl ? (
              <img src={qrUrl} alt="QR disponibilidad" className="mx-auto rounded-xl border-4 border-slate-100"
                style={{ width: 180, height: 180 }} />
            ) : (
              <div className="w-44 h-44 mx-auto bg-slate-100 rounded-xl flex items-center justify-center">
                <RefreshCw size={24} className="text-slate-400 animate-spin" />
              </div>
            )}
            <p className="text-slate-400 text-[10px] mt-3 font-mono break-all">
              {window.location.origin}/disponibilidad
            </p>
          </div>
        )}

        <p className="text-center text-slate-600 text-[10px] pb-4">
          Sistema de Control Vehicular · Universidad Autónoma Gabriel René Moreno
        </p>
      </div>
    </div>
  )
}
