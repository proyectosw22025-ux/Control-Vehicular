/**
 * Panel Guardia — Tablet-first
 *
 * Regla 1 (Negocio): El guardia registra entradas/salidas en tiempo real.
 *   En hora pico (7-8am) pueden ser 200+ vehículos. La UI debe:
 *   - Mostrar resultado GRANDE (verde/rojo) visible desde lejos
 *   - Manejar escaneos rápidos consecutivos sin bloquear la cámara
 *   - Funcionar aunque haya cortes breves de internet (retry automático)
 *
 * Regla 4 (Async): useAccesoGuardia implementa retry con exponential backoff
 *   y detecta Error 4001 (token JWT expirado en WebSocket).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useApolloClient, gql } from '@apollo/client'
import {
  ShieldCheck, ArrowDownCircle, ArrowUpCircle, Camera, CameraOff,
  CheckCircle2, XCircle, Clock, ParkingSquare, UserCheck, DoorOpen,
  Wifi, WifiOff, RefreshCw, Loader2, Type, Keyboard,
  AlertTriangle, Bell, Eye, Truck, LogOut, Plus, Timer, Repeat, Volume2, VolumeX,
} from 'lucide-react'
import { QrScanner }     from '../components/QrScanner'
import { PlacaScanner } from '../components/PlacaScanner'
import { PUNTOS_ACCESO_QUERY, REGISTROS_ACCESO_QUERY, ALERTAS_PANEL_QUERY, VEHICULOS_TEMPORALES_QUERY, VEHICULOS_EN_CAMPUS_QUERY, AFORO_CAMPUS_QUERY, METRICAS_DESPACHO_QUERY } from '../graphql/queries/acceso'
import { MARCAR_ALERTA_REVISADA_MUTATION, REGISTRAR_ACCESO_TEMPORAL_MUTATION, REGISTRAR_SALIDA_TEMPORAL_MUTATION } from '../graphql/mutations/acceso'
import { INICIAR_SESION_MUTATION, OCUPAR_ESPACIO_TEMPORAL_MUTATION } from '../graphql/mutations/parqueos'
import { ESPACIOS_DISPONIBLES_QUERY } from '../graphql/queries/parqueos'
import { VISITAS_ACTIVAS_QUERY } from '../graphql/queries/visitantes'
import { useAccesoGuardia, type TipoAcceso, type AlertaInfo, type ResultadoAcceso } from '../hooks/useAccesoGuardia'
import { useOfflineAccess } from '../hooks/useOfflineAccess'

const GUARDIA_STATS_QUERY = gql`
  query GuardiaStats {
    dashboardStats {
      accesosHoy espaciosDisponibles totalEspacios visitantesActivos
    }
  }
`

const METODO_LABEL: Record<string, string> = {
  qr_dinamico:  'QR Dinámico',
  qr_permanente:'QR',
  qr_delegacion:'QR Deleg.',
  pase_temporal:'Pase',
  manual:       'Manual',
}

export default function GuardiaDashboard() {
  type ModoScanner = 'qr' | 'placa' | 'manual'
  const [tipo, setTipo]             = useState<TipoAcceso>('auto')
  const [modo, setModo]             = useState<ModoScanner>('qr')
  const [camaraActiva, setCamara]   = useState(false)
  const [placaActiva, setPlacaOcr]  = useState(false)
  const [placaManual, setPlaca]     = useState('')
  const [online, setOnline]         = useState(navigator.onLine)
  const [vehiculoNoEncontrado, setVehiculoNoEncontrado] = useState('')

  // Hook de dominio con retry y manejo de errores
  const acceso     = useAccesoGuardia()
  const offlineAcc = useOfflineAccess()

  // Destructurar las funciones estables del hook para que los callbacks
  // de useCallback no dependan del objeto acceso completo.
  // acceso.registrarQr y acceso.registrarManual son estables (useCallback interno),
  // pero el objeto `acceso` cambia de referencia en cada render.
  const { registrarQr, registrarManual } = acceso

  // Detectar cambios de conectividad
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const { data: statsData, refetch: refetchStats } = useQuery(GUARDIA_STATS_QUERY, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
  })
  const { data: aforoData, refetch: refetchAforo } = useQuery(AFORO_CAMPUS_QUERY, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
  })
  const aforo = aforoData?.aforoCampus
  const { data: puntosData } = useQuery(PUNTOS_ACCESO_QUERY)
  const { data: registrosData, refetch: refetchRegistros } = useQuery(REGISTROS_ACCESO_QUERY, {
    variables: { limite: 8 },
    pollInterval: 15_000,
    fetchPolicy: 'cache-and-network',
  })
  const { data: visitasData, refetch: refetchVisitas } = useQuery(VISITAS_ACTIVAS_QUERY, {
    pollInterval: 30_000,
    fetchPolicy: 'cache-and-network',
  })
  // ── Tab principal ─────────────────────────────────────────────────────────
  const [tabPrincipal, setTabPrincipal] = useState<'acceso' | 'temporales' | 'campus'>('acceso')

  // ── Vehículos temporales ──────────────────────────────────────────────────
  const { data: temporalesData, refetch: refetchTemporales } = useQuery(VEHICULOS_TEMPORALES_QUERY, {
    pollInterval: 30_000,
    fetchPolicy: 'network-only',
    skip: tabPrincipal !== 'temporales',
  })

  // ── Vehículos aún en campus (parte de control / cierre de jornada) ─────────
  const { data: campusData, refetch: refetchCampus } = useQuery(VEHICULOS_EN_CAMPUS_QUERY, {
    fetchPolicy: 'network-only',
    skip: tabPrincipal !== 'campus',
  })
  const enCampus = campusData?.vehiculosEnCampus ?? []

  // Métrica de despacho (throughput del portón) — solo al abrir la pestaña campus.
  const { data: despachoData } = useQuery(METRICAS_DESPACHO_QUERY, {
    variables: { dias: 7 },
    fetchPolicy: 'cache-and-network',
    skip: tabPrincipal !== 'campus',
  })
  const despacho = despachoData?.metricasDespacho ?? []

  // Feedback compartido de asignación de espacio (entrada y temporal).
  const [espacioAsignadoMsg, setEspacioAsignadoMsg] = useState('')

  // Asignar espacio a un vehículo temporal (proveedor, mantenimiento...):
  // toma el primer espacio libre y lo ocupa, para que el mapa refleje la
  // ocupación física real. La categoría no aplica a externos.
  const apolloClient = useApolloClient()
  const [ocuparTemporal, { loading: ocupandoTemporal }] = useMutation(OCUPAR_ESPACIO_TEMPORAL_MUTATION)
  const handleOcuparTemporal = useCallback(async (vtId: number, placa: string) => {
    try {
      const { data } = await apolloClient.query({ query: ESPACIOS_DISPONIBLES_QUERY, fetchPolicy: 'network-only' })
      const libre = data?.espaciosDisponibles?.[0]
      if (!libre) { setErrorTemp('No hay espacios libres para asignar'); return }
      const r = await ocuparTemporal({ variables: { espacioId: parseInt(libre.id), vtId } })
      const e = r.data?.ocuparEspacioTemporal?.espacio
      setErrorTemp('')
      refetchTemporales()
      refetchStats()
      if (e) setEspacioAsignadoMsg(`${placa} → ${e.zona.nombre} #${e.numero} ✓`)
      setTimeout(() => setEspacioAsignadoMsg(''), 4000)
    } catch (err: any) {
      setErrorTemp(err?.message ?? 'No se pudo asignar el espacio')
    }
  }, [apolloClient, ocuparTemporal, refetchTemporales, refetchStats])
  const [registrarTemporal, { loading: loadingTemporal }] = useMutation(REGISTRAR_ACCESO_TEMPORAL_MUTATION, {
    onCompleted: () => { setFormTemp({ placa: '', tipo: 'visitante', destino: '', responsable: '', duracion: '1' }); refetchTemporales() },
    onError: (e) => setErrorTemp(e.message),
  })
  const [registrarSalidaTemporal, { loading: loadingSalidaTemp }] = useMutation(REGISTRAR_SALIDA_TEMPORAL_MUTATION, {
    onCompleted: () => refetchTemporales(),
  })
  const [formTemp, setFormTemp] = useState({ placa: '', tipo: 'visitante', destino: '', responsable: '', duracion: '1' })
  const [errorTemp, setErrorTemp] = useState('')

  const temporales = temporalesData?.vehiculosTemporalesActivos ?? []

  const { data: alertasData, refetch: refetchAlertas } = useQuery(ALERTAS_PANEL_QUERY, {
    variables: { limite: 20 },
    pollInterval: 20_000,
    fetchPolicy: 'network-only',
  })
  const [marcarRevisada] = useMutation(MARCAR_ALERTA_REVISADA_MUTATION, {
    onCompleted: () => refetchAlertas(),
  })

  // Alertas en tiempo real — se añaden por WS desde Layout.tsx via evento DOM
  const [alertasLocales, setAlertasLocales] = useState<AlertaInfo[]>([])
  // Sonido on/off (persistido) — el guardia opera de oído sin mirar la pantalla.
  const [sonidoOn, setSonidoOn] = useState(() => localStorage.getItem('guardia_sonido') !== 'off')
  const toggleSonido = useCallback(() => {
    setSonidoOn(v => { localStorage.setItem('guardia_sonido', v ? 'off' : 'on'); return !v })
  }, [])

  // Tono sintetizado (Web Audio) — sin assets. tipo: ok | denegado | alerta.
  const reproducirTono = useCallback((kind: 'ok' | 'denegado' | 'alerta') => {
    if (!sonidoOn) return
    try {
      const ctx = new AudioContext()
      const beep = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.25, ctx.currentTime + start)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
        osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur)
      }
      if (kind === 'ok') {
        beep(880, 0, 0.12)                         // un pitido alto y corto = aceptado
      } else if (kind === 'denegado') {
        beep(220, 0, 0.18); beep(180, 0.2, 0.25)   // dos graves descendentes = denegado
      } else {
        beep(880, 0, 0.15); beep(880, 0.22, 0.15); beep(880, 0.44, 0.3)  // triple = alerta
      }
    } catch { /* sin audio en algunos navegadores */ }
  }, [sonidoOn])

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const d = e.detail as AlertaInfo
      setAlertasLocales(prev => {
        if (prev.some(a => a.id === d.id)) return prev
        return [d, ...prev].slice(0, 20)
      })
      if (d.severidad === 'critica') reproducirTono('alerta')
    }
    window.addEventListener('alerta-acceso', handler as EventListener)
    return () => window.removeEventListener('alerta-acceso', handler as EventListener)
  }, [reproducirTono])

  // Sonido al recibir un resultado: aceptado vs denegado (el guardia lo oye
  // sin mirar la pantalla — más rápido en un portón ruidoso).
  const ultimoResultadoRef = useRef<ResultadoAcceso | null>(null)
  useEffect(() => {
    const r = acceso.resultado
    if (r && r !== ultimoResultadoRef.current) {
      ultimoResultadoRef.current = r
      reproducirTono(r.ok ? 'ok' : 'denegado')
    }
  }, [acceso.resultado, reproducirTono])

  // Modal de alerta crítica — se muestra cuando el escaneo detecta alertas
  const [modalAlertas, setModalAlertas] = useState<AlertaInfo[] | null>(null)
  const [placaModal, setPlacaModal]     = useState('')

  const stats    = statsData?.dashboardStats
  const puntos   = puntosData?.puntosAcceso ?? []
  const registros = registrosData?.registrosAcceso ?? []
  const todasVisitas   = visitasData?.visitasActivas ?? []
  const visitasPendientes = todasVisitas.filter((v: any) => v.estado === 'pendiente')
  const visitasActivas    = todasVisitas.filter((v: any) => v.estado === 'activa')

  // Callback de escaneo QR — depende de registrarQr (estable) no de acceso (objeto)
  const handleQrScan = useCallback(async (codigo: string) => {
    setCamara(false)
    await registrarQr(codigo, tipo)
    refetchRegistros()
    refetchStats()
    refetchAforo()
  }, [registrarQr, tipo, refetchRegistros, refetchStats, refetchAforo])

  // Callback de placa manual — depende de registrarManual (estable)
  const handleManual = useCallback(async () => {
    if (!placaManual.trim()) return
    setVehiculoNoEncontrado('')
    try {
      await registrarManual(placaManual, tipo)
      setPlaca('')
      refetchRegistros()
      refetchStats()
      refetchAforo()
    } catch (e: any) {
      const msg = e?.message ?? ''
      if (msg.toLowerCase().includes('no registrado') || msg.toLowerCase().includes('no encontrado')) {
        setVehiculoNoEncontrado(placaManual.trim().toUpperCase())
      }
    }
  }, [registrarManual, placaManual, tipo, refetchRegistros, refetchStats, refetchAforo])

  // Callback de placa OCR detectada — recibe también el frame para evidencia.
  const handlePlacaOcr = useCallback(async (placa: string, frameB64?: string) => {
    setPlacaOcr(false)
    setVehiculoNoEncontrado('')
    try {
      await registrarManual(placa, tipo, frameB64)
      refetchRegistros()
      refetchStats()
      refetchAforo()
    } catch (e: any) {
      const msg = e?.message ?? ''
      if (msg.toLowerCase().includes('no registrado') || msg.toLowerCase().includes('no encontrado')) {
        setVehiculoNoEncontrado(placa)
      }
    }
  }, [registrarManual, tipo, refetchRegistros, refetchStats, refetchAforo])

  const resultado = acceso.resultado

  // Confirmación de una sugerencia de placa cercana: re-registra con la placa
  // REAL almacenada (un toque), tras la verificación visual del guardia.
  const confirmarSugerencia = useCallback(async (placaReal: string) => {
    await registrarManual(placaReal, tipo)
    refetchRegistros()
    refetchStats()
  }, [registrarManual, tipo, refetchRegistros, refetchStats])

  // Asignación de espacio de un toque tras la entrada.
  const [asignarEspacio, { loading: asignandoEspacio }] = useMutation(INICIAR_SESION_MUTATION)
  const handleAsignarEspacio = useCallback(async (espacioId: number, vehiculoId: number, numero: string, zona: string) => {
    try {
      await asignarEspacio({ variables: { input: { espacioId, vehiculoId } } })
      setEspacioAsignadoMsg(`Espacio ${numero} (${zona}) asignado ✓`)
      refetchStats()
      setTimeout(() => setEspacioAsignadoMsg(''), 4000)
    } catch (e: any) {
      setEspacioAsignadoMsg(`No se pudo asignar: ${e?.message ?? 'error'}`)
      setTimeout(() => setEspacioAsignadoMsg(''), 5000)
    }
  }, [asignarEspacio, refetchStats])

  // Verificar alertas cada vez que llega un resultado de acceso
  useEffect(() => {
    if (resultado?.ok && resultado.alertas?.length) {
      const criticas = resultado.alertas.filter(a => a.severidad === 'critica')
      if (criticas.length > 0) {
        setPlacaModal(resultado.placa ?? '')
        setModalAlertas(criticas)
      }
      refetchAlertas()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado])

  const alertasPanel = [
    ...(alertasData?.alertasActivasPanel ?? []),
    ...alertasLocales.filter(al => !(alertasData?.alertasActivasPanel ?? []).some((a: any) => a.id === al.id)),
  ] as AlertaInfo[]
  const alertasCriticas   = alertasPanel.filter(a => a.severidad === 'critica').length
  const alertasAdvertencia = alertasPanel.filter(a => a.severidad === 'advertencia').length

  const SEVERIDAD_COLOR: Record<string, string> = {
    critica:    'border-red-400 bg-red-50',
    advertencia:'border-amber-400 bg-amber-50',
    info:       'border-blue-300 bg-blue-50',
  }
  const SEVERIDAD_BADGE: Record<string, string> = {
    critica:    'bg-red-100 text-red-700',
    advertencia:'bg-amber-100 text-amber-700',
    info:       'bg-blue-100 text-blue-700',
  }
  const TIPO_LABEL: Record<string, string> = {
    frecuencia_excesiva: 'Frecuencia excesiva',
    vehiculo_sancionado: 'Sanciones pendientes',
    horario_inusual:     'Horario inusual',
    punto_inusual:       'Punto inusual',
    placas_similares:    'Placas similares',
    documento_vencido:   'Documento vencido',
  }

  return (
    <>
    <div className="p-4 sm:p-6 min-h-screen bg-slate-50">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 text-white p-2.5 rounded-xl shrink-0">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold text-slate-800">Control de Acceso</h1>
            <p className="text-xs text-slate-400">Panel del guardia</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Indicador de conectividad + pendientes offline */}
          <div className="flex items-center gap-1.5">
            {offlineAcc.pendientes > 0 && (
              <button
                onClick={offlineAcc.sincronizarAhora}
                disabled={!offlineAcc.online || offlineAcc.sincronizando}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium"
                title="Accesos guardados sin sincronizar — clic para sincronizar"
              >
                {offlineAcc.sincronizando
                  ? <Loader2 size={10} className="animate-spin" />
                  : <WifiOff size={10} />}
                {offlineAcc.pendientes} pendiente{offlineAcc.pendientes !== 1 ? 's' : ''}
              </button>
            )}
            <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full font-medium ${
              offlineAcc.online ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}>
              {offlineAcc.online ? <Wifi size={12} /> : <WifiOff size={12} />}
              <span className="hidden sm:inline">
                {offlineAcc.online ? 'Conectado' : '📴 Sin red — modo offline'}
              </span>
            </div>
            <button onClick={toggleSonido} title={sonidoOn ? 'Silenciar sonido' : 'Activar sonido'}
              className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                sonidoOn ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-slate-100 text-slate-300'
              }`}>
              {sonidoOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
          </div>

          {/* Selector de punto de acceso */}
          <select
            value={acceso.puntoId ?? ''}
            onChange={e => acceso.setPuntoId(e.target.value ? parseInt(e.target.value) : null)}
            className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs sm:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-400 max-w-[160px] sm:max-w-[200px]"
          >
            <option value="">Seleccionar punto...</option>
            {puntos.map((p: { id: number; nombre: string }) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Selector de tabs principal ─────────────────────────── */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl">
        {([
          { id: 'acceso',     label: 'Control de Acceso',  icon: ShieldCheck, badge: 0, corto: 'Acceso' },
          { id: 'temporales', label: 'Accesos Temporales', icon: Truck,
            badge: temporales.filter((t: any) => t.vencido).length, corto: 'Temporales' },
          { id: 'campus',     label: 'En campus',          icon: DoorOpen, badge: 0, corto: 'En campus' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => { setTabPrincipal(t.id); if (t.id === 'campus') refetchCampus() }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tabPrincipal === t.id ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <t.icon size={13} />
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.corto}</span>
            {t.badge > 0 && (
              <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Aviso sin punto seleccionado ───────────────────────── */}
      {!acceso.puntoId && tabPrincipal === 'acceso' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-amber-800 text-sm text-center">
          Selecciona un punto de acceso para empezar a registrar
        </div>
      )}

      {/* ── Banner modo offline ─────────────────────────────────── */}
      {!offlineAcc.online && (
        <div className="bg-slate-800 text-white rounded-xl px-4 py-3 mb-4 flex items-center gap-3 text-sm">
          <WifiOff size={18} className="text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm">Modo offline activo</p>
            <p className="text-xs text-slate-300">
              QR dinámico deshabilitado. Usa <strong>Placa OCR</strong> o <strong>Manual</strong>.
              Los accesos se guardarán y sincronizarán al recuperar la red.
            </p>
          </div>
          {offlineAcc.pendientes > 0 && (
            <span className="bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
              {offlineAcc.pendientes}
            </span>
          )}
        </div>
      )}

      {/* ── Confirmación sync completada ────────────────────────── */}
      {offlineAcc.ultimaSync && offlineAcc.pendientes === 0 && offlineAcc.online && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl px-4 py-2 mb-4 text-xs flex items-center gap-2">
          <CheckCircle2 size={14} />
          ✅ Accesos sincronizados correctamente · {offlineAcc.ultimaSync}
        </div>
      )}

      {/* ── Stats rápidas ──────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
          <StatChip icon={DoorOpen}      label="Accesos hoy"   value={stats.accesosHoy}  color="text-orange-500" />
          <StatChip icon={ParkingSquare} label="Espacios"      value={`${stats.espaciosDisponibles}/${stats.totalEspacios}`} color="text-violet-500" />
          <StatChip icon={UserCheck}     label="Visitantes"    value={stats.visitantesActivos} color="text-cyan-500" />
        </div>
      )}

      {/* ── Aforo del campus (control de capacidad / evacuación) ── */}
      {aforo && (
        <div className={`mb-4 rounded-xl p-3 border ${
          aforo.estado === 'lleno' ? 'bg-red-50 border-red-300' :
          aforo.estado === 'alto'  ? 'bg-amber-50 border-amber-300' :
          'bg-slate-50 border-slate-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
              <DoorOpen size={13} /> Aforo del campus
            </span>
            <span className={`text-sm font-black ${
              aforo.estado === 'lleno' ? 'text-red-600' :
              aforo.estado === 'alto'  ? 'text-amber-600' : 'text-slate-700'
            }`}>
              {aforo.maximo > 0
                ? `${aforo.dentro} / ${aforo.maximo}`
                : `${aforo.dentro} dentro`}
            </span>
          </div>
          {aforo.maximo > 0 && (
            <>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  aforo.estado === 'lleno' ? 'bg-red-500' :
                  aforo.estado === 'alto'  ? 'bg-amber-500' : 'bg-emerald-500'
                }`} style={{ width: `${Math.min(100, aforo.porcentaje)}%` }} />
              </div>
              {aforo.estado === 'lleno' && (
                <p className="text-[11px] font-semibold text-red-600 mt-1">
                  ⚠ Campus al límite — considere desviar al estacionamiento externo.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════ TAB TEMPORALES ══════════════════════════ */}
      {tabPrincipal === 'temporales' && (
        <div className="space-y-4">
          {/* Formulario de registro */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Plus size={15} className="text-orange-500" />
              <h2 className="text-sm font-semibold text-slate-700">Registrar vehículo externo</h2>
            </div>
            {errorTemp && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                {errorTemp}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Placa *</label>
                <input type="text" placeholder="1234-ABC"
                  value={formTemp.placa}
                  onChange={e => { setErrorTemp(''); setFormTemp(p => ({ ...p, placa: e.target.value.toUpperCase() })) }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Tipo *</label>
                <select value={formTemp.tipo}
                  onChange={e => setFormTemp(p => ({ ...p, tipo: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="proveedor">🚚 Proveedor / Entrega</option>
                  <option value="mantenimiento">🔧 Mantenimiento</option>
                  <option value="emergencia">🚨 Emergencia</option>
                  <option value="visitante">👤 Visitante</option>
                  <option value="otro">📋 Otro</option>
                </select>
              </div>
            </div>
            <div className="mb-2">
              <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Destino / Área *</label>
              <input type="text" placeholder="Ej: Bloque Administrativo, Cafetería..."
                value={formTemp.destino}
                onChange={e => setFormTemp(p => ({ ...p, destino: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Responsable</label>
                <input type="text" placeholder="Nombre de quien autoriza"
                  value={formTemp.responsable}
                  onChange={e => setFormTemp(p => ({ ...p, responsable: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Duración</label>
                <select value={formTemp.duracion}
                  onChange={e => setFormTemp(p => ({ ...p, duracion: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  <option value="0.5">30 minutos</option>
                  <option value="1">1 hora</option>
                  <option value="2">2 horas</option>
                  <option value="4">4 horas</option>
                  <option value="8">8 horas (máx.)</option>
                </select>
              </div>
            </div>
            <button
              disabled={loadingTemporal || !formTemp.placa.trim() || !formTemp.destino.trim()}
              onClick={() => {
                setErrorTemp('')
                registrarTemporal({ variables: {
                  placa:        formTemp.placa.trim(),
                  tipo:         formTemp.tipo,
                  destino:      formTemp.destino.trim(),
                  duracionHoras: parseFloat(formTemp.duracion),
                  responsable:  formTemp.responsable.trim(),
                }})
              }}
              className="w-full flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-sm disabled:opacity-40 transition-colors">
              {loadingTemporal ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Registrar ingreso temporal
            </button>
          </div>

          {espacioAsignadoMsg && (
            <div className="bg-green-50 border border-green-300 rounded-xl p-2.5 text-xs font-semibold text-green-800 flex items-center gap-2">
              <ParkingSquare size={14} /> {espacioAsignadoMsg}
            </div>
          )}

          {/* Lista de vehículos temporales activos */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Timer size={15} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">En campus ahora</h2>
              {temporales.length > 0 && (
                <span className="ml-auto text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-medium">
                  {temporales.length} activo{temporales.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {temporales.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Truck size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sin vehículos externos en campus</p>
              </div>
            ) : (
              <div className="space-y-2">
                {temporales.map((vt: any) => {
                  const porcent = Math.max(0, Math.min(100, (vt.minutosRestantes / (parseFloat(formTemp.duracion || '1') * 60)) * 100))
                  const critico = vt.minutosRestantes <= 15 && vt.activo
                  const vencido = vt.vencido
                  return (
                    <div key={vt.id}
                      className={`rounded-xl border-l-4 p-3 ${
                        vencido ? 'border-red-500 bg-red-50' :
                        critico ? 'border-amber-400 bg-amber-50' :
                        'border-slate-300 bg-slate-50'
                      }`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-slate-800 text-sm">{vt.placa}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            vencido ? 'bg-red-100 text-red-700' :
                            critico ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {vt.tipoDisplay}
                          </span>
                        </div>
                        <div className={`text-xs font-bold flex items-center gap-1 ${
                          vencido ? 'text-red-600' : critico ? 'text-amber-600' : 'text-slate-600'
                        }`}>
                          <Clock size={11} />
                          {vencido ? '¡Vencido!' : `${vt.minutosRestantes}min`}
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 truncate">{vt.destino}</p>
                      {vt.responsable && <p className="text-[10px] text-slate-400">Resp: {vt.responsable}</p>}
                      {/* Espacio de parqueo: muestra el asignado o permite asignar uno */}
                      {vt.espacioParqueo ? (
                        <p className="text-[10px] text-violet-700 mt-1 flex items-center gap-1">
                          <ParkingSquare size={10} /> {vt.espacioParqueo}
                        </p>
                      ) : (
                        <button
                          disabled={ocupandoTemporal}
                          onClick={() => handleOcuparTemporal(vt.id, vt.placa)}
                          className="mt-1 text-[10px] text-violet-600 hover:text-violet-800 transition-colors disabled:opacity-40 flex items-center gap-1">
                          <ParkingSquare size={10} /> Asignar espacio
                        </button>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full transition-all"
                            style={{ width: `${100 - porcent}%`, background: vencido ? '#ef4444' : critico ? '#f59e0b' : '#22c55e' }} />
                        </div>
                        <button
                          disabled={loadingSalidaTemp}
                          onClick={() => registrarSalidaTemporal({ variables: { placa: vt.placa } })}
                          className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg transition-colors shrink-0">
                          <LogOut size={11} /> Salida
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ TAB EN CAMPUS (parte de control) ════════ */}
      {tabPrincipal === 'campus' && (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <DoorOpen size={16} className="text-blue-600" /> Vehículos aún en campus
              </h3>
              <p className="text-[11px] text-slate-400">Último acceso = entrada. Útil para el cierre de jornada.</p>
            </div>
            <span className="text-sm font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-lg">{enCampus.length}</span>
          </div>
          {enCampus.length === 0 ? (
            <p className="text-center py-10 text-slate-400 text-sm">No hay vehículos dentro del campus en este momento.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Placa</th>
                    <th className="px-4 py-2 text-left">Vehículo</th>
                    <th className="px-4 py-2 text-left">Propietario</th>
                    <th className="px-4 py-2 text-left">Ingresó</th>
                    <th className="px-4 py-2 text-left">Parqueo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {enCampus.map((v: any) => (
                    <tr key={v.vehiculoId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 font-mono font-bold text-slate-800">{v.placa}</td>
                      <td className="px-4 py-2 text-slate-600 text-xs">{v.marcaModelo}</td>
                      <td className="px-4 py-2 text-slate-600 text-xs">
                        {v.propietarioNombre}
                        {v.propietarioTelefono && <span className="text-slate-400"> · {v.propietarioTelefono}</span>}
                      </td>
                      <td className="px-4 py-2 text-slate-500 text-xs">
                        {new Date(v.horaEntrada).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {v.espacioParqueo
                          ? <span className="text-violet-700 font-medium">{v.espacioParqueo}</span>
                          : <span className="text-slate-300">— sin asignar</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Throughput del portón — sustenta "no generamos colas" con datos */}
          {despacho.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-3">
              <h4 className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1.5">
                <Timer size={13} className="text-emerald-600" /> Tiempo de despacho (últimos 7 días)
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {despacho.map((m: any) => (
                  <div key={m.puntoNombre} className="bg-slate-50 rounded-lg px-3 py-2 text-xs">
                    <p className="font-semibold text-slate-700 truncate">{m.puntoNombre}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-slate-500">
                      <span>{m.totalAccesos} accesos</span>
                      {m.segundosMediana != null && (
                        <span className="text-emerald-700 font-medium">
                          ~{m.segundosMediana}s entre vehículos
                        </span>
                      )}
                      {m.horaPico != null && <span>pico: {String(m.horaPico).padStart(2, '0')}:00 h</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════ TAB ACCESO (original) ═══════════════════ */}
      {tabPrincipal === 'acceso' && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Panel izquierdo: controles ─────────────────────── */}
        <div className="space-y-3">

          {/* Modo de registro — Auto (recomendado) + override manual.
              En Auto el sistema decide entrada/salida por el estado del vehículo:
              cero errores de dirección y flujo mixto sin fricción en hora pico. */}
          <div>
            <button onClick={() => setTipo('auto')}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-colors
                ${tipo === 'auto'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'}`}
            >
              <Repeat size={18} />
              Automático {tipo === 'auto' && '· el sistema detecta entrada/salida'}
            </button>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(['entrada', 'salida'] as TipoAcceso[]).map(t => (
                <button key={t} onClick={() => setTipo(t)}
                  className={`flex items-center justify-center gap-2 py-2 rounded-xl font-medium text-sm transition-colors
                    ${t === tipo
                      ? t === 'entrada' ? 'bg-green-500 text-white shadow-lg shadow-green-200' : 'bg-red-500 text-white shadow-lg shadow-red-200'
                      : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
                    }`}
                >
                  {t === 'entrada' ? <ArrowDownCircle size={16} /> : <ArrowUpCircle size={16} />}
                  Forzar {t === 'entrada' ? 'entrada' : 'salida'}
                </button>
              ))}
            </div>
          </div>

          {/* ── Selector de modo: QR / Placa OCR / Manual ─────── */}
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { id: 'qr',     label: '📷 QR',    icon: Camera  },
              { id: 'placa',  label: '🔤 Placa',  icon: Type    },
              { id: 'manual', label: '⌨️ Manual', icon: Keyboard },
            ] as { id: ModoScanner; label: string; icon: React.ElementType }[]).map(m => (
              <button key={m.id}
                onClick={() => {
                  setModo(m.id)
                  setCamara(m.id === 'qr' && acceso.puntoId !== null)
                  setPlacaOcr(m.id === 'placa' && acceso.puntoId !== null)
                  setVehiculoNoEncontrado('')
                }}
                disabled={!acceso.puntoId}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition-colors border disabled:opacity-40
                  ${modo === m.id
                    ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Scanner QR */}
          {modo === 'qr' && camaraActiva && (
            <div className="rounded-xl overflow-hidden border-2 border-orange-200">
              <QrScanner activo={camaraActiva} onScan={handleQrScan} />
            </div>
          )}

          {/* Scanner Placa OCR */}
          {modo === 'placa' && placaActiva && (
            <div className="rounded-xl overflow-hidden border-2 border-blue-200">
              <PlacaScanner activo={placaActiva} onPlacaDetectada={handlePlacaOcr} />
            </div>
          )}

          {/* Vehículo sin registro → opción de infracción */}
          {vehiculoNoEncontrado && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
              <p className="text-sm font-semibold text-amber-800">
                🚫 Vehículo <span className="font-mono">{vehiculoNoEncontrado}</span> sin registro
              </p>
              <p className="text-xs text-amber-700">¿Deseas registrar una infracción?</p>
              <div className="flex gap-2">
                <a href={`/infracciones?placa=${vehiculoNoEncontrado}`}
                  className="flex-1 text-center text-xs bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-lg font-medium transition-colors">
                  Registrar infracción
                </a>
                <button onClick={() => setVehiculoNoEncontrado('')}
                  className="text-xs text-amber-600 hover:text-amber-800 px-3 py-2 rounded-lg border border-amber-300 hover:bg-amber-100 transition-colors">
                  Ignorar
                </button>
              </div>
            </div>
          )}

          {/* ── Procesando QR: feedback inmediato antes de respuesta de red ── */}
          {acceso.procesandoQr && !resultado && (
            <div className="animate-fade-slide-up rounded-2xl p-5 flex items-center gap-4 border-2 bg-blue-50 border-blue-300 text-blue-800 shadow-lg shadow-blue-100">
              <Loader2 size={44} className="text-blue-500 shrink-0 animate-spin" />
              <div>
                <p className="font-black text-xl leading-tight">Verificando acceso...</p>
                <p className="text-sm font-medium opacity-70 mt-0.5">Consultando el sistema</p>
              </div>
            </div>
          )}

          {/* ── Resultado QR: bounce (éxito) o spring (error) ── */}
          {resultado && (
            <div
              className={`rounded-2xl p-5 flex items-center gap-4 border-2 ${
                resultado.ok
                  ? 'bg-green-50 border-green-400 text-green-800 shadow-lg shadow-green-100 animate-bounce-top'
                  : 'bg-red-50 border-red-400 text-red-800 shadow-lg shadow-red-100'
              }`}
              style={!resultado.ok ? { animation: 'resultadoEntrar 0.15s cubic-bezier(0.34,1.56,0.64,1) both' } : {}}
            >
              {/* Foto del propietario para verificación visual (¿conduce el dueño?).
                  Ícono de estado cuando no hay foto o el acceso fue denegado. */}
              {resultado.ok && resultado.propietarioFotoUrl ? (
                <img src={resultado.propietarioFotoUrl} alt="Propietario"
                  className="w-16 h-16 rounded-xl object-cover shrink-0 border-2 border-green-300 shadow" />
              ) : resultado.ok ? (
                <CheckCircle2 size={44} className="text-green-500 shrink-0" />
              ) : (
                <XCircle size={44} className="text-red-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                {resultado.placa && (
                  <p className="font-black text-2xl font-mono tracking-widest leading-tight">
                    {resultado.placa}
                  </p>
                )}
                <p className="text-sm font-semibold mt-0.5">{resultado.mensaje}</p>
                {resultado.ok && resultado.esFrecuente && (
                  <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-bold bg-emerald-600 text-white px-2 py-0.5 rounded-full">
                    ⚡ CARRIL EXPRESS · despacho inmediato
                  </span>
                )}
                {resultado.ok && resultado.propietarioNombre && (
                  <p className="text-xs font-medium mt-0.5 flex items-center gap-1">
                    <UserCheck size={12} /> {resultado.propietarioNombre}
                  </p>
                )}
                {resultado.metodo && (
                  <p className="text-xs opacity-70 mt-0.5">
                    {METODO_LABEL[resultado.metodo] ?? resultado.metodo}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Sugerencias de placa cercana (OCR mal leído) ── */}
          {resultado && !resultado.ok && (resultado.sugerencias?.length ?? 0) > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
              <p className="text-xs font-bold text-amber-800 mb-2 flex items-center gap-1.5">
                <AlertTriangle size={13} /> ¿Quisiste registrar alguno de estos?
              </p>
              <div className="space-y-2">
                {resultado.sugerencias!.map(s => (
                  <button key={s.id} onClick={() => confirmarSugerencia(s.placa)}
                    className="w-full flex items-center justify-between gap-2 bg-white hover:bg-amber-100 border border-amber-200 rounded-xl px-3 py-2 transition-colors text-left">
                    <div className="min-w-0">
                      <p className="font-mono font-bold text-sm text-slate-800 tracking-wider">{s.placa}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {s.marca} {s.modelo} · {s.color} · {s.propietarioNombre}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-lg">
                      Confirmar →
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-amber-600 mt-2">
                Verifica la placa contra el vehículo físico antes de confirmar.
              </p>
            </div>
          )}

          {/* ── Asignación de espacio de un toque tras la entrada ── */}
          {espacioAsignadoMsg && (
            <div className="bg-green-50 border border-green-300 rounded-xl p-3 text-sm font-semibold text-green-800 flex items-center gap-2">
              <ParkingSquare size={16} /> {espacioAsignadoMsg}
            </div>
          )}
          {resultado?.ok && resultado.espacioSugerido && !espacioAsignadoMsg && (
            <div className="bg-violet-50 border border-violet-300 rounded-xl p-4">
              <p className="text-xs font-bold text-violet-800 mb-1 flex items-center gap-1.5">
                <ParkingSquare size={14} /> Espacio libre sugerido
              </p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-lg text-slate-800">
                    #{resultado.espacioSugerido.numero}
                    <span className="text-xs font-medium text-slate-500 ml-2">{resultado.espacioSugerido.zonaNombre}</span>
                  </p>
                  <p className="text-[11px] text-violet-600">Categoría: {resultado.espacioSugerido.categoriaNombre}</p>
                </div>
                <button
                  disabled={asignandoEspacio}
                  onClick={() => handleAsignarEspacio(
                    resultado.espacioSugerido!.espacioId,
                    resultado.espacioSugerido!.vehiculoId,
                    resultado.espacioSugerido!.numero,
                    resultado.espacioSugerido!.zonaNombre,
                  )}
                  className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {asignandoEspacio ? <Loader2 size={14} className="animate-spin" /> : <ParkingSquare size={14} />}
                  Asignar espacio
                </button>
              </div>
            </div>
          )}

          {/* ── Guía de parqueo (fallback cuando no hay espacio sugerido) ── */}
          {resultado?.ok && resultado.mensaje.startsWith('Entrada') && !resultado.espacioSugerido && !espacioAsignadoMsg && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 flex items-center gap-3">
              <span className="text-xl shrink-0">🅿</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-violet-800">¿El propietario necesita orientación de parqueo?</p>
                <p className="text-[10px] text-violet-600">Puede usar la guía interactiva del campus</p>
              </div>
              <a href="/parqueo-demo"
                className="shrink-0 text-xs bg-violet-500 hover:bg-violet-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap">
                Ver guía →
              </a>
            </div>
          )}

          {/* Indicador de reintento */}
          {acceso.conexion.reintentando && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <RefreshCw size={12} className="animate-spin" />
              Reintentando... (intento {acceso.conexion.intentos}/{3})
            </div>
          )}

          {/* Placa manual */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Ingreso manual por placa
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={placaManual}
                onChange={e => setPlaca(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleManual()}
                placeholder="1234-ABC"
                disabled={!acceso.puntoId}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40"
              />
              <button
                onClick={handleManual}
                disabled={acceso.procesando || !placaManual.trim() || !acceso.puntoId}
                className="bg-orange-500 hover:bg-orange-600 text-white px-4 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {acceso.procesando ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : 'OK'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Panel derecho: log en vivo ─────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={15} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Últimos accesos</h2>
            <span className="ml-auto text-[10px] text-slate-400 italic">actualiza cada 15s</span>
          </div>

          {registros.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <DoorOpen size={32} className="mx-auto mb-2 opacity-30" />
              Sin registros aún en este turno
            </div>
          ) : (
            <div className="space-y-1.5">
              {registros.map((r: {
                id: number; tipo: string; placaVehiculo: string | null;
                timestamp: string; metodoAcceso: string;
              }) => (
                <div key={r.id}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    r.tipo === 'entrada' ? 'bg-green-50' : 'bg-red-50'
                  }`}
                >
                  <span className={`font-bold text-xs w-10 shrink-0 ${r.tipo === 'entrada' ? 'text-green-700' : 'text-red-700'}`}>
                    {r.tipo === 'entrada' ? '▼ ENT' : '▲ SAL'}
                  </span>
                  <span className="font-mono font-bold text-slate-800 flex-1">
                    {r.placaVehiculo ?? '—'}
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {METODO_LABEL[r.metodoAcceso] ?? r.metodoAcceso}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {new Date(r.timestamp).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}
      {/* ── Panel de visitantes en espera — contexto del turno ── */}
      {(visitasPendientes.length > 0 || visitasActivas.length > 0) && (
        <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck size={15} className="text-cyan-500" />
            <h2 className="text-sm font-semibold text-slate-700">Visitantes en el campus</h2>
            <div className="ml-auto flex gap-2">
              {visitasPendientes.length > 0 && (
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  {visitasPendientes.length} esperando
                </span>
              )}
              {visitasActivas.length > 0 && (
                <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  {visitasActivas.length} dentro
                </span>
              )}
            </div>
          </div>
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {[...visitasPendientes, ...visitasActivas].map((v: any) => (
              <div key={v.id} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${
                v.estado === 'pendiente' ? 'bg-amber-50' : 'bg-green-50'
              }`}>
                <span className={`font-bold w-14 shrink-0 ${v.estado === 'pendiente' ? 'text-amber-700' : 'text-green-700'}`}>
                  {v.estado === 'pendiente' ? '⏳ ESP' : '✓ DEN'}
                </span>
                <span className="font-semibold text-slate-800 flex-1 truncate">
                  {v.visitante?.nombreCompleto ?? '—'}
                </span>
                {v.placaVehiculoVisitante && (
                  <span className="font-mono text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded border border-violet-200 shrink-0">
                    {v.placaVehiculoVisitante}
                  </span>
                )}
                <span className="text-slate-400 truncate hidden sm:block">→ {v.anfitrionNombre}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ── Panel de alertas activas ──────────────────────────────────── */}
      {alertasPanel.length > 0 && (
        <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell size={15} className="text-red-500" />
            <h2 className="text-sm font-semibold text-slate-700">Alertas de seguridad</h2>
            <div className="ml-auto flex gap-1.5">
              {alertasCriticas > 0 && (
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full animate-pulse">
                  {alertasCriticas} crítica{alertasCriticas > 1 ? 's' : ''}
                </span>
              )}
              {alertasAdvertencia > 0 && (
                <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  {alertasAdvertencia} advertencia{alertasAdvertencia > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {alertasPanel.map((al) => (
              <div key={al.id}
                className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border-l-4 ${SEVERIDAD_COLOR[al.severidad] ?? 'border-slate-300 bg-slate-50'}`}>
                <AlertTriangle size={14} className={`shrink-0 mt-0.5 ${al.severidad === 'critica' ? 'text-red-500' : 'text-amber-500'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${SEVERIDAD_BADGE[al.severidad] ?? ''}`}>
                      {al.severidad.toUpperCase()}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-600">
                      {TIPO_LABEL[al.tipoAnomalia] ?? al.tipoAnomalia}
                    </span>
                    {al.vehiculoPlaca && (
                      <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border">
                        {al.vehiculoPlaca}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{al.descripcion}</p>
                </div>
                <button
                  onClick={() => marcarRevisada({ variables: { alertaId: al.id } })}
                  className="shrink-0 flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-600 transition-colors mt-0.5">
                  <Eye size={12} /> OK
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* ── Modal de alerta crítica ─────────────────────────────────────────── */}
    {modalAlertas && (
      <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl p-6 max-w-sm w-full">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center shrink-0">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-base">Alerta de seguridad</h2>
              {placaModal && (
                <p className="text-slate-500 text-xs">Vehículo: <strong className="font-mono">{placaModal}</strong></p>
              )}
            </div>
          </div>

          <div className="space-y-2 mb-5">
            {modalAlertas.map(al => (
              <div key={al.id} className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-xs font-bold text-red-700">{TIPO_LABEL[al.tipoAnomalia] ?? al.tipoAnomalia}</p>
                <p className="text-xs text-red-600 mt-0.5 leading-relaxed">{al.descripcion}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-slate-500 mb-4 text-center">
            El acceso fue registrado. Toma la acción correspondiente.
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => {
                modalAlertas.forEach(al => marcarRevisada({ variables: { alertaId: al.id } }))
                setModalAlertas(null)
              }}
              className="flex-1 py-3 border-2 border-slate-200 text-slate-600 rounded-2xl font-semibold text-sm hover:bg-slate-50 transition-colors">
              Marcar revisado
            </button>
            <button
              onClick={() => setModalAlertas(null)}
              className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-bold text-sm transition-colors">
              Entendido
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ── Componente auxiliar ────────────────────────────────────────────────────

function StatChip({
  icon: Icon, label, value, color,
}: {
  icon: React.ElementType; label: string; value: string | number; color: string
}) {
  return (
    <div className="bg-white rounded-xl p-2.5 sm:p-3 shadow-sm flex items-center gap-2 border border-slate-100">
      <Icon size={16} className={`${color} shrink-0`} />
      <div className="min-w-0">
        <p className="text-base sm:text-lg font-bold text-slate-800 leading-none">{value}</p>
        <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  )
}
