import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useLazyQuery, useMutation } from '@apollo/client'
import {
  QrCode, Shield, Clock, Trash2, Plus, ChevronDown,
  Car, CheckCircle, XCircle, RefreshCw, Share2,
  LogIn, LogOut, ArrowLeftRight, Link, User, Users, Search, Eye, X,
} from 'lucide-react'
import { QrImage } from '../components/QrImage'
import { Dropdown } from '../components/Dropdown'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { MIS_DELEGACIONES_QUERY, BUSCAR_DESTINATARIO_QUERY } from '../graphql/queries/acceso'
import { GENERAR_QR_DELEGACION_MUTATION, REVOCAR_QR_DELEGACION_MUTATION } from '../graphql/mutations/acceso'

type TipoDelegacion = 'entrada' | 'salida' | 'ambos'
type TipoDestinatario = 'externo' | 'registrado'

type DestinatarioSuggestion = {
  id: number
  ci: string
  nombreCompleto: string
  roles: string
}

type Delegacion = {
  id: number
  codigoHash: string
  motivo: string
  fechaGeneracion: string
  fechaExpiracion: string
  usado: boolean
  vigente: boolean
  tipoDelegacion: TipoDelegacion
  tipoDelegacionDisplay: string
  usosMax: number
  usosActual: number
  usosRestantes: number
  urlQr: string
  placaVehiculo: string | null
  tipoDestinatario: TipoDestinatario
  destinatarioNombre: string
  destinatarioCi: string
  destinatarioDisplay: string
}

type Vehiculo = {
  id: number
  placa: string
  marca: string
  modelo: string
  estado: string
  tipo: { nombre: string } | null
}

const TIPO_CONFIG: Record<TipoDelegacion, {
  label: string
  descripcion: string
  icono: React.ReactNode
  badge: string
  btn: string
}> = {
  entrada: {
    label: 'Solo entrada',
    descripcion: 'Papá trae el auto al campus',
    icono: <LogIn size={15} />,
    badge: 'bg-blue-100 text-blue-700',
    btn: 'border-blue-500 bg-blue-600 text-white',
  },
  salida: {
    label: 'Solo salida',
    descripcion: 'Esposa recoge el auto y se va',
    icono: <LogOut size={15} />,
    badge: 'bg-orange-100 text-orange-700',
    btn: 'border-orange-500 bg-orange-600 text-white',
  },
  ambos: {
    label: 'Entrada y salida',
    descripcion: 'Va, lo estaciona y luego lo saca',
    icono: <ArrowLeftRight size={15} />,
    badge: 'bg-emerald-100 text-emerald-700',
    btn: 'border-emerald-500 bg-emerald-600 text-white',
  },
}

const HORAS_PRESET = [
  { horas: 1,  label: '1 h' },
  { horas: 4,  label: '4 h' },
  { horas: 8,  label: '8 h' },
  { horas: 24, label: '1 día' },
]

