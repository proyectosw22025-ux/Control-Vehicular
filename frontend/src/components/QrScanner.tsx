import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, Loader2 } from 'lucide-react'

interface Props {
  onScan: (text: string) => void
  activo: boolean
}

export function QrScanner({ onScan, activo }: Props) {
  const [estado, setEstado] = useState<'idle' | 'iniciando' | 'activo' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const containerId = 'qr-scanner-container'

  useEffect(() => {
    if (!activo) {
      detener()
      return
    }
    iniciar()
    return () => { detener() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  async function iniciar() {
    setEstado('iniciando')
    setErrorMsg('')
    try {
      const scanner = new Html5Qrcode(containerId, { verbose: false })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        (decoded) => {
          onScan(decoded)
          // Flash de éxito
          setEstado('idle')
          detener()
        },
        () => { /* frames sin QR — ignorar */ }
      )
      setEstado('activo')
    } catch (err: any) {
      const msg = err?.message?.includes('permission')
        ? 'Permiso de cámara denegado. Habilítalo en la configuración del navegador.'
        : 'No se pudo acceder a la cámara. Verifica que no esté en uso por otra app.'
      setErrorMsg(msg)
      setEstado('error')
    }
  }

  async function detener() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop() } catch { /* ya detenido */ }
      try { scannerRef.current.clear() } catch { /* ignorar */ }
      scannerRef.current = null
    }
    setEstado('idle')
  }

  return (
    <div className="flex flex-col items-center gap-3">

      {/* Área de la cámara */}
      <div className="relative w-full max-w-xs">
        {/* Contenedor donde html5-qrcode inyecta el video */}
        <div
          id={containerId}
          className="rounded-2xl overflow-hidden bg-slate-900"
          style={{ minHeight: estado === 'activo' || estado === 'iniciando' ? 280 : 0 }}
        />

        {/* Overlay de esquinas cuando la cámara está activa */}
        {estado === 'activo' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative w-56 h-56">
              {/* Esquinas decorativas */}
              {[
                'top-0 left-0 border-t-4 border-l-4 rounded-tl-xl',
                'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
                'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl',
                'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-8 h-8 border-white/80 ${cls}`} />
              ))}
              {/* Línea de escaneo animada */}
              <div className="absolute left-2 right-2 h-0.5 bg-orange-400/80 top-1/2 animate-pulse" />
            </div>
          </div>
        )}

        {/* Estado: iniciando */}
        {estado === 'iniciando' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 rounded-2xl gap-2">
            <Loader2 size={28} className="text-orange-400 animate-spin" />
            <p className="text-white text-xs">Iniciando cámara...</p>
          </div>
        )}
      </div>

      {/* Error de cámara */}
      {estado === 'error' && (
        <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <CameraOff size={24} className="mx-auto mb-2 text-red-400" />
          <p className="text-red-700 text-xs">{errorMsg}</p>
        </div>
      )}

      {/* Instrucción */}
      {estado === 'activo' && (
        <p className="text-xs text-slate-500 text-center">
          Apunta la cámara al código QR del vehículo.<br />
          El acceso se registrará automáticamente al detectarlo.
        </p>
      )}
    </div>
  )
}
