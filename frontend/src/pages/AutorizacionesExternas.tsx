/**
 * AutorizacionesExternas — Gestión de pre-autorizaciones de acceso para proveedores.
 *
 * Flujo:
 *  Admin/Secretaria crea la autorización con:
 *    placa + empresa + dependencia (buscable) + horario + email proveedor
 *  → Sistema genera código QR único y lo envía al proveedor
 *  → Proveedor llega a garita y muestra QR → guardia escanea → acceso registrado
 *
 * UX: sin selects genéricos — selector de dependencia con tarjetas buscables,
 *     presets de horario, feedback visual inmediato.
 */
import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import {
  Plus, X, QrCode, Copy, Trash2, CheckCircle,
  Building2, Clock, Mail, Truck, Search, Calendar,
  Loader2, Shield, ChevronRight, ExternalLink,
} from 'lucide-react'
import { AUTORIZACIONES_EXTERNAS_QUERY } from '../graphql/queries/acceso'
import { CREAR_AUTORIZACION_EXTERNA_MUTATION, REVOCAR_AUTORIZACION_EXTERNA_MUTATION } from '../graphql/mutations/acceso'
import { DEPENDENCIAS_QUERY } from '../graphql/queries/visitantes'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ESTADO_CFG: Record<string, { label: string; color: string; bg: string }> = {
  vigente:  { label: '✅ Vigente',  color: '#166534', bg: '#dcfce7' },
  pendiente:{ label: '⏳ Pendiente', color: '#854d0e', bg: '#fef9c3' },
  usada:    { label: '✓ Usada',     color: '#475569', bg: '#f1f5f9' },
  vencida:  { label: '⌛ Vencida',  color: '#9a3412', bg: '#fee2e2' },
  revocada: { label: '🚫 Revocada', color: '#991b1b', bg: '#fee2e2' },
}

function formatFecha(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })
}

// Presets de horario — adaptados al contexto universitario
const PRESETS_HORARIO = [
  { label: 'Mañana',        desde: '08:00', hasta: '12:00' },
  { label: 'Tarde',         desde: '13:00', hasta: '18:00' },
  { label: 'Día completo',  desde: '08:00', hasta: '18:00' },
  { label: 'Madrugada',     desde: '06:00', hasta: '08:00' },
]