function tiempoRestante(fechaStr: string): string {
  const ms = new Date(fechaStr).getTime() - Date.now()
  if (ms <= 0) return 'Expirado'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m restantes`
  return `${m} min restantes`
}

export default function MiPaseQR() {
  const { usuario } = useAuth()
  const toast = useToast()

  const [vehiculoSelId, setVehiculoSelId] = useState<number | null>(null)
  const [mostrarForm, setMostrarForm]     = useState(false)
  const [motivo, setMotivo]               = useState('')
  const [tipoDel, setTipoDel]             = useState<TipoDelegacion>('ambos')
  const [duracion, setDuracion]           = useState(4)
  const [horasCustom, setHorasCustom]     = useState(4)
  const [usarCustom, setUsarCustom]       = useState(false)
  const [delegacionGenerada, setDelegacionGenerada] = useState<Delegacion | null>(null)

  // Destinatario
  const [tipoDest, setTipoDest]           = useState<TipoDestinatario>('externo')
  const [destNombre, setDestNombre]       = useState('')
  const [destCi, setDestCi]               = useState('')
  const [busquedaQuery, setBusquedaQuery] = useState('')
  const [sugerencias, setSugerencias]     = useState<DestinatarioSuggestion[]>([])
  const [mostrarSug, setMostrarSug]       = useState(false)
  const busquedaRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const horasVigencia = usarCustom ? Math.max(1, Math.min(168, horasCustom)) : duracion

  const [buscarDestinatario, { loading: lBuscar }] = useLazyQuery(BUSCAR_DESTINATARIO_QUERY, {
    onCompleted(d) {
      setSugerencias(d?.buscarDestinatarioUagrm ?? [])
      setMostrarSug(true)
    },
  })

  // Debounce de 300ms para la búsqueda de destinatario UAGRM
  useEffect(() => {
    if (tipoDest !== 'registrado') return
    if (busquedaQuery.length < 2) { setSugerencias([]); setMostrarSug(false); return }
    if (busquedaRef.current) clearTimeout(busquedaRef.current)
    busquedaRef.current = setTimeout(() => {
      buscarDestinatario({ variables: { query: busquedaQuery } })
    }, 300)
    return () => { if (busquedaRef.current) clearTimeout(busquedaRef.current) }
  }, [busquedaQuery, tipoDest, buscarDestinatario])

  const resetForm = () => {
    setMotivo(''); setTipoDel('ambos'); setTipoDest('externo')
    setDestNombre(''); setDestCi(''); setBusquedaQuery(''); setSugerencias([])
  }

  const { data: vehiculosData, loading: loadVeh } = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: usuario.id, porPagina: 50 },
    onCompleted(d) {
      const items = d?.vehiculos?.items ?? []
      if (items.length > 0 && !vehiculoSelId) setVehiculoSelId(items[0].id)
    },
  })

  const { data: delegData, refetch: refetchDeleg } = useQuery(MIS_DELEGACIONES_QUERY, {
    fetchPolicy: 'cache-and-network',
  })

  const [generarQR, { loading: lGenerar }] = useMutation(GENERAR_QR_DELEGACION_MUTATION, {
    onCompleted(d) {
      setDelegacionGenerada(d.generarQrDelegacion)
      setMostrarForm(false)
      resetForm()
      refetchDeleg()
      toast.exito('QR delegado generado', `${TIPO_CONFIG[tipoDel].label} · ${horasVigencia}h vigencia`)
    },
    onError(e) { toast.error('Error al generar QR', e.message) },
  })

  const [revocarQR, { loading: lRevocar }] = useMutation(REVOCAR_QR_DELEGACION_MUTATION, {
    onCompleted() {
      setDelegacionGenerada(null)
      refetchDeleg()
      toast.alerta('QR revocado', 'El acceso temporal fue cancelado')
    },
    onError(e) { toast.error('Error al revocar', e.message) },
  })

  const vehiculos: Vehiculo[]   = vehiculosData?.vehiculos?.items ?? []
  const delegaciones: Delegacion[] = delegData?.misDelegaciones ?? []
  const vehSel = vehiculos.find(v => v.id === vehiculoSelId) ?? vehiculos[0] ?? null

  const handleGenerar = useCallback(() => {
    if (!motivo.trim()) { toast.error('Campo requerido', 'Escribe el motivo de la delegación'); return }
    if (!vehSel) return
    if (tipoDest === 'externo' && !destNombre.trim()) {
      toast.error('Nombre requerido', 'Indica el nombre del destinatario'); return
    }
    if (tipoDest === 'registrado' && !destCi.trim()) {
      toast.error('CI requerido', 'Ingresa el CI del miembro UAGRM'); return
    }
    generarQR({
      variables: {
        input: {
          vehiculoId: vehSel.id,
          motivo: motivo.trim(),
          horasValidez: horasVigencia,
          tipoDelegacion: tipoDel,
          tipoDestinatario: tipoDest,
          destinatarioNombre: destNombre.trim(),
          destinatarioCi: destCi.trim(),
        },
      },
    })
  }, [motivo, vehSel, horasVigencia, tipoDel, tipoDest, destNombre, destCi, generarQR, toast])

  const handleCompartir = useCallback(async (d: Delegacion) => {
    const url = d.urlQr
    const paraQuien = d.destinatarioNombre ? ` Pase a nombre de: ${d.destinatarioNombre}.` : ''
    if (navigator.share) {
      await navigator.share({
        title: `QR delegación ${d.placaVehiculo ?? ''} — ${d.tipoDelegacionDisplay}`,
        text: `Escanea este QR para ${d.tipoDelegacionDisplay.toLowerCase()} el vehículo al campus UAGRM.${paraQuien} Válido hasta: ${new Date(d.fechaExpiracion).toLocaleString('es-BO')}`,
        url,
      }).catch(() => {})
    } else {
      await navigator.clipboard.writeText(url)
      toast.info('URL copiada', 'Pega el enlace en WhatsApp — la imagen QR se mostrará automáticamente')
    }
  }, [toast])

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto">
      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />

      {/* Encabezado */}
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-emerald-600 text-white p-2 rounded-xl">
          <QrCode size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Mi Pase Digital</h1>
          <p className="text-slate-500 text-xs">Delegaciones de acceso temporal para tu vehículo</p>
        </div>
      </div>

      {/* Sin vehículos */}
      {!loadVeh && vehiculos.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🚗</div>
          <p className="font-bold text-slate-700">No tienes vehículos registrados</p>
          <p className="text-slate-500 text-sm mt-1">Registra un vehículo para delegar acceso</p>
        </div>
      )}

      {vehSel && (
        <>
          {/* Selector de vehículo */}
          {vehiculos.length > 1 && (
            <div className="mb-4">
              <Dropdown
                searchable
                value={vehiculoSelId != null ? String(vehiculoSelId) : ''}
                onChange={v => { setVehiculoSelId(parseInt(v)); setDelegacionGenerada(null) }}
                options={vehiculos.map(v => ({
                  value: String(v.id),
                  label: `${v.placa} · ${v.tipo?.nombre} — ${v.marca} ${v.modelo}`,
                }))}
              />
            </div>
          )}

          {/* Info del vehículo seleccionado */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-5 flex items-center gap-3">
            <div className="bg-slate-200 rounded-xl p-2.5">
              <Car size={20} className="text-slate-600" />
            </div>
            <div className="flex-1">
              <p className="font-mono font-black text-lg tracking-widest text-slate-800">{vehSel.placa}</p>
              <p className="text-slate-500 text-xs">{vehSel.tipo?.nombre} · {vehSel.marca} {vehSel.modelo}</p>
            </div>
            <span className={`text-xs font-bold px-2 py-1 rounded-full ${
              vehSel.estado === 'activo' ? 'bg-emerald-100 text-emerald-700' :
              vehSel.estado === 'sancionado' ? 'bg-red-100 text-red-700' :
              'bg-slate-200 text-slate-500'
            }`}>
              {vehSel.estado === 'activo' ? '✓ Activo' :
               vehSel.estado === 'sancionado' ? '⚠ Sancionado' : vehSel.estado}
            </span>
          </div>

          {/* Sección de delegaciones */}
          <div className="space-y-3 mb-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield size={16} className="text-blue-600" />
                <h2 className="font-bold text-slate-800 text-sm">Delegación de Acceso</h2>
              </div>
              {!mostrarForm && vehSel.estado === 'activo' && (
                <button
                  onClick={() => setMostrarForm(true)}
                  className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors"
                >
                  <Plus size={13} /> Delegar acceso
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Genera un QR temporal para que otra persona ingrese o saque tu vehículo del campus.
            </p>

            {/* Formulario de delegación */}
            {mostrarForm && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-4">

                {/* Tipo de delegación */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">Tipo de acceso</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(TIPO_CONFIG) as TipoDelegacion[]).map(tipo => {
                      const cfg = TIPO_CONFIG[tipo]
                      const activo = tipoDel === tipo
                      return (
                        <button
                          key={tipo}
                          onClick={() => setTipoDel(tipo)}
                          className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                            activo ? cfg.btn + ' shadow-md' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          {cfg.icono}
                          <span className="leading-tight text-center">{cfg.label}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">{TIPO_CONFIG[tipoDel].descripcion}</p>
                </div>

                {/* Destinatario: para quién es el pase */}
                <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    ¿Para quién es este pase? *
                  </label>
                  <p className="text-[10px] text-slate-500 -mt-1">
                    El guardia verá este nombre y CI para confirmar la identidad de quien usa el QR.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setTipoDest('externo'); setBusquedaQuery(''); setSugerencias([]); setDestNombre(''); setDestCi('') }}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                        tipoDest === 'externo'
                          ? 'border-slate-500 bg-slate-700 text-white shadow-md'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <User size={13} /> Persona externa
                    </button>
                    <button
                      onClick={() => { setTipoDest('registrado'); setDestNombre(''); setDestCi('') }}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                        tipoDest === 'registrado'
                          ? 'border-indigo-500 bg-indigo-600 text-white shadow-md'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <Users size={13} /> Miembro UAGRM
                    </button>
                  </div>

                  {tipoDest === 'externo' ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-slate-400">Para familiares o personas sin cuenta en el sistema (ej. tu papá).</p>
                      <input
                        value={destNombre}
                        onChange={e => setDestNombre(e.target.value)}
                        placeholder="Nombre completo (ej: Roberto García)"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        maxLength={150}
                      />
                      <input
                        value={destCi}
                        onChange={e => setDestCi(e.target.value)}
                        placeholder="CI / Carnet de identidad (recomendado)"
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        maxLength={20}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2 relative">
                      <p className="text-[10px] text-slate-400">Busca por CI o nombre entre los miembros registrados (estudiantes, docentes, administrativos).</p>
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                        <input
                          value={busquedaQuery}
                          onChange={e => { setBusquedaQuery(e.target.value); setDestCi(''); setDestNombre('') }}
                          onFocus={() => sugerencias.length > 0 && setMostrarSug(true)}
                          placeholder="Escribe CI o nombre..."
                          className="w-full border border-slate-300 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                          maxLength={100}
                        />
                        {lBuscar && <RefreshCw size={13} className="absolute right-3 top-3 text-slate-400 animate-spin" />}
                      </div>

                      {/* Dropdown de sugerencias */}
                      {mostrarSug && sugerencias.length > 0 && (
                        <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                          {sugerencias.map(s => (
                            <button
                              key={s.id}
                              onClick={() => {
                                setDestNombre(s.nombreCompleto)
                                setDestCi(s.ci)
                                setBusquedaQuery(s.nombreCompleto)
                                setMostrarSug(false)
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors border-b border-slate-100 last:border-0"
                            >
                              <p className="text-xs font-semibold text-slate-800">{s.nombreCompleto}</p>
                              <p className="text-[10px] text-slate-500">CI: {s.ci} · {s.roles}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      {mostrarSug && busquedaQuery.length >= 2 && sugerencias.length === 0 && !lBuscar && (
                        <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-xl shadow-lg p-3">
                          <p className="text-xs text-slate-500">No se encontraron miembros UAGRM con ese CI o nombre.</p>
                        </div>
                      )}

                      {/* Confirmación de selección */}
                      {destCi && destNombre && (
                        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2 flex items-center gap-2">
                          <CheckCircle size={14} className="text-indigo-600 shrink-0" />
                          <p className="text-xs text-indigo-700">
                            <strong>{destNombre}</strong> · CI: {destCi}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Quién usará el acceso (motivo descriptivo) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Motivo de la delegación *</label>
                  <input
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    placeholder="Ej: Préstamo de vehículo a familiar, recoge el auto del taller..."
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    maxLength={120}
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">{motivo.length}/120</p>
                </div>

                {/* Duración */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700">Duración de vigencia</label>
                    <button
                      onClick={() => setUsarCustom(p => !p)}
                      className="text-[10px] text-blue-600 font-semibold underline"
                    >
                      {usarCustom ? 'Usar presets' : 'Personalizar'}
                    </button>
                  </div>
                  {!usarCustom ? (
                    <div className="grid grid-cols-4 gap-2">
                      {HORAS_PRESET.map(p => (
                        <button
                          key={p.horas}
                          onClick={() => setDuracion(p.horas)}
                          className={`py-2 rounded-xl text-xs font-bold border-2 transition-all ${
                            duracion === p.horas
                              ? 'border-blue-500 bg-blue-600 text-white shadow-md'
                              : 'border-transparent bg-slate-100 text-slate-700 hover:border-blue-300'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={168}
                        value={horasCustom}
                        onChange={e => setHorasCustom(parseInt(e.target.value) || 1)}
                        className="w-20 border border-slate-300 rounded-xl px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <span className="text-sm text-slate-600">horas (máx. 168 = 1 semana)</span>
                    </div>
                  )}
                </div>

                {tipoDel === 'ambos' && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex gap-2">
                    <ArrowLeftRight size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-700">
                      <strong>Entrada y salida</strong>: el QR permite 2 usos — uno para entrar y otro para salir. El mismo código sirve para ambas.
                    </p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => { setMostrarForm(false); resetForm() }}
                    className="flex-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl text-sm font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleGenerar}
                    disabled={lGenerar || !motivo.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold disabled:opacity-40 transition-colors"
                  >
                    {lGenerar ? <RefreshCw size={13} className="animate-spin" /> : <QrCode size={13} />}
                    Generar QR
                  </button>
                </div>
              </div>
            )}

            {/* QR seleccionado / recién generado — se puede volver a abrir desde la lista con "Ver QR" */}
            {delegacionGenerada && (
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 text-center relative">
                <button
                  onClick={() => setDelegacionGenerada(null)}
                  className="absolute top-3 right-3 text-emerald-500 hover:text-emerald-700 transition-colors"
                  title="Ocultar QR"
                  aria-label="Ocultar QR"
                >
                  <X size={16} />
                </button>
                <div className="flex items-center gap-2 mb-1 justify-center">
                  <CheckCircle size={16} className="text-emerald-600" />
                  <p className="font-bold text-emerald-800 text-sm">QR de delegación listo</p>
                </div>

                {/* Badge tipo */}
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full mb-2 ${TIPO_CONFIG[delegacionGenerada.tipoDelegacion]?.badge ?? ''}`}>
                  {TIPO_CONFIG[delegacionGenerada.tipoDelegacion]?.icono}
                  {delegacionGenerada.tipoDelegacionDisplay}
                </span>

                {/* Destinatario autorizado */}
                <div className="bg-white border border-emerald-200 rounded-xl px-3 py-2 mb-3 flex items-center gap-2 justify-center">
                  {delegacionGenerada.tipoDestinatario === 'registrado'
                    ? <Users size={13} className="text-indigo-600 shrink-0" />
                    : <User size={13} className="text-slate-500 shrink-0" />}
                  <p className="text-xs text-slate-700">
                    Para: <strong>{delegacionGenerada.destinatarioDisplay}</strong>
                  </p>
                </div>

                <QrImage value={delegacionGenerada.codigoHash} size={160} label={delegacionGenerada.motivo} />

                {/* Puntos de uso para "ambos" */}
                {delegacionGenerada.usosMax > 1 && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    {Array.from({ length: delegacionGenerada.usosMax }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-2.5 h-2.5 rounded-full ${i < delegacionGenerada.usosActual ? 'bg-slate-300' : 'bg-emerald-500'}`}
                        title={i < delegacionGenerada.usosActual ? 'Usado' : 'Disponible'}
                      />
                    ))}
                    <span className="text-[10px] text-slate-500 ml-1">
                      {delegacionGenerada.usosRestantes} uso{delegacionGenerada.usosRestantes !== 1 ? 's' : ''} restante{delegacionGenerada.usosRestantes !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}

                <p className="text-xs text-emerald-600 mt-2 font-semibold">
                  <Clock size={11} className="inline mr-1" />
                  {tiempoRestante(delegacionGenerada.fechaExpiracion)}
                </p>

                {/* URL del QR para compartir */}
                <div className="mt-2 bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2">
                  <Link size={11} className="text-slate-400 shrink-0" />
                  <p className="text-[10px] text-slate-500 truncate flex-1">{delegacionGenerada.urlQr}</p>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleCompartir(delegacionGenerada)}
                    className="flex-1 flex items-center justify-center gap-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold"
                  >
                    <Share2 size={12} /> Compartir enlace QR
                  </button>
                  <button
                    onClick={() => revocarQR({ variables: { qrId: delegacionGenerada.id } })}
                    disabled={lRevocar}
                    className="flex items-center justify-center gap-1 py-2 px-3 border border-red-300 text-red-600 rounded-xl text-xs font-semibold hover:bg-red-50"
                  >
                    <Trash2 size={12} /> Revocar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Lista de delegaciones activas */}
          {delegaciones.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-slate-500" />
                <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                  Delegaciones activas ({delegaciones.length})
                </p>
              </div>
              <div className="space-y-2">
                {delegaciones.filter(d => d.id !== delegacionGenerada?.id).map(d => (
                  <div key={d.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-3 shadow-sm">
                    <div className="shrink-0">
                      <QrImage value={d.codigoHash} size={52} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{d.motivo}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Car size={10} className="text-slate-400" />
                        <p className="text-[11px] text-slate-500">{d.placaVehiculo}</p>
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${TIPO_CONFIG[d.tipoDelegacion]?.badge ?? ''}`}>
                          {TIPO_CONFIG[d.tipoDelegacion]?.icono}
                          {d.tipoDelegacionDisplay}
                        </span>
                      </div>
                      {d.destinatarioNombre && (
                        <div className="flex items-center gap-1 mt-1">
                          {d.tipoDestinatario === 'registrado'
                            ? <Users size={10} className="text-indigo-500 shrink-0" />
                            : <User size={10} className="text-slate-400 shrink-0" />}
                          <p className="text-[10px] text-slate-600 truncate">
                            Para: <strong>{d.destinatarioNombre}</strong>{d.destinatarioCi && ` · CI: ${d.destinatarioCi}`}
                          </p>
                        </div>
                      )}
                      {/* Dots de uso */}
                      {d.usosMax > 1 && (
                        <div className="flex items-center gap-1 mt-1">
                          {Array.from({ length: d.usosMax }).map((_, i) => (
                            <div
                              key={i}
                              className={`w-2 h-2 rounded-full ${i < d.usosActual ? 'bg-slate-300' : 'bg-blue-500'}`}
                            />
                          ))}
                          <span className="text-[9px] text-slate-400 ml-0.5">{d.usosRestantes} restante{d.usosRestantes !== 1 ? 's' : ''}</span>
                        </div>
                      )}
                      <p className="text-[10px] text-blue-600 font-semibold mt-0.5">
                        <Clock size={9} className="inline mr-0.5" />
                        {tiempoRestante(d.fechaExpiracion)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">
                        VIGENTE
                      </span>
                      <button
                        onClick={() => setDelegacionGenerada(d)}
                        className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition-colors px-2 py-1 rounded-lg hover:bg-blue-50"
                        title="Ver y compartir este QR"
                      >
                        <Eye size={12} /> Ver QR
                      </button>
                      <button
                        onClick={() => revocarQR({ variables: { qrId: d.id } })}
                        disabled={lRevocar}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Revocar acceso"
                      >
                        <XCircle size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
