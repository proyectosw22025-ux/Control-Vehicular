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
import { CameraOff, Check, RefreshCw, Loader2, Zap, Search } from 'lucide-react'
import { useLazyQuery } from '@apollo/client'
import { useOcrPlaca, type ResultadoOcr } from '../hooks/useOcrPlaca'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'

const PLACA_RE     = /^[A-Z]{2,4}[-\s]?\d{3,4}[A-Z]?$/i
const FRAMES_BATCH = 3     // frames por lote enviado al backend
const CAPTURA_MS   = 800   // captura un frame cada 800ms

interface Props {
  activo: boolean
  onPlacaDetectada: (placa: string) => void
}

type Estado = 'idle' | 'iniciando' | 'capturando' | 'procesando' | 'revisar' | 'parcial' | 'detectado' | 'error'

const DEPTOS_BO = ['SCZ', 'CBB', 'LPZ', 'ORU', 'TJA', 'PTS', 'BEN', 'PAN', 'CHU']

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

  const [estado,        setEstado]     = useState<Estado>('idle')
  const [errorMsg,      setErrorMsg]   = useState('')
  const [resultado,     setResultado]  = useState<ResultadoOcr | null>(null)
  const [frameCount,    setFrameCount] = useState(0)
  const [codigoParcial, setCodigo]     = useState('')
  const [numManual,     setNumManual]  = useState('')
  const [vehiculosBD,   setVehsBD]     = useState<any[]>([])
  const [buscandoBD,    setBuscandoBD] = useState(false)

  const { reconocerMultiframe } = useOcrPlaca()

  // Query perezosa para buscar vehículos por placa en la BD
  const [buscarVehiculos] = useLazyQuery(VEHICULOS_QUERY, {
    fetchPolicy: 'network-only',
    onCompleted(data) {
      setBuscandoBD(false)
      setVehsBD(data?.vehiculos?.items ?? [])
    },
    onError() { setBuscandoBD(false) },
  })

  /**
   * Consulta la BD con el texto OCR detectado.
   * Si encuentra 1 vehículo → auto-confirma.
   * Si encuentra 2-10 → muestra lista para que el guardia elija.
   */
  const buscarEnBD = useCallback((texto: string) => {
    if (!texto || texto.length < 2) return
    setBuscandoBD(true)
    buscarVehiculos({ variables: { buscar: texto, estado: 'activo', porPagina: 10 } })
  }, [buscarVehiculos])

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

    // Enviar el FRAME COMPLETO — FastALPR tiene su propio YOLO para localizar la placa.
    // Pre-recortar manualmente puede cortar el número inferior de placas bolivianas.
    const vw = video.videoWidth, vh = video.videoHeight
    canvas.width  = vw
    canvas.height = vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, vw, vh)

    return canvas.toDataURL('image/jpeg', 0.95).split(',')[1]
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
          // ── Placa completa detectada ──────────────────────────────────────
          setResultado(res)

          if (res.nivel === 'alto') {
            // Alta confianza → buscar en BD antes de auto-confirmar
            // Si la placa no existe en el sistema → el guardia necesita saberlo
            buscarEnBD(res.placa)
            setEstado('revisar')  // esperará el resultado de BD
          } else {
            setEstado('revisar')
            buscarEnBD(res.placa)
          }

        } else if (res?.placa) {
          // ── Placa parcial (ej: solo "SCZ") ────────────────────────────────
          const textoRaw = res.placa.replace(/[-\s]/g, '').toUpperCase()
          const match    = DEPTOS_BO.find(d => textoRaw.startsWith(d))

          if (match) {
            setCodigo(match)
            setNumManual('')
            setVehsBD([])
            setEstado('parcial')
            // Buscar todos los vehículos con ese código en la BD
            buscarEnBD(match)
          } else {
            procesandoRef.current = false
            framesRef.current = []
            setEstado('capturando')
            setFrameCount(0)
            iniciarCaptura()
          }
        } else {
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

        {/* Overlay — guía visual informativa (no recorta, FastALPR busca en frame completo) */}
        {(estado === 'capturando' || estado === 'procesando') && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Recuadro guía sutil — solo referencia visual */}
            <div className="absolute border-2 border-dashed border-orange-400/70 rounded-xl"
              style={{ left: '5%', right: '5%', top: '20%', bottom: '20%' }}>
              {estado === 'procesando' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center gap-2 bg-black/60 rounded-xl px-4 py-2">
                    <Loader2 size={18} className="text-blue-300 animate-spin" />
                    <span className="text-white text-xs font-semibold">FastALPR buscando placa...</span>
                  </div>
                </div>
              )}
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-white text-xs font-medium"
              style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
              {estado === 'procesando'
                ? '⚡ FastALPR procesando frame completo...'
                : '📍 Encuadra la placa completa — incluye el número inferior'}
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

      {/* Modo parcial + búsqueda en BD */}
      {estado === 'parcial' && (
        <div className="w-full space-y-3">
          <div className="bg-blue-50 border-2 border-blue-300 rounded-xl px-4 py-3">
            <p className="text-blue-700 text-xs font-bold mb-0.5 flex items-center gap-1.5">
              <Search size={12} /> Detecté: <span className="font-mono text-base">{codigoParcial}</span>
              {buscandoBD && <Loader2 size={11} className="animate-spin ml-1" />}
            </p>
            <p className="text-blue-600 text-xs">
              {vehiculosBD.length > 0
                ? `${vehiculosBD.length} vehículo${vehiculosBD.length > 1 ? 's' : ''} registrado${vehiculosBD.length > 1 ? 's' : ''} con esa placa:`
                : 'Buscando en la base de datos...'}
            </p>
          </div>

          {/* Vehículos encontrados → guardia toca el correcto */}
          {vehiculosBD.length > 0 && (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {vehiculosBD.map((v: any) => (
                <button key={v.id}
                  onClick={() => { onPlacaDetectada(v.placa); detener() }}
                  className="w-full text-left flex items-center gap-3 bg-white border-2 border-slate-200 hover:border-blue-400 rounded-xl px-3 py-2.5 transition-all group">
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-lg shrink-0 group-hover:bg-blue-50">
                    {v.tipo?.nombre === 'Motocicleta' ? '🏍️' : v.tipo?.nombre === 'Camioneta' ? '🚙' : '🚗'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-black text-slate-800">{v.placa}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {v.propietario?.nombreCompleto ?? '—'} · {v.marca} {v.modelo}
                    </p>
                  </div>
                  <Check size={16} className="text-blue-500 shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          {/* Si no hay en BD → completar manualmente */}
          {!buscandoBD && vehiculosBD.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 text-center">No encontrado en BD. Completa el número:</p>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-100 rounded-xl px-3 py-2 flex-1">
                  <span className="font-mono font-black text-slate-700 text-lg mr-1">{codigoParcial}-</span>
                  <input autoFocus type="text" inputMode="numeric" maxLength={4} placeholder="1234"
                    value={numManual}
                    onChange={e => { setNumManual(e.target.value.replace(/[^0-9]/g, '')); if (e.target.value.length >= 3) buscarEnBD(`${codigoParcial}-${e.target.value}`) }}
                    onKeyDown={e => { if (e.key === 'Enter' && numManual.length >= 3) { onPlacaDetectada(`${codigoParcial}-${numManual}`); detener() }}}
                    className="font-mono font-black text-slate-800 text-lg bg-transparent outline-none w-16 placeholder:text-slate-300" />
                </div>
                <button disabled={numManual.length < 3}
                  onClick={() => { onPlacaDetectada(`${codigoParcial}-${numManual}`); detener() }}
                  className="flex items-center gap-1.5 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm disabled:opacity-40 shrink-0">
                  <Check size={14} /> OK
                </button>
              </div>
            </div>
          )}

          <button onClick={reintentar}
            className="w-full flex items-center justify-center gap-2 py-2 border border-slate-200 text-slate-500 rounded-xl text-xs hover:bg-slate-50 transition-colors">
            <RefreshCw size={12} /> Reintentar escaneo
          </button>
        </div>
      )}

      {/* Placa detectada + búsqueda en BD */}
      {estado === 'revisar' && resultado && (
        <div className="w-full space-y-2">
          <div className={`flex items-center justify-between px-4 py-2 rounded-xl border ${nivelCfg?.borde} ${nivelCfg?.badge}`}>
            <span className="font-mono font-black text-base">{resultado.placa}</span>
            <span className="text-xs opacity-70">{Math.round(resultado.confianza * 100)}% · {resultado.metodo}</span>
          </div>

          {/* Vehículos encontrados en BD */}
          {buscandoBD && (
            <div className="flex items-center gap-2 text-xs text-slate-500 px-2">
              <Loader2 size={12} className="animate-spin" />
              Buscando en base de datos...
            </div>
          )}

          {!buscandoBD && vehiculosBD.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 px-1">
                {vehiculosBD.length === 1 ? '✅ Vehículo encontrado:' : `${vehiculosBD.length} coincidencias — elige el correcto:`}
              </p>
              {vehiculosBD.map((v: any) => (
                <button key={v.id}
                  onClick={() => { onPlacaDetectada(v.placa); detener() }}
                  className="w-full text-left flex items-center gap-3 bg-emerald-50 border-2 border-emerald-300 hover:border-emerald-500 rounded-xl px-3 py-2.5 transition-all group">
                  <span className="text-xl shrink-0">
                    {v.tipo?.nombre === 'Motocicleta' ? '🏍️' : v.tipo?.nombre === 'Camioneta' ? '🚙' : '🚗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-black text-slate-800">{v.placa}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {v.propietario?.nombreCompleto ?? '—'} · {v.marca} {v.modelo}
                    </p>
                  </div>
                  <Check size={16} className="text-emerald-600 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {!buscandoBD && vehiculosBD.length === 0 && (
            <p className="text-xs text-amber-600 px-1">⚠ Placa no encontrada en el sistema — puede ser un vehículo externo</p>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={reintentar}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 border border-slate-300 rounded-xl text-slate-600 hover:bg-slate-50 text-xs font-medium transition-colors">
              <RefreshCw size={12} /> Reintentar
            </button>
            <button onClick={confirmar}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-amber-300 text-amber-700 rounded-xl text-xs font-semibold hover:bg-amber-50 transition-colors">
              Usar placa: {resultado.placa}
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
