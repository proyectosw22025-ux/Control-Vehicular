import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery } from '@apollo/client'
import QRCode from 'qrcode'
import { Shield, ShieldAlert, RefreshCw, Lock } from 'lucide-react'
import { QR_DINAMICO_QUERY } from '../graphql/queries/vehiculos'

interface Props {
  vehiculoId: number
  placa: string
}

export function QrDinamico({ vehiculoId, placa }: Props) {
  const [src, setSrc] = useState('')
  const [generando, setGenerando] = useState(true)
  const [segundos, setSegundos] = useState(30)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data, loading, refetch, error } = useQuery(QR_DINAMICO_QUERY, {
    variables: { vehiculoId },
    fetchPolicy: 'network-only',
  })

  const qrData = data?.qrDinamicoVehiculo

  // Genera la imagen QR a partir del código TOTP recibido
  const generarImagen = useCallback(async (codigo: string) => {
    if (!codigo) return
    setGenerando(true)
    try {
      const url = await QRCode.toDataURL(codigo, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#0f172a', light: '#ffffff' },
      })
      setSrc(url)
    } finally {
      setGenerando(false)
    }
  }, [])

  useEffect(() => {
    if (qrData?.codigo) {
      generarImagen(qrData.codigo)
      setSegundos(qrData.segundosRestantes ?? 30)
    }
  }, [qrData, generarImagen])

  // Cuenta regresiva local — precisa y sin parpadeos
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setSegundos(s => {
        if (s <= 1) {
          // Tiempo agotado: pedir nuevo código al servidor
          refetch()
          return 30
        }
        return s - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [refetch])

  const porcentaje = (segundos / 30) * 100
  const colorBarra = segundos > 15 ? '#22c55e' : segundos > 7 ? '#f59e0b' : '#ef4444'
  const colorTexto = segundos > 15 ? 'text-green-600' : segundos > 7 ? 'text-amber-500' : 'text-red-500'

  if (error) return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <ShieldAlert size={40} className="text-red-400" />
      <p className="text-sm text-red-600 font-medium">No se pudo generar el QR dinámico</p>
      <p className="text-xs text-slate-500">{error.message}</p>
      <button onClick={() => refetch()} className="text-xs text-blue-600 hover:underline">Reintentar</button>
    </div>
  )

  return (
    <div className="flex flex-col items-center gap-4">

      {/* Badge de seguridad */}
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-1.5">
        <Shield size={14} className="text-green-600" />
        <span className="text-xs font-semibold text-green-700">QR Dinámico — Caduca cada 30 segundos</span>
      </div>

      {/* Imagen QR */}
      <div className="relative rounded-2xl overflow-hidden shadow-xl border-4 border-slate-800 bg-white p-3">
        {(generando || loading) ? (
          <div className="flex items-center justify-center bg-slate-50 rounded-xl" style={{ width: 220, height: 220 }}>
            <RefreshCw size={28} className="text-slate-300 animate-spin" />
          </div>
        ) : (
          <img src={src} alt="QR Dinámico" className="rounded-xl" style={{ width: 220, height: 220 }} />
        )}

        {/* Overlay de segundos críticos */}
        {segundos <= 5 && !generando && (
          <div className="absolute inset-0 bg-red-500/10 rounded-2xl flex items-end justify-center pb-4">
            <span className="text-red-600 font-black text-2xl drop-shadow">{segundos}s</span>
          </div>
        )}
      </div>

      {/* Barra de progreso */}
      <div className="w-56">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Lock size={10} /> Válido por
          </span>
          <span className={`text-sm font-bold tabular-nums ${colorTexto}`}>
            {segundos}s
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${porcentaje}%`, backgroundColor: colorBarra }}
          />
        </div>
      </div>

      {/* Placa */}
      <div className="bg-slate-800 text-white rounded-xl px-6 py-2 font-mono font-bold text-lg tracking-widest">
        {placa}
      </div>

      {/* Aviso de seguridad */}
      <p className="text-xs text-slate-400 text-center max-w-xs leading-relaxed">
        Este código es único para tu vehículo y cambia automáticamente.
        No lo compartas ni lo imprimas — pierde validez en segundos.
      </p>
    </div>
  )
}
