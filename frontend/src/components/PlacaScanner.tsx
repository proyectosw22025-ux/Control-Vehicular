/**
 * PlacaScanner v3 — FastALPR backend + multi-frame + badge de confianza.
 *
 * Flujo mejorado:
 *   1. Cámara captura frames cada 1s
 *   2. Acumula 3 frames y los envía juntos al backend (modo multi-frame)
 *   3. FastALPR: YOLO v9 detecta la placa → OCR lee el recorte limpio
 *   4. Si confianza >= 0.85 → auto-confirma (verde)
 *      Si confianza 0.60-0.84 → muestra "Revisar" (amarillo) — guardia confirma
 *      Si confianza < 0.60 → rechaza, pide nueva foto (rojo)
 *
 * Compatibilidad: interfaz idéntica al scanner anterior.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera, CameraOff, Check, RefreshCw, Loader2, FileText, Zap } from 'lucide-react'
import { useOcrPlaca, type ResultadoOcr } from '../hooks/useOcrPlaca'

const PLACA_RE     = /^[A-Z]{2,4}[-\s]?\d{3,4}[A-Z]?$/i
const FRAMES_BATCH = 3     // frames por lote enviado al backend
const CAPTURA_MS   = 800   // captura un frame cada 800ms

interface Props {
  activo: boolean
  onPlacaDetectada: (placa: string) => void
}

type Estado = 'idle' | 'iniciando' | 'capturando' | 'procesando' | 'revisar' | 'detectado' | 'error'

const NIVEL_CFG = {
  alto:  { label: '✅ Alta confianza',    badge: 'bg-emerald-100 text-emerald-700', borde: 'border-emerald-400' },
  medio: { label: '⚠ Revisar la placa', badge: 'bg-amber-100 text-amber-700',   borde: 'border-amber-400'   },
  bajo:  { label: '❌ Baja confianza',   badge: 'bg-red-100 text-red-700',       borde: 'border-red-400'     },
}

export function PlacaScanner({ activo, onPlacaDetectada }: Props) {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const streamRef    = useRef<MediaStream | null>(null)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const framesRef    = useRef<string[]>([])
  const procesandoRef = useRef(false)

  const [estado,     setEstado]    = useState<Estado>('idle')
  const [errorMsg,   setErrorMsg]  = useState('')
  const [resultado,  setResultado] = useState<ResultadoOcr | null>(null)
  const [frameCount, setFrameCount]= useState(0)  // frames acumulados (UI dots)

  const { reconocerMultiframe } = useOcrPlaca()

  const detener = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    procesandoRef.current = false
    framesRef.current     = []
    setEstado('idle')
    setResultado(null)
    setFrameCount(0)
  }, [])

  useEffect(() => {
    if (!activo) { detener(); return }
    iniciarCamara()
    return () => detener()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  async function iniciarCamara() {
    setEstado('iniciando')
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setEstado('capturando')
      iniciarCaptura()
    } catch {
      setErrorMsg('No se pudo acceder a la cámara. Verifica los permisos.')
      setEstado('error')
    }
  }

  function capturarFrame(): string | null {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null

    const vw = video.videoWidth, vh = video.videoHeight
    const pw = Math.round(vw * 0.80)
    const ph = Math.round(pw / 3.5)
    const px = Math.round((vw - pw) / 2)
    const py = Math.round((vh - ph) / 2)

    canvas.width  = pw
    canvas.height = ph
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, px, py, pw, ph, 0, 0, pw, ph)

    // Preprocessing: escala de grises + contraste
    const img = ctx.getImageData(0, 0, pw, ph)
    const d   = img.data
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      const c    = Math.min(255, Math.max(0, (gray - 128) * 2.0 + 128))
      d[i] = d[i + 1] = d[i + 2] = c
    }
    ctx.putImageData(img, 0, 0)

    return canvas.toDataURL('image/jpeg', 0.90).split(',')[1]
  }

  function iniciarCaptura() {
    framesRef.current = []
    setFrameCount(0)
    procesandoRef.current = false

    intervalRef.current = setInterval(async () => {
      if (procesandoRef.current) return

      const frame = capturarFrame()
      if (!frame) return

      framesRef.current = [...framesRef.current, frame].slice(-FRAMES_BATCH)
      setFrameCount(framesRef.current.length)

      // Cuando tenemos el lote completo → enviar al backend
      if (framesRef.current.length >= FRAMES_BATCH) {
        procesandoRef.current = true
        clearInterval(intervalRef.current!)
        intervalRef.current = null
        setEstado('procesando')

        const frames = [...framesRef.current]
        framesRef.current = []

        const res = await reconocerMultiframe(frames)

        if (res && res.placa && PLACA_RE.test(res.placa)) {
          setResultado(res)

          if (res.nivel === 'alto') {
            // Alta confianza → auto-confirmar con flash verde
            setEstado('detectado')
            onPlacaDetectada(res.placa)
            setTimeout(() => detener(), 800)
          } else if (res.nivel === 'medio') {
            // Confianza media → guardia confirma
            setEstado('revisar')
          } else {
            // Baja confianza → reintentar automáticamente
            procesandoRef.current = false
            framesRef.current = []
            setEstado('capturando')
            setFrameCount(0)
            iniciarCaptura()
          }
        } else {
          // Sin resultado → seguir capturando
          procesandoRef.current = false
          framesRef.current = []
          setEstado('capturando')
          setFrameCount(0)
          iniciarCaptura()
        }
      }
    }, CAPTURA_MS)
  }

  function confirmar() {
    if (!resultado?.placa) return
    setEstado('detectado')
    onPlacaDetectada(resultado.placa)
    setTimeout(() => detener(), 800)
  }

  function reintentar() {
    setResultado(null)
    framesRef.current = []
    setEstado('capturando')
    setFrameCount(0)
    iniciarCaptura()
  }

  const nivelCfg = resultado ? NIVEL_CFG[resultado.nivel] : null

  return (
    <div className="flex flex-col items-center gap-3 w-full">

      {/* Área de cámara */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '16/9' }}>
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />

        {/* Overlay + guía de encuadre */}
        {(estado === 'capturando' || estado === 'procesando') && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-black/40" />
            <div className="absolute border-4 border-orange-400 rounded-xl"
              style={{
                left: '10%', right: '10%',
                top: '50%', transform: 'translateY(-50%)',
                aspectRatio: '3.5/1',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
              }}>
              {estado === 'procesando' && (
                <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20 rounded-lg">
                  <Loader2 size={28} className="text-blue-300 animate-spin" />
                </div>
              )}
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-white text-xs font-medium"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
              {estado === 'procesando'
                ? '⚡ FastALPR procesando...'
                : 'Centra la placa en el recuadro'}
            </p>
          </div>
        )}

        {/* Estado "Revisar" — confianza media */}
        {estado === 'revisar' && resultado && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="text-center">
              <p className="font-black text-5xl font-mono text-white tracking-widest mb-2"
                style={{ textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
                {resultado.placa}
              </p>
              <span className={`text-xs font-bold px-3 py-1 rounded-full ${nivelCfg?.badge}`}>
                {nivelCfg?.label}
              </span>
              <p className="text-white/70 text-xs mt-1">
                Confianza: {Math.round(resultado.confianza * 100)}% · {resultado.metodo}
              </p>
            </div>
          </div>
        )}

        {/* Flash verde al confirmar */}
        {estado === 'detectado' && (
          <div className="absolute inset-0 bg-emerald-500/40 flex flex-col items-center justify-center gap-2">
            <Check size={56} className="text-emerald-200" />
            <p className="font-black text-3xl font-mono text-white tracking-widest">
              {resultado?.placa}
            </p>
            <div className="flex items-center gap-1 text-emerald-200 text-xs">
              <Zap size={12} /> FastALPR · {Math.round((resultado?.confianza ?? 0) * 100)}%
            </div>
          </div>
        )}

        {/* Iniciando */}
        {estado === 'iniciando' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 size={28} className="text-orange-400 animate-spin" />
            <p className="text-white text-xs">Iniciando cámara...</p>
          </div>
        )}
      </div>

      {/* Dots de progreso de frames */}
      {estado === 'capturando' && (
        <div className="flex items-center gap-2">
          {Array.from({ length: FRAMES_BATCH }).map((_, i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
              i < frameCount ? 'bg-orange-400 scale-125' : 'bg-slate-300'
            }`} />
          ))}
          <span className="text-xs text-slate-500 ml-1">
            {frameCount === 0 ? 'Capturando frames...' : `${frameCount}/${FRAMES_BATCH} frames`}
          </span>
        </div>
      )}

      {/* Badge de confianza y botones para nivel medio */}
      {estado === 'revisar' && resultado && (
        <div className="w-full space-y-2">
          <div className={`flex items-center justify-between px-4 py-2 rounded-xl border ${nivelCfg?.borde} ${nivelCfg?.badge}`}>
            <span className="font-semibold text-sm">{nivelCfg?.label}</span>
            <span className="text-xs opacity-70">{Math.round(resultado.confianza * 100)}% · {resultado.ms}ms</span>
          </div>
          <div className="flex gap-2">
            <button onClick={reintentar}
              className="flex-1 flex items-center justify-center gap-2 py-3 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-sm font-medium transition-colors">
              <RefreshCw size={14} /> Reintentar
            </button>
            <button onClick={confirmar}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold text-sm transition-colors shadow">
              <Check size={14} /> Es correcta: {resultado.placa}
            </button>
          </div>
        </div>
      )}

      {/* Error de cámara */}
      {estado === 'error' && (
        <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <CameraOff size={24} className="mx-auto mb-2 text-red-400" />
          <p className="text-red-700 text-xs font-medium">{errorMsg}</p>
        </div>
      )}

      {/* Hint informativo */}
      {estado === 'capturando' && (
        <p className="text-[10px] text-slate-400 text-center">
          <Zap size={10} className="inline mr-1" />
          FastALPR · YOLO v9 detecta la placa antes del OCR · ~93% precisión
        </p>
      )}
    </div>
  )
}
