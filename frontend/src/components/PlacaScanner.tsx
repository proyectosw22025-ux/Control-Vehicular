/**
 * PlacaScanner — OCR de placas vehiculares bolivianas para el Panel Guardia.
 *
 * Arquitectura:
 *   - getUserMedia() con facingMode: 'environment' (cámara trasera)
 *   - Canvas API: captura frame cada 1.5s, recorta región 4:1 (proporción de placa)
 *   - Preprocessing: escala de grises + contraste amplificado
 *   - Tesseract.js (WASM local, cargado dinámicamente) con whitelist alfanumérica
 *   - 3 lecturas consistentes para confirmar (evita falsos positivos)
 *   - Overlay rojo mientras busca → verde al detectar
 *   - Cae a ingreso manual si OCR falla (nunca bloquea el flujo)
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { Camera, CameraOff, Check, RefreshCw, Loader2, FileText } from 'lucide-react'
import { useOcrPlaca } from '../hooks/useOcrPlaca'

const PLACA_RE        = /^[A-Z]{2,4}[-\s]?\d{3,4}[A-Z]?$/i
const LECTURAS_OK     = 3   // lecturas consistentes para confirmar
const INTERVALO_MS    = 1500 // cada 1.5s captura un frame

/** Preprocessing: escala de grises + contraste amplificado para mejorar OCR */
function preprocessCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d   = img.data
  for (let i = 0; i < d.length; i += 4) {
    const gray        = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const contrasted  = Math.min(255, Math.max(0, (gray - 128) * 2.2 + 128))
    d[i] = d[i + 1] = d[i + 2] = contrasted
  }
  ctx.putImageData(img, 0, 0)
}

interface Props {
  activo: boolean
  onPlacaDetectada: (placa: string) => void
}

type Estado = 'idle' | 'iniciando' | 'escaneando' | 'confirmando' | 'detectado' | 'error'

