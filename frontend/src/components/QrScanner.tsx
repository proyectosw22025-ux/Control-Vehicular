import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, Loader2, Zap } from 'lucide-react'

interface Props {
  onScan: (text: string) => void
  activo: boolean
}

// Contador para IDs únicos — evita conflictos si hay múltiples instancias
let instanceCounter = 0

export function QrScanner({ onScan, activo }: Props) {
  const [estado, setEstado] = useState<'idle' | 'iniciando' | 'activo' | 'detectado' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const scannerRef  = useRef<Html5Qrcode | null>(null)
  // ID único por instancia — evita conflictos entre GuardiaDashboard y Acceso
  const containerId = useRef(`qr-scan-${++instanceCounter}`)

  useEffect(() => {
    if (!activo) { detener(); return }
    iniciar()
    return () => { detener() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  async function iniciar() {
    setEstado('iniciando')
    setErrorMsg('')
    try {
      const scanner = new Html5Qrcode(containerId.current, { verbose: false })
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({
          fps: 15,                                    // +25% frames vs anterior (12fps)
          qrbox: { width: 250, height: 250 },         // área mayor = detección más fácil
          aspectRatio: 1.0,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        } as any),
        (decoded) => {
          // Feedback visual INMEDIATO antes de cualquier network call
          setEstado('detectado')
          onScan(decoded)
          setTimeout(() => detener(), 200)           // pequeño delay para que el flash se vea
        },
        () => { /* frames sin QR — normal */ }
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
      try { await scannerRef.current.stop() }  catch { /* ya detenido */ }
      try { scannerRef.current.clear() }        catch { /* ignorar */ }
      scannerRef.current = null
    }
    setEstado('idle')
  }

  return (
    <div className="flex flex-col items-center gap-3">

      {/* Área de la cámara */}
      <div className="relative w-full max-w-xs">
        <div
          id={containerId.current}
          className={`rounded-2xl overflow-hidden transition-colors ${
            estado === 'detectado' ? 'bg-green-900' : 'bg-slate-900'
          }`}
          style={{ minHeight: estado === 'activo' || estado === 'iniciando' || estado === 'detectado' ? 290 : 0 }}
        />

        {/* Overlay de esquinas + línea cuando activo */}
        {estado === 'activo' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative w-60 h-60">
              {/* Esquinas blancas */}
              {[
                'top-0 left-0 border-t-4 border-l-4 rounded-tl-xl',
                'top-0 right-0 border-t-4 border-r-4 rounded-tr-xl',
                'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl',
                'bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl',
              ].map((cls, i) => (
                <div key={i} className={`absolute w-9 h-9 border-white/90 ${cls}`} />
              ))}
              {/* Línea de escaneo animada — CSS puro, no afecta al scanner */}
              <div className="absolute left-2 right-2 h-0.5 bg-orange-400/90 animate-bounce"
                style={{ top: '50%', animationDuration: '1.5s' }} />
            </div>
          </div>
        )}

        {/* Flash verde cuando se detecta el QR */}
        {estado === 'detectado' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-green-500/30 rounded-2xl gap-3">
            <Zap size={48} className="text-green-300" />
            <p className="text-white font-bold text-sm">QR detectado ✓</p>
          </div>
        )}

        {/* Iniciando cámara */}
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
          <p className="text-red-700 text-xs font-medium">{errorMsg}</p>
          <p className="text-red-500 text-[10px] mt-1">
            Intenta cerrar otras apps que usen la cámara y vuelve a activar el escáner.
          </p>
        </div>
      )}

      {/* Instrucción contextual */}
      {estado === 'activo' && (
        <div className="text-center">
          <p className="text-xs text-slate-600 font-medium">
            Centra el QR dentro del recuadro blanco
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            El acceso se registrará automáticamente
          </p>
        </div>
      )}
    </div>
  )
}