// ── Selector de Dependencia ───────────────────────────────────────────────────
function DependenciaSelector({
  value, onChange,
}: { value: number | null; onChange: (id: number | null, nombre: string) => void }) {
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [selNombre, setSelNombre] = useState('')

  const { data } = useQuery(DEPENDENCIAS_QUERY, {
    variables: { buscar: buscar || undefined },
    skip: !abierto,
  })
  const deps = data?.dependenciasUagrm ?? []

  function seleccionar(dep: { id: number; nombre: string }) {
    onChange(dep.id, dep.nombre)
    setSelNombre(dep.nombre)
    setAbierto(false)
    setBuscar('')
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setAbierto(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${
          value ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
        }`}>
        <div className="flex items-center gap-2.5">
          <Building2 size={16} className={value ? 'text-blue-600' : 'text-slate-400'} />
          <span className={`text-sm ${value ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
            {value ? selNombre : 'Seleccionar dependencia de destino...'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {value && (
            <button type="button" onClick={e => { e.stopPropagation(); onChange(null, ''); setSelNombre('') }}
              className="p-1 hover:bg-red-100 rounded-lg transition-colors">
              <X size={13} className="text-red-500" />
            </button>
          )}
          <ChevronRight size={14} className={`text-slate-400 transition-transform ${abierto ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {abierto && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 overflow-hidden">
          <div className="p-3 border-b border-slate-100">
            <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                placeholder="Buscar dependencia..."
                value={buscar}
                onChange={e => setBuscar(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {deps.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-4">Sin resultados</p>
            ) : deps.map((d: any) => (
              <button key={d.id} type="button" onClick={() => seleccionar(d)}
                className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left">
                <Building2 size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{d.nombre}</p>
                  {d.ubicacion && <p className="text-[11px] text-slate-400">{d.ubicacion}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Formulario de nueva autorización ─────────────────────────────────────────
function FormularioNuevaAutorizacion({ onCreada, onCancelar }: {
  onCreada: (auth: any) => void
  onCancelar: () => void
}) {
  const hoy = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState({
    placa:          '',
    empresa:        '',
    motivo:         '',
    dependenciaId:  null as number | null,
    email:          '',
    fecha:          hoy,
    horaDesde:      '08:00',
    horaHasta:      '18:00',
    presetActivo:   'Día completo',
  })
  const [error, setError] = useState('')
  const [qrUrl, setQrUrl] = useState('')

  const [crear, { loading }] = useMutation(CREAR_AUTORIZACION_EXTERNA_MUTATION, {
    onCompleted(d) {
      const auth = d.crearAutorizacionExterna
      // Generar QR del código
      import('qrcode').then(QR =>
        QR.toDataURL(auth.codigoAcceso, { width: 200, margin: 2 }).then(setQrUrl)
      )
      onCreada(auth)
    },
    onError(e) { setError(e.message) },
  })

  function set(k: string, v: any) { setForm(p => ({ ...p, [k]: v })) }

  function aplicarPreset(p: typeof PRESETS_HORARIO[0]) {
    set('horaDesde', p.desde)
    set('horaHasta', p.hasta)
    set('presetActivo', p.label)
  }

  function handleSubmit() {
    setError('')
    if (!form.placa.trim() || !form.empresa.trim() || !form.motivo.trim()) {
      setError('Placa, empresa y motivo son obligatorios'); return
    }
    const desde = `${form.fecha}T${form.horaDesde}:00`
    const hasta  = `${form.fecha}T${form.horaHasta}:00`
    crear({ variables: {
      placa:         form.placa.trim().toUpperCase(),
      empresa:       form.empresa.trim(),
      motivo:        form.motivo.trim(),
      dependenciaId: form.dependenciaId,
      emailProveedor:form.email.trim(),
      validoDesde:   desde,
      validoHasta:   hasta,
    }})
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header modal */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-2xl flex items-center justify-center">
              <Shield size={18} className="text-blue-600" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-base">Nueva autorización externa</p>
              <p className="text-slate-400 text-xs">El proveedor recibirá un QR por email</p>
            </div>
          </div>
          <button onClick={onCancelar} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Vehículo + Empresa */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
                Placa *
              </label>
              <input type="text" placeholder="ABC-1234"
                value={form.placa}
                onChange={e => set('placa', e.target.value.toUpperCase())}
                className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3.5 py-2.5 text-sm font-mono uppercase outline-none transition-colors bg-slate-50 focus:bg-white" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
                Tipo
              </label>
              <select className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3 py-2.5 text-sm outline-none transition-colors bg-slate-50 focus:bg-white">
                <option>🚚 Proveedor</option>
                <option>🔧 Mantenimiento</option>
                <option>🚨 Emergencia</option>
                <option>👤 Contratista</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
              Empresa / Organización *
            </label>
            <input type="text" placeholder="Distribuidora ABC, Servicio de Limpieza..."
              value={form.empresa}
              onChange={e => set('empresa', e.target.value)}
              className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors bg-slate-50 focus:bg-white" />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
              Motivo / Servicio *
            </label>
            <input type="text" placeholder="Entrega de insumos, reparación de equipos..."
              value={form.motivo}
              onChange={e => set('motivo', e.target.value)}
              className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors bg-slate-50 focus:bg-white" />
          </div>

          {/* Dependencia destino — selector moderno */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
              Dependencia destino
            </label>
            <DependenciaSelector
              value={form.dependenciaId}
              onChange={(id) => set('dependenciaId', id)} />
          </div>

          {/* Fecha y horario */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
              Fecha y horario de acceso *
            </label>
            <input type="date" value={form.fecha} min={hoy}
              onChange={e => set('fecha', e.target.value)}
              className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors bg-slate-50 focus:bg-white mb-3" />

            {/* Presets de horario */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {PRESETS_HORARIO.map(p => (
                <button key={p.label} type="button" onClick={() => aplicarPreset(p)}
                  className={`py-2 px-2 rounded-xl text-[11px] font-semibold border-2 transition-all ${
                    form.presetActivo === p.label
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}>
                  {p.label}
                  <br />
                  <span className="font-mono text-[10px] opacity-70">{p.desde}-{p.hasta}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1">
                <label className="block text-[10px] text-slate-500 mb-1">Desde</label>
                <input type="time" value={form.horaDesde}
                  onChange={e => { set('horaDesde', e.target.value); set('presetActivo', 'custom') }}
                  className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3 py-2 text-sm outline-none bg-slate-50 focus:bg-white" />
              </div>
              <span className="text-slate-400 mt-4">→</span>
              <div className="flex-1">
                <label className="block text-[10px] text-slate-500 mb-1">Hasta</label>
                <input type="time" value={form.horaHasta}
                  onChange={e => { set('horaHasta', e.target.value); set('presetActivo', 'custom') }}
                  className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl px-3 py-2 text-sm outline-none bg-slate-50 focus:bg-white" />
              </div>
            </div>
          </div>

          {/* Email proveedor — opcional */}
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">
              Email del proveedor
              <span className="ml-1 text-slate-400 font-normal normal-case">— opcional (recibe el QR)</span>
            </label>
            <div className="relative">
              <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="email" placeholder="proveedor@empresa.com"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                className="w-full border-2 border-slate-200 focus:border-blue-400 rounded-xl pl-9 pr-3.5 py-2.5 text-sm outline-none transition-colors bg-slate-50 focus:bg-white" />
            </div>
          </div>

          {/* Botón principal */}
          <button type="button" onClick={handleSubmit}
            disabled={loading || !form.placa.trim() || !form.empresa.trim() || !form.motivo.trim()}
            className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm disabled:opacity-40 transition-colors shadow-lg">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
            {loading ? 'Creando autorización...' : 'Crear autorización y enviar QR'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tarjeta de autorización ───────────────────────────────────────────────────
function TarjetaAutorizacion({ auth, onRevocada }: { auth: any; onRevocada: () => void }) {
  const [qrUrl, setQrUrl]   = useState('')
  const [verQr, setVerQr]   = useState(false)
  const [copiado, setCop]   = useState(false)

  const cfg = ESTADO_CFG[auth.estado] ?? ESTADO_CFG.vencida

  const [revocar, { loading: loadRev }] = useMutation(REVOCAR_AUTORIZACION_EXTERNA_MUTATION, {
    onCompleted: onRevocada,
  })

  const abrirQr = useCallback(() => {
    if (!qrUrl) {
      import('qrcode').then(QR =>
        QR.toDataURL(auth.codigoAcceso, { width: 240, margin: 2, errorCorrectionLevel: 'H' })
          .then(setQrUrl)
      )
    }
    setVerQr(true)
  }, [auth.codigoAcceso, qrUrl])

  function copiarUrl() {
    navigator.clipboard.writeText(auth.urlVerificacion).then(() => {
      setCop(true)
      setTimeout(() => setCop(false), 2000)
    })
  }

  return (
    <>
      {/* Modal QR */}
      {verQr && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setVerQr(false)}>
          <div className="bg-white rounded-3xl p-6 text-center shadow-2xl max-w-xs w-full" onClick={e => e.stopPropagation()}>
            <p className="font-bold text-slate-800 mb-1">{auth.empresa}</p>
            <p className="text-slate-500 text-xs mb-4">{auth.placa} · {auth.dependenciaNombre ?? 'Campus'}</p>
            {qrUrl ? (
              <img src={qrUrl} alt="QR autorización" className="mx-auto rounded-xl border-4 border-slate-100"
                style={{ width: 200, height: 200 }} />
            ) : <div className="w-48 h-48 mx-auto bg-slate-100 rounded-xl flex items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>}
            <p className="font-mono text-xs text-slate-500 mt-3 tracking-widest">{auth.codigoAcceso}</p>
            <div className="flex gap-2 mt-4">
              <button onClick={copiarUrl}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors">
                {copiado ? <CheckCircle size={13} className="text-emerald-500" /> : <Copy size={13} />}
                {copiado ? 'Copiado' : 'Copiar enlace'}
              </button>
              <a href={auth.urlVerificacion} target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition-colors">
                <ExternalLink size={13} /> Ver página
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Tarjeta */}
      <div className={`rounded-2xl border-2 p-4 transition-all ${auth.estado === 'vigente' ? 'border-emerald-300' : 'border-slate-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
              auth.estado === 'vigente' ? 'bg-emerald-100' : 'bg-slate-100'
            }`}>
              <Truck size={18} className={auth.estado === 'vigente' ? 'text-emerald-600' : 'text-slate-400'} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-black text-slate-800 text-sm">{auth.empresa}</p>
                <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg border">{auth.placa}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{auth.motivo}</p>
              {auth.dependenciaNombre && (
                <p className="text-[11px] text-blue-600 mt-0.5 flex items-center gap-1">
                  <Building2 size={10} /> {auth.dependenciaNombre}
                </p>
              )}
              <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <Clock size={10} />
                {formatFecha(auth.validoDesde)} → {new Date(auth.validoHasta).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Autorizado por: {auth.autorizadoPorNombre}
                {auth.emailEnviado && <span className="ml-2 text-blue-400">· Email enviado ✓</span>}
              </p>
            </div>
          </div>
          {/* Acciones */}
          <div className="flex flex-col gap-1.5 shrink-0">
            <button onClick={abrirQr}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 transition-colors">
              <QrCode size={12} /> QR
            </button>
            {auth.activo && !auth.usado && (
              <button onClick={() => revocar({ variables: { authId: auth.id } })}
                disabled={loadRev}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors">
                <Trash2 size={12} /> Revocar
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function AutorizacionesExternas() {
  const [mostrarForm, setForm]   = useState(false)
  const [ultimaAuth, setUltima]  = useState<any>(null)
  const [soloActivas, setSolo]   = useState(true)

  const { data, loading, refetch } = useQuery(AUTORIZACIONES_EXTERNAS_QUERY, {
    variables: { soloActivas },
    fetchPolicy: 'network-only',
    pollInterval: 30_000,
  })
  const autorizaciones = data?.autorizacionesExternas ?? []
  const vigentes = autorizaciones.filter((a: any) => a.estado === 'vigente').length

  function handleCreada(auth: any) {
    setUltima(auth)
    setForm(false)
    refetch()
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">Autorizaciones externas</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Pre-autoriza proveedores y contratistas para acceder al campus
          </p>
        </div>
        <button onClick={() => setForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-bold text-sm transition-colors shadow-lg shrink-0">
          <Plus size={16} /> Nueva
        </button>
      </div>

      {/* Banner de éxito tras crear */}
      {ultimaAuth && (
        <div className="mb-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 flex items-start gap-3">
          <CheckCircle size={20} className="text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-emerald-800">Autorización creada — {ultimaAuth.empresa}</p>
            <p className="text-emerald-700 text-xs mt-0.5 font-mono">{ultimaAuth.codigoAcceso}</p>
            {ultimaAuth.emailEnviado
              ? <p className="text-emerald-600 text-xs mt-0.5">📧 QR enviado por email al proveedor</p>
              : <p className="text-amber-600 text-xs mt-0.5">⚠ Sin email — comparte el código manualmente</p>}
          </div>
          <button onClick={() => setUltima(null)}>
            <X size={16} className="text-emerald-400 hover:text-emerald-700" />
          </button>
        </div>
      )}

      {/* Stats + filtro */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {vigentes > 0 && (
            <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full">
              {vigentes} vigente{vigentes !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-slate-400">{autorizaciones.length} total</span>
        </div>
        <button onClick={() => setSolo(v => !v)}
          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-all ${
            soloActivas ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
          }`}>
          <Calendar size={12} />
          {soloActivas ? 'Solo activas' : 'Todas'}
        </button>
      </div>

      {/* Lista */}
      {loading && !autorizaciones.length ? (
        <div className="text-center py-16 text-slate-400">
          <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
        </div>
      ) : autorizaciones.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
          <Shield size={32} className="mx-auto mb-3 opacity-30" />
          <p className="font-semibold">Sin autorizaciones {soloActivas ? 'activas' : ''}</p>
          <p className="text-sm mt-1">Crea una nueva para que un proveedor pueda acceder al campus</p>
          <button onClick={() => setForm(true)}
            className="mt-4 flex items-center gap-2 mx-auto px-4 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm">
            <Plus size={15} /> Crear primera autorización
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {autorizaciones.map((auth: any) => (
            <TarjetaAutorizacion key={auth.id} auth={auth}
              onRevocada={() => refetch()} />
          ))}
        </div>
      )}

      {/* Modal formulario */}
      {mostrarForm && (
        <FormularioNuevaAutorizacion
          onCreada={handleCreada}
          onCancelar={() => setForm(false)} />
      )}
    </div>
  )
}
