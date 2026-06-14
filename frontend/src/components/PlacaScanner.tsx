/**
 * PlacaScanner v5 — Arquitectura "Detect & Confirm" continua.
 *
 * Diseño basado en sistemas ANPR reales:
 *   ✅ Captura CONTINUA (nunca se detiene entre intentos)
 *   ✅ Envía cada frame individualmente (no espera batch de 3)
 *   ✅ Muestra resultado inmediatamente al primer detection
 *   ✅ Confirma automáticamente cuando el MISMO resultado aparece 2 veces seguidas
 *   ✅ Filtro de calidad en browser (rechaza frames oscuros/borrosos antes de enviar)
 *   ✅ Imágenes comprimidas al mínimo necesario (640px, JPEG 0.75) → más rápido
 *   ✅ Búsqueda en BD instantánea al detectar cualquier texto de placa
 *   ✅ Red de seguridad fuzzy: si la placa leída no existe pero hay una a
 *      distancia de edición 1 (OCR confundió un carácter), la sugiere
 *
 * FUENTE DE VERDAD DEL FORMATO: el backend (normalizar_placa) decide qué es
 * una placa válida y la devuelve canónica "1234-ABC". El frontend solo confía
 * en esa salida — no reimplementa la validación, para que no se desincronice.
 *
 * Flujo:
 *   Cámara activa → captura cada 300ms → filtro calidad → si ok → envía a backend
 *   Backend (FastALPR) responde en ~200ms → resultado mostrado inmediatamente
 *   2 resultados iguales consecutivos con confianza media+ → auto-confirma
 *   Alta confianza en 1 sola lectura → auto-confirma directo
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { CameraOff, Check, RefreshCw, Loader2, Zap, Search, Lightbulb } from 'lucide-react'
import { useLazyQuery } from '@apollo/client'
import { useOcrPlaca, type ResultadoOcr } from '../hooks/useOcrPlaca'
import { VEHICULOS_QUERY, SUGERENCIAS_PLACA_QUERY } from '../graphql/queries/vehiculos'

// Formato boliviano vigente (unificación 2016): 3-4 DÍGITOS + 3 LETRAS.
// Ej: "622-RXA", "1234-XYZ". Debe coincidir con normalizar_placa() del backend.
// Acepta la forma con guion, con espacio o sin separador.
const PLACA_RE   = /^\d{3,4}[-\s]?[A-Z]{3}$/i
const INTERVALO  = 300    // ms entre capturas
const MAX_ANCHO  = 640    // px máximo de ancho enviado al backend
const JPEG_QUAL  = 0.75   // calidad JPEG
const CONF_AUTO  = 0.82   // confianza para auto-confirmar en 1 lectura
const CONF_2X    = 0.60   // confianza para confirmar con 2 lecturas iguales consecutivas

// Solo letras y números, en mayúsculas — base de comparación tolerante a separadores.
const comparable = (p: string) => (p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

interface Props {
  activo: boolean
  // frameB64: foto del frame capturado, para guardarla como evidencia del acceso.
  onPlacaDetectada: (placa: string, frameB64?: string) => void
}

type Estado = 'idle' | 'iniciando' | 'capturando' | 'detectando' | 'revisar' | 'detectado' | 'error'

const NIVEL_CFG = {
  alto:  { borde: 'border-emerald-400', badge: 'bg-emerald-100 text-emerald-700' },
  medio: { borde: 'border-amber-400',   badge: 'bg-amber-100 text-amber-700' },
  bajo:  { borde: 'border-red-400',     badge: 'bg-red-100 text-red-700' },
}

// ── Filtro de calidad de imagen en el navegador ───────────────────────────────
function _calcularCalidad(ctx: CanvasRenderingContext2D, w: number, h: number): number {
  const img  = ctx.getImageData(0, 0, w, h)
  const d    = img.data
  let sum    = 0, sum2 = 0, n = 0

  // Muestra aleatoria (1 de cada 16 píxeles) para velocidad
  for (let i = 0; i < d.length; i += 64) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    sum  += gray
    sum2 += gray * gray
    n    += 1
  }

  const media    = sum / n
  const varianza = sum2 / n - media * media
  // Varianza alta = buen contraste; media entre 60-200 = bien iluminado
  return Math.min(varianza / 1000, 1.0) * (media > 40 && media < 230 ? 1.0 : 0.3)
}

export function PlacaScanner({ activo, onPlacaDetectada }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const enviandoRef = useRef(false)               // previene envíos simultáneos
  const ultimaRef   = useRef<string | null>(null) // última placa detectada
  const consecutRef = useRef(0)                   // contador de detecciones iguales
  const ultimoFrameRef = useRef<string | null>(null)  // último frame JPEG (evidencia)

  const [estado,       setEstado]      = useState<Estado>('idle')
  const [errorMsg,     setErrorMsg]    = useState('')
  const [resultado,    setResultado]   = useState<ResultadoOcr | null>(null)
  const [vehiculosBD,  setVehsBD]      = useState<any[]>([])
  const [sugerencias,  setSugerencias] = useState<any[]>([])
  const [buscandoBD,   setBuscandoBD]  = useState(false)
  const [calidadFrame, setCalidad]     = useState(0)  // 0-1 para mostrar al usuario

  const { reconocerConConfianza } = useOcrPlaca()

  // Red de seguridad: cuando el OCR leyó mal un carácter y la placa no existe,
  // el backend sugiere la(s) placa(s) real(es) a distancia de edición 1.
  const [buscarSugerencias] = useLazyQuery(SUGERENCIAS_PLACA_QUERY, {
    fetchPolicy: 'network-only',
    onCompleted(d) { setSugerencias(d?.sugerenciasPlaca ?? []) },
    onError()      { setSugerencias([]) },
  })

  const [buscarVehiculos] = useLazyQuery(VEHICULOS_QUERY, {
    fetchPolicy: 'network-only',
    onCompleted(d) {
      setBuscandoBD(false)
      const items = d?.vehiculos?.items ?? []
      setVehsBD(items)
      // Sin coincidencia exacta → pedir sugerencias fuzzy al backend.
      if (items.length === 0 && ultimaRef.current) {
        buscarSugerencias({ variables: { placa: ultimaRef.current } })
      }
    },
    onError() { setBuscandoBD(false) },
  })

  const buscarEnBD = useCallback((texto: string) => {
    const comp = comparable(texto)
    if (comp.length < 4) return
    setSugerencias([])
    setBuscandoBD(true)
    buscarVehiculos({ variables: { buscar: texto, estado: 'activo', porPagina: 8 } })
  }, [buscarVehiculos])

  const detener = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    enviandoRef.current = false
    ultimaRef.current   = null
    consecutRef.current = 0
    setEstado('idle'); setResultado(null); setVehsBD([]); setSugerencias([])
    setCalidad(0)
  }, [])

  useEffect(() => {
    if (!activo) { detener(); return }
    iniciarCamara()
    return () => detener()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo])

  async function iniciarCamara() {
    setEstado('iniciando'); setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width:  { ideal: 1280, max: 1920 },
          height: { ideal: 720,  max: 1080 },
        },
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      setEstado('capturando')
      iniciarCapturaContinua()
    } catch {
      setErrorMsg('No se pudo acceder a la cámara.')
      setEstado('error')
    }
  }

  function capturarYProcesar() {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return
    if (enviandoRef.current) return   // ya hay una request en vuelo

    // ── Captura con redimensión automática ───────────────────────────────────
    const vw    = video.videoWidth
    const vh    = video.videoHeight
    const escala = Math.min(1, MAX_ANCHO / vw)
    const nw    = Math.round(vw * escala)
    const nh    = Math.round(vh * escala)

    canvas.width  = nw
    canvas.height = nh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, nw, nh)

    // ── Filtro de calidad en browser (sin enviar al servidor) ────────────────
    const calidad = _calcularCalidad(ctx, nw, nh)
    setCalidad(calidad)
    if (calidad < 0.05) return  // imagen demasiado oscura o sin contraste

    // ── Enviar al backend ────────────────────────────────────────────────────
    const base64 = canvas.toDataURL('image/jpeg', JPEG_QUAL).split(',')[1]
    ultimoFrameRef.current = base64   // guardar como posible evidencia del acceso
    enviandoRef.current = true
    setEstado('detectando')

    reconocerConConfianza(canvas).then(res => {
      enviandoRef.current = false
      setEstado('capturando')

      if (!res || !res.placa) return

      const placa = res.placa
      const conf  = res.confianza

      // El backend ya devuelve la placa canónica; solo confiamos en su salida.
      if (!PLACA_RE.test(placa)) return  // texto no es una placa válida → seguir escaneando

      setResultado(res)

      // ── Lógica de confirmación ────────────────────────────────────────────
      if (conf >= CONF_AUTO) {
        // Alta confianza: confirmar inmediatamente
        _confirmarPlaca(placa)
        return
      }

      if (placa === ultimaRef.current) {
        consecutRef.current += 1
        if (consecutRef.current >= 2 && conf >= CONF_2X) {
          // Misma placa 2 veces seguidas con confianza media → confirmar
          _confirmarPlaca(placa)
          return
        }
      } else {
        ultimaRef.current   = placa
        consecutRef.current = 1
        // Nueva detección → buscar en BD inmediatamente
        buscarEnBD(placa)
      }
      setEstado('revisar')
    }).catch(() => {
      enviandoRef.current = false
      setEstado('capturando')
    })
  }

  function _confirmarPlaca(placa: string) {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    setEstado('detectado')
    onPlacaDetectada(placa, ultimoFrameRef.current ?? undefined)
    setTimeout(() => detener(), 800)
  }

  function iniciarCapturaContinua() {
    ultimaRef.current   = null
    consecutRef.current = 0
    enviandoRef.current = false
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(capturarYProcesar, INTERVALO)
  }

  function reintentar() {
    setResultado(null); setVehsBD([]); setSugerencias([])
    ultimaRef.current   = null
    consecutRef.current = 0
    setEstado('capturando')
    iniciarCapturaContinua()
  }

  const nivelCfg = resultado ? NIVEL_CFG[resultado.nivel] : null
  const pct      = Math.round(calidadFrame * 100)
  const calidadColor = pct > 60 ? 'bg-emerald-400' : pct > 30 ? 'bg-amber-400' : 'bg-red-400'

  return (
    <div className="flex flex-col items-center gap-3 w-full">

      {/* Área de cámara */}
      <div className="relative w-full overflow-hidden rounded-2xl bg-slate-900"
        style={{ aspectRatio: '16/9' }}>
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />

        {/* Guía de encuadre con indicador de calidad */}
        {(estado === 'capturando' || estado === 'detectando') && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Marco de referencia — guía visual */}
            <div className={`absolute border-2 rounded-xl transition-colors ${
              estado === 'detectando' ? 'border-blue-400' : 'border-orange-400/60 border-dashed'
            }`}
              style={{ left: '5%', right: '5%', top: '25%', bottom: '25%' }} />

            {/* Indicador de calidad de imagen */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5 bg-black/60 rounded-lg px-2 py-1">
              <div className={`w-2 h-2 rounded-full ${calidadColor}`} />
              <span className="text-white text-[10px]">
                {pct > 60 ? 'Calidad OK' : pct > 30 ? 'Mejorar luz' : 'Poca luz'}
              </span>
            </div>

            {/* Indicador de procesamiento */}
            {estado === 'detectando' && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-blue-900/80 rounded-xl px-4 py-1.5">
                <Loader2 size={12} className="text-blue-300 animate-spin shrink-0" />
                <span className="text-blue-200 text-xs font-semibold">FastALPR analizando...</span>
              </div>
            )}

            {/* Instrucción */}
            {estado === 'capturando' && (
              <p className="absolute bottom-3 left-0 right-0 text-center text-white/70 text-[11px]"
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                📍 Centra la placa completa en el encuadre
              </p>
            )}
          </div>
        )}

        {/* Estado de revisión — placa detectada en cámara */}
        {estado === 'revisar' && resultado && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center">
              <p className="font-black text-4xl font-mono text-white tracking-widest"
                style={{ textShadow: '0 2px 12px rgba(0,0,0,0.9)' }}>
                {resultado.placa}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${nivelCfg?.badge}`}>
                  {Math.round(resultado.confianza * 100)}% confianza
                </span>
                <span className="text-white/60 text-[10px]">{consecutRef.current}/2 lecturas</span>
              </div>
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
              <Zap size={12} /> {Math.round((resultado?.confianza ?? 0) * 100)}% · confirmado
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

        {/* Error */}
        {estado === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90">
            <CameraOff size={28} className="text-red-400" />
            <p className="text-red-300 text-xs text-center px-4">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* Resultado en revisión + BD */}
      {estado === 'revisar' && resultado && (
        <div className="w-full space-y-2">
          <div className={`flex items-center justify-between px-4 py-2 rounded-xl border-2 ${nivelCfg?.borde} ${nivelCfg?.badge}`}>
            <span className="font-mono font-black">{resultado.placa}</span>
            <div className="flex items-center gap-2 text-xs opacity-70">
              {buscandoBD && <Loader2 size={11} className="animate-spin" />}
              <span>{resultado.ms}ms · {resultado.metodo}</span>
            </div>
          </div>

          {!buscandoBD && vehiculosBD.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 px-1 flex items-center gap-1.5">
                <Search size={11} />
                {vehiculosBD.length === 1 ? 'Vehículo encontrado:' : `${vehiculosBD.length} coincidencias:`}
              </p>
              {vehiculosBD.map((v: any) => (
                <button key={v.id}
                  onClick={() => { onPlacaDetectada(v.placa); detener() }}
                  className="w-full text-left flex items-center gap-3 bg-emerald-50 border-2 border-emerald-300 hover:border-emerald-500 rounded-xl px-3 py-2.5 transition-all">
                  <span className="text-lg shrink-0">
                    {v.tipo?.nombre === 'Motocicleta' ? '🏍️' : v.tipo?.nombre === 'Camioneta' ? '🚙' : '🚗'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-black text-slate-800 text-sm">{v.placa}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {v.propietarioNombre} · {v.marca} {v.modelo}
                    </p>
                  </div>
                  <Check size={15} className="text-emerald-600 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {/* Sin coincidencia exacta, pero hay placas cercanas (OCR confundió un carácter) */}
          {!buscandoBD && vehiculosBD.length === 0 && sugerencias.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-amber-600 px-1 flex items-center gap-1.5">
                <Lightbulb size={11} />
                ¿Quisiste decir? (lectura aproximada)
              </p>
              {sugerencias.map((v: any) => (
                <button key={v.id}
                  onClick={() => { onPlacaDetectada(v.placa); detener() }}
                  className="w-full text-left flex items-center gap-3 bg-amber-50 border-2 border-amber-300 hover:border-amber-500 rounded-xl px-3 py-2.5 transition-all">
                  <span className="text-lg shrink-0">🚗</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-black text-slate-800 text-sm">{v.placa}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {v.propietarioNombre} · {v.marca} {v.modelo}
                    </p>
                  </div>
                  <Check size={15} className="text-amber-600 shrink-0" />
                </button>
              ))}
            </div>
          )}

          {!buscandoBD && vehiculosBD.length === 0 && sugerencias.length === 0 && (
            <p className="text-xs text-amber-600 px-1">⚠ No encontrado en el sistema</p>
          )}

          <div className="flex gap-2">
            <button onClick={reintentar}
              className="flex items-center gap-1.5 py-2.5 px-3 border border-slate-300 rounded-xl text-slate-600 text-xs hover:bg-slate-50">
              <RefreshCw size={12} /> Continuar
            </button>
            <button onClick={() => { onPlacaDetectada(resultado.placa!); detener() }}
              className="flex-1 flex items-center justify-center gap-1 py-2.5 border border-amber-300 text-amber-700 rounded-xl text-xs font-semibold hover:bg-amber-50">
              Usar: {resultado.placa}
            </button>
          </div>
        </div>
      )}

      {/* Info de la tecnología */}
      {estado === 'capturando' && (
        <p className="text-[10px] text-slate-400 text-center">
          <Zap size={9} className="inline mr-0.5" />
          FastALPR · captura cada {INTERVALO}ms · imágenes {MAX_ANCHO}px · calidad {JPEG_QUAL * 100}%
        </p>
      )}
    </div>
  )
}
