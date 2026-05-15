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
import { useState, useEffect, useCallback } from 'react'
import { useQuery, gql } from '@apollo/client'
import {
  ShieldCheck, ArrowDownCircle, ArrowUpCircle, Camera, CameraOff,
  CheckCircle2, XCircle, Clock, ParkingSquare, UserCheck, DoorOpen,
  Wifi, WifiOff, RefreshCw,
} from 'lucide-react'
import { QrScanner } from '../components/QrScanner'
import { PUNTOS_ACCESO_QUERY, REGISTROS_ACCESO_QUERY } from '../graphql/queries/acceso'
import { VISITAS_ACTIVAS_QUERY } from '../graphql/queries/visitantes'
import { useAccesoGuardia, type TipoAcceso } from '../hooks/useAccesoGuardia'

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
  const [tipo, setTipo]             = useState<TipoAcceso>('entrada')
  const [camaraActiva, setCamara]   = useState(false)
  const [placaManual, setPlaca]     = useState('')
  const [online, setOnline]         = useState(navigator.onLine)

  // Hook de dominio con retry y manejo de errores
  const acceso = useAccesoGuardia()

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

  const stats    = statsData?.dashboardStats
  const puntos   = puntosData?.puntosAcceso ?? []
  const registros = registrosData?.registrosAcceso ?? []
  const todasVisitas   = visitasData?.visitasActivas ?? []
  const visitasPendientes = todasVisitas.filter((v: any) => v.estado === 'pendiente')
  const visitasActivas    = todasVisitas.filter((v: any) => v.estado === 'activa')

  // Callback de escaneo QR — cierra cámara y registra
  const handleQrScan = useCallback(async (codigo: string) => {
    setCamara(false)
    await acceso.registrarQr(codigo, tipo)
    refetchRegistros()
    refetchStats()
  }, [acceso, tipo, refetchRegistros, refetchStats])

  // Callback de placa manual
  const handleManual = useCallback(async () => {
    if (!placaManual.trim()) return
    await acceso.registrarManual(placaManual, tipo)
    setPlaca('')
    refetchRegistros()
    refetchStats()
  }, [acceso, placaManual, tipo, refetchRegistros, refetchStats])

  const resultado = acceso.resultado

  return (
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
          {/* Indicador de conectividad */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full font-medium ${
            online ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
          }`}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            <span className="hidden sm:inline">{online ? 'Conectado' : 'Sin red'}</span>
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

      {/* ── Aviso sin punto seleccionado ───────────────────────── */}
      {!acceso.puntoId && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-amber-800 text-sm text-center">
          Selecciona un punto de acceso para empezar a registrar
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Panel izquierdo: controles ─────────────────────── */}
        <div className="space-y-3">

          {/* Toggle Entrada/Salida */}
          <div className="grid grid-cols-2 gap-2">
            {(['entrada', 'salida'] as TipoAcceso[]).map(t => (
              <button key={t} onClick={() => setTipo(t)}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-colors
                  ${t === tipo
                    ? t === 'entrada' ? 'bg-green-500 text-white shadow-lg shadow-green-200' : 'bg-red-500 text-white shadow-lg shadow-red-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                  }`}
              >
                {t === 'entrada' ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
                {t === 'entrada' ? 'Entrada' : 'Salida'}
              </button>
            ))}
          </div>

          {/* Botón cámara */}
          <button
            onClick={() => setCamara(v => !v)}
            disabled={!acceso.puntoId}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors border disabled:opacity-40
              ${camaraActiva ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            {camaraActiva ? <><CameraOff size={16} /> Apagar cámara</> : <><Camera size={16} /> Escanear QR con cámara</>}
          </button>

          {/* Scanner */}
          {camaraActiva && (
            <div className="rounded-xl overflow-hidden border-2 border-orange-200">
              <QrScanner activo={camaraActiva} onScan={handleQrScan} />
            </div>
          )}

          {/* ── Resultado grande — visible desde lejos ─────────── */}
          {resultado && (
            <div className={`rounded-2xl p-5 flex items-center gap-4 border-2 transition-all ${
              resultado.ok
                ? 'bg-green-50 border-green-400 text-green-800'
                : 'bg-red-50 border-red-400 text-red-800'
            }`}>
              {resultado.ok
                ? <CheckCircle2 size={40} className="text-green-500 shrink-0" />
                : <XCircle     size={40} className="text-red-500 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                {resultado.placa && (
                  <p className="font-black text-2xl font-mono tracking-widest leading-tight">
                    {resultado.placa}
                  </p>
                )}
                <p className="text-sm font-semibold mt-0.5">{resultado.mensaje}</p>
                {resultado.metodo && (
                  <p className="text-xs opacity-70 mt-0.5">
                    {METODO_LABEL[resultado.metodo] ?? resultado.metodo}
                  </p>
                )}
              </div>
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
                placeholder="ABC-1234"
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
    </div>
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