export function PlacaScanner({ activo, onPlacaDetectada }: Props) {
  const videoRef      = useRef<HTMLVideoElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const streamRef     = useRef<MediaStream | null>(null)
  const intervaloRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const procesandoRef = useRef(false)
  const lecturasRef   = useRef<string[]>([])

  const [estado,    setEstado]    = useState<Estado>('idle')
  const [errorMsg,  setErrorMsg]  = useState('')
  const [detectada, setDetectada] = useState('')
  const [lecCount,  setLecCount]  = useState(0) // solo para UI dots

  const { inicializado, cargando: cargandoOcr, reconocer } = useOcrPlaca()

  const detener = useCallback(() => {
    if (intervaloRef.current) { clearInterval(intervaloRef.current); intervaloRef.current = null }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    procesandoRef.current = false
    lecturasRef.current   = []
    setEstado('idle')
    setDetectada('')
    setLecCount(0)
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
      setEstado('escaneando')
      iniciarEscaneo()
    } catch {
      setErrorMsg('No se pudo acceder a la cámara. Verifica los permisos.')
      setEstado('error')
    }
  }

  function iniciarEscaneo() {
    lecturasRef.current = []
    setLecCount(0)

    intervaloRef.current = setInterval(async () => {
      if (procesandoRef.current || !videoRef.current || !canvasRef.current) return
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video.readyState < 2) return

      // Recortar región de placa: 70% del ancho, proporción 4:1, centrado
      const vw = video.videoWidth
      const vh = video.videoHeight
      const pw = Math.round(vw * 0.70)
      const ph = Math.round(pw / 4)
      const px = Math.round((vw - pw) / 2)
      const py = Math.round((vh - ph) / 2)

      canvas.width  = pw
      canvas.height = ph
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(video, px, py, pw, ph, 0, 0, pw, ph)
      preprocessCanvas(ctx, pw, ph)

      procesandoRef.current = true
      const placa = await reconocer(canvas)
      procesandoRef.current = false

      if (placa && PLACA_RE.test(placa)) {
        const prev = lecturasRef.current
        const nuevas = [...prev, placa].slice(-LECTURAS_OK)
        lecturasRef.current = nuevas
        setLecCount(nuevas.length)

        if (nuevas.length >= LECTURAS_OK && nuevas.every(l => l === nuevas[0])) {
          clearInterval(intervaloRef.current!)
          intervaloRef.current = null
          setDetectada(nuevas[0])
          setEstado('confirmando')
        }
      }
    }, INTERVALO_MS)
  }

  function confirmar() {
    if (!detectada) return
    setEstado('detectado')
    onPlacaDetectada(detectada)
    setTimeout(() => detener(), 800)
  }

  function reintentar() {
    if (intervaloRef.current) clearInterval(intervaloRef.current)
    iniciarEscaneo()
    setEstado('escaneando')
    setDetectada('')
  }

  const esConfirmando = estado === 'confirmando'
  const esEscaneando  = estado === 'escaneando'

  return (
    <div className="flex flex-col items-center gap-3 w-full">

      {/* OCR cargando */}
      {cargandoOcr && (
        <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-1.5 w-full">
          <Loader2 size={12} className="animate-spin" />
          Cargando motor OCR (primera vez puede tardar ~10s)...
        </div>
      )}

      {/* Área de cámara */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-slate-900" style={{ aspectRatio: '16/9' }}>
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />

        {/* Overlay oscuro + ventana de placa */}
        {(esEscaneando || esConfirmando) && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Cuatro regiones oscuras alrededor del recuadro */}
            <div className="absolute inset-0 bg-black/50" />
            {/* Recuadro de placa: 70% del ancho, 4:1 aspect ratio, centrado */}
            <div
              className={`absolute border-4 rounded-xl transition-colors duration-300 ${
                esConfirmando ? 'border-green-400' : 'border-red-400'
              }`}
              style={{
                left: '15%', right: '15%',
                top: '50%', transform: 'translateY(-50%)',
                aspectRatio: '4/1',
                background: 'transparent',
                boxShadow: esConfirmando ? '0 0 0 9999px rgba(0,0,0,0.5)' : '0 0 0 9999px rgba(0,0,0,0.5)',
              }}
            >
              {/* Línea de escaneo */}
              {esEscaneando && (
                <div className="absolute inset-0 overflow-hidden rounded-lg">
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-400"
                    style={{ animation: 'scanLine 2s ease-in-out infinite' }}
                  />
                </div>
              )}

              {/* Placa detectada en texto grande */}
              {esConfirmando && detectada && (
                <div className="absolute inset-0 flex items-center justify-center bg-green-500/20 rounded-lg">
                  <span className="font-black text-3xl sm:text-4xl font-mono text-white tracking-widest"
                    style={{ textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
                    {detectada}
                  </span>
                </div>
              )}
            </div>

            {/* Instrucción */}
            {esEscaneando && (
              <p className="absolute bottom-3 left-0 right-0 text-center text-white text-xs font-medium"
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Centra la placa en el recuadro {esEscaneando ? 'rojo' : 'verde'}
              </p>
            )}
          </div>
        )}

        {/* Flash verde al confirmar */}
        {estado === 'detectado' && (
          <div className="absolute inset-0 bg-green-500/40 flex items-center justify-center">
            <Check size={64} className="text-green-300" />
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

      {/* Puntos de progreso de lecturas */}
      {esEscaneando && (
        <div className="flex items-center gap-2">
          {Array.from({ length: LECTURAS_OK }).map((_, i) => (
            <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all ${
              i < lecCount ? 'bg-orange-400 scale-125' : 'bg-slate-300'
            }`} />
          ))}
          <span className="text-xs text-slate-500 ml-1">
            {lecCount === 0 ? 'Buscando placa...' : `${lecCount}/${LECTURAS_OK} lecturas`}
          </span>
        </div>
      )}

      {/* Botones Confirmar / Reintentar */}
      {esConfirmando && (
        <div className="flex gap-2 w-full">
          <button onClick={reintentar}
            className="flex-1 flex items-center justify-center gap-2 py-3 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 transition-colors font-medium text-sm">
            <RefreshCw size={15} /> Reintentar
          </button>
          <button onClick={confirmar}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold transition-colors text-sm shadow-lg">
            <Check size={15} /> Confirmar {detectada}
          </button>
        </div>
      )}

      {/* Error de cámara */}
      {estado === 'error' && (
        <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <CameraOff size={24} className="mx-auto mb-2 text-red-400" />
          <p className="text-red-700 text-xs font-medium">{errorMsg}</p>
        </div>
      )}

      {/* Hint OCR no inicializado */}
      {!inicializado && !cargandoOcr && estado !== 'error' && (
        <p className="text-xs text-amber-600 text-center">
          <FileText size={12} className="inline mr-1" />
          OCR no disponible — usa el ingreso manual
        </p>
      )}
    </div>
  )
}
