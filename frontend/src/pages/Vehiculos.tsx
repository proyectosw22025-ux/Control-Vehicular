import { useState, FormEvent, useCallback, useRef, useEffect, DragEvent, useMemo } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Car, Plus, RefreshCw, FileText, Edit, QrCode, X,
  AlertTriangle, Zap, Search, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Clock, History, SlidersHorizontal,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { QrDinamico } from '../components/QrDinamico'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from '../components/ToastContainer'
import { PromptModal } from '../components/PromptModal'
import { VEHICULOS_QUERY, VEHICULOS_PENDIENTES_QUERY, TIPOS_VEHICULO_QUERY } from '../graphql/queries/vehiculos'
import { SESIONES_ACTIVAS_QUERY } from '../graphql/queries/parqueos'
import {
  REGISTRAR_VEHICULO_MUTATION,
  ACTUALIZAR_VEHICULO_MUTATION,
  REGENERAR_QR_MUTATION,
  AGREGAR_DOCUMENTO_MUTATION,
  APROBAR_VEHICULO_MUTATION,
  RECHAZAR_VEHICULO_MUTATION,
  MARCAR_ALERTA_SEGURIDAD_MUTATION,
  MARCAR_FRECUENTE_MUTATION,
} from '../graphql/mutations/vehiculos'
import { USUARIOS_QUERY } from '../graphql/queries/usuarios'

const ESTADO_BADGE: Record<string, string> = {
  pendiente:  'bg-amber-100 text-amber-700',
  activo:     'bg-green-100 text-green-700',
  inactivo:   'bg-slate-100 text-slate-600',
  sancionado: 'bg-red-100 text-red-700',
}

// ── Semáforo modal — calcula estado en cliente con la fecha de vencimiento ─
function semDocModal(fechaStr: string): { cls: string; icono: string; label: string } {
  const hoy  = new Date(); hoy.setHours(0, 0, 0, 0)
  const fecha = new Date(fechaStr)
  const dias  = Math.floor((fecha.getTime() - hoy.getTime()) / 86400000)
  if (dias < 0)   return { cls: 'bg-red-50 border-red-300 text-red-700',     icono: '🚨', label: `Vencido · hace ${Math.abs(dias)}d` }
  if (dias <= 30) return { cls: 'bg-amber-50 border-amber-300 text-amber-700', icono: '⚠',  label: `Vence en ${dias}d` }
  return               { cls: 'bg-emerald-50 border-emerald-300 text-emerald-700', icono: '✅', label: `Vigente · ${dias}d` }
}

// ── Validación de fecha de vencimiento al agregar documento ───────────────
function validarFechaDoc(fechaStr: string): { tipo: 'warn' | 'error'; msg: string } | null {
  if (!fechaStr) return null
  const hoy  = new Date(); hoy.setHours(0, 0, 0, 0)
  const venc = new Date(fechaStr)
  const dias = Math.floor((venc.getTime() - hoy.getTime()) / 86400000)
  if (dias < -365 * 5) return { tipo: 'error', msg: '¿Verificaste el año? La fecha parece incorrecta.' }
  if (dias < 0)        return { tipo: 'warn',  msg: `Este documento venció hace ${Math.abs(dias)} día(s). Se guardará como "vencido".` }
  if (dias === 0)      return { tipo: 'warn',  msg: 'El documento vence hoy.' }
  if (dias > 365 * 10) return { tipo: 'error', msg: '¿Verificaste el año? La fecha es demasiado lejana.' }
  if (dias <= 30)      return { tipo: 'warn',  msg: `Atención: vence en ${dias} día(s) — próximamente.` }
  return null
}

// Semáforo de documentación
const DOC_BADGE: Record<string, { cls: string; label: string; icon: string }> = {
  critico:        { cls: 'bg-red-100 text-red-700 border-red-300',     label: 'Docs vencidos', icon: '🚨' },
  advertencia:    { cls: 'bg-amber-100 text-amber-700 border-amber-300', label: 'Docs por vencer', icon: '⚠' },
  al_dia:         { cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', label: 'Docs al día', icon: '✓' },
  sin_documentos: { cls: 'bg-slate-100 text-slate-500 border-slate-200', label: 'Sin documentos', icon: '📄' },
}

const TIPO_DOC_LABELS: Record<string, string> = {
  soat:        'SOAT',
  tecnica:     'Técnica',
  circulacion: 'Circulación',
  otro:        'Otro',
}

// Texto contextual del campo de foto según el tipo de documento
const TEXTO_FOTO: Record<string, string> = {
  soat:        'Foto o PDF de tu SOAT',
  tecnica:     'Certificado de Revisión Técnica',
  circulacion: 'Permiso de Circulación',
  otro:        'Foto o PDF del documento',
}

type Documento = {
  id: number; tipoDoc: string; numero: string; fechaVencimiento: string
  estado: string        // valido | por_vencer | vencido
  diasParaVencer: number
}
type Vehiculo = {
  id: number; placa: string; marca: string; modelo: string; anio: number;
  color: string; estado: string; codigoQr: string; createdAt: string;
  enAlerta?: boolean; motivoAlerta?: string; esFrecuente?: boolean;
  estadoDocumentacion: string   // al_dia | advertencia | critico | sin_documentos
  tipo: { id: number; nombre: string }; propietarioNombre: string;
  documentos: Documento[]
}

type Tab   = 'lista' | 'pendientes'
type Modal = 'registrar' | 'editar' | 'documento' | 'qr' | 'rechazar' | null

const POR_PAGINA = 15

export default function Vehiculos() {
  const { usuario, esAdmin } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const toast = useToast()

  const [tab, setTab]                       = useState<Tab>('lista')
  const [modal, setModal]                   = useState<Modal>(null)
  const [seleccionado, setSeleccionado]     = useState<Vehiculo | null>(null)
  const [confirmarRegen, setConfirmarRegen] = useState(false)
  const [error, setError]                   = useState('')
  const [filtroEstado, setFiltroEstado]     = useState('')
  const [busqueda, setBusqueda]             = useState('')
  const [busquedaInput, setBusquedaInput]   = useState('')
  const [pagina, setPagina]                 = useState(1)
  // Filtros avanzados — se leen/persisten en la URL para que sean compartibles
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const [filtroTipo,       setFiltroTipo]      = useState(() => searchParams.get('tipoId') || '')
  const [filtroFechaDesde, setFiltroFechaDesde]= useState(() => searchParams.get('fechaDesde') || '')
  const [filtroFechaHasta, setFiltroFechaHasta]= useState(() => searchParams.get('fechaHasta') || '')
  const [filtroInfracciones, setFiltroInfracciones] = useState<'si' | 'no' | ''>(() => (searchParams.get('infracciones') as 'si' | 'no' | '') || '')
  const [filtroDocsVenc,   setFiltroDocsVenc]  = useState<'si' | 'no' | ''>(() => (searchParams.get('docsVenc') as 'si' | 'no' | '') || '')
  const [filtroColor,      setFiltroColor]     = useState(() => searchParams.get('color') || '')
  const [filtroOrden,      setFiltroOrden]     = useState(() => searchParams.get('orden') || '')

  const filtrosActivos = useMemo(() =>
    [filtroTipo, filtroFechaDesde, filtroFechaHasta, filtroInfracciones, filtroDocsVenc, filtroColor, filtroOrden]
      .filter(Boolean).length,
  [filtroTipo, filtroFechaDesde, filtroFechaHasta, filtroInfracciones, filtroDocsVenc, filtroColor, filtroOrden])

  function aplicarFiltros() {
    const params: Record<string, string> = {}
    if (filtroTipo)       params.tipoId    = filtroTipo
    if (filtroFechaDesde) params.fechaDesde= filtroFechaDesde
    if (filtroFechaHasta) params.fechaHasta= filtroFechaHasta
    if (filtroInfracciones) params.infracciones = filtroInfracciones
    if (filtroDocsVenc)   params.docsVenc  = filtroDocsVenc
    if (filtroColor)      params.color     = filtroColor
    if (filtroOrden)      params.orden     = filtroOrden
    if (busqueda)         params.q         = busqueda
    if (filtroEstado)     params.estado    = filtroEstado
    setSearchParams(params)
    setPagina(1)
  }

  function limpiarFiltros() {
    setFiltroTipo(''); setFiltroFechaDesde(''); setFiltroFechaHasta('')
    setFiltroInfracciones(''); setFiltroDocsVenc(''); setFiltroColor(''); setFiltroOrden('')
    setSearchParams({})
    setPagina(1)
  }

  const [motivoRechazo, setMotivoRechazo]   = useState('')
  const [fechaDoc, setFechaDoc]             = useState('')
  const [tipoDocSel, setTipoDocSel]         = useState('soat')
  const [archivoDoc, setArchivoDoc]         = useState<File | null>(null)
  const [subiendoArchivo, setSubiendoArchivo] = useState(false)
  const archivoInputRef                     = useRef<HTMLInputElement>(null)
  // Foto de vehículo pendiente de subir tras crear el vehículo (wizard B2)
  const fotoVehiculoRef = useRef<File | null>(null)

  // Debounce 300ms — useRef evita acumulación de timeouts (memory leak)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleBusqueda = useCallback((val: string) => {
    setBusquedaInput(val)
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => { setBusqueda(val); setPagina(1) }, 300)
  }, [])
  // Limpia el timer si el componente se desmonta antes de que dispare
  useEffect(() => () => { if (debounceTimer.current) clearTimeout(debounceTimer.current) }, [])

  const propietarioId = esAdmin ? undefined : usuario.id

  const { data, loading, refetch } = useQuery(VEHICULOS_QUERY, {
    variables: {
      propietarioId,
      buscar:    busqueda     || undefined,
      estado:    filtroEstado || undefined,
      pagina,
      porPagina: POR_PAGINA,
      // Filtros avanzados C1
      tipoId:                  filtroTipo       ? parseInt(filtroTipo) : undefined,
      fechaDesde:              filtroFechaDesde || undefined,
      fechaHasta:              filtroFechaHasta || undefined,
      tieneInfraccionesActivas: filtroInfracciones === 'si' ? true : filtroInfracciones === 'no' ? false : undefined,
      tieneDocumentosVencidos: filtroDocsVenc   === 'si' ? true : filtroDocsVenc === 'no' ? false : undefined,
      ordenarPor:              filtroOrden      || undefined,
      color:                   filtroColor      || undefined,
    },
    fetchPolicy: 'cache-and-network',
  })
  const { data: pendientesData, refetch: refetchPendientes } = useQuery(VEHICULOS_PENDIENTES_QUERY, {
    skip: !esAdmin,
    fetchPolicy: 'cache-and-network',
  })
  const { data: tiposData }    = useQuery(TIPOS_VEHICULO_QUERY)
  const { data: usuariosData } = useQuery(USUARIOS_QUERY, { skip: !esAdmin })
  // Mapa placa → "Zona · #Espacio" para indicar si el vehículo está en parqueo ahora
  const { data: sesionesData } = useQuery(SESIONES_ACTIVAS_QUERY, {
    fetchPolicy: 'cache-and-network',
    pollInterval: 30_000,
  })
  const enParqueo = new Map<string, string>(
    (sesionesData?.sesionesActivas ?? []).map((s: any) => [
      s.placaVehiculo,
      `${s.espacio?.zona?.nombre ?? 'Zona'} · #${s.espacio?.numero ?? '?'}`,
    ])
  )

  const [registrarVehiculo, { loading: loadingRegistrar }] = useMutation(REGISTRAR_VEHICULO_MUTATION, {
    async onCompleted(d) {
      const { id: vehiculoId, placa } = d.registrarVehiculo
      // Subir foto del vehículo si el wizard capturó una
      const fotoFile = fotoVehiculoRef.current
      fotoVehiculoRef.current = null
      if (fotoFile) {
        try {
          const form = new FormData()
          form.append('foto', fotoFile)
          const token = localStorage.getItem('access_token') ?? ''
          const base  = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
          await fetch(`${base}/api/vehiculos/${vehiculoId}/foto/?token=${token}`, { method: 'POST', body: form })
        } catch { /* la foto no es crítica */ }
      }
      cerrarModal(); refetch(); refetchPendientes()
      esAdmin
        ? toast.exito('Vehículo registrado', `${placa} está activo en el sistema`)
        : toast.info('Vehículo enviado a revisión', `${placa} será aprobado por un administrador`)
    },
    onError(e) { setError(e.message); toast.error('Error al registrar', e.message) },
  })
  const [actualizarVehiculo, { loading: loadingActualizar }] = useMutation(ACTUALIZAR_VEHICULO_MUTATION, {
    onCompleted() { cerrarModal(); refetch(); toast.exito('Vehículo actualizado correctamente') },
    onError(e) { setError(e.message); toast.error('Error al actualizar', e.message) },
  })
  const [aprobarVehiculo, { loading: loadingAprobar }] = useMutation(APROBAR_VEHICULO_MUTATION, {
    onCompleted(d) {
      refetch(); refetchPendientes()
      toast.exito('Vehículo aprobado', `${d.aprobarVehiculo.placa} ya puede acceder al campus`)
    },
    onError(e) { setError(e.message); toast.error('Error al aprobar', e.message) },
  })
  const [rechazarVehiculo, { loading: loadingRechazar }] = useMutation(RECHAZAR_VEHICULO_MUTATION, {
    onCompleted(d) {
      cerrarModal(); refetch(); refetchPendientes()
      toast.alerta('Vehículo rechazado', `Se notificó al propietario de ${d.rechazarVehiculo.placa}`)
    },
    onError(e) { setError(e.message); toast.error('Error al rechazar', e.message) },
  })
  const [marcarAlertaSeguridad] = useMutation(MARCAR_ALERTA_SEGURIDAD_MUTATION, {
    onCompleted(d) {
      const v = d.marcarAlertaSeguridad
      refetch()
      if (v.enAlerta) toast.alerta('Alerta de seguridad activada', `${v.placa}: ${v.motivoAlerta}`)
      else toast.exito('Alerta retirada', `${v.placa} ya no está en alerta`)
    },
    onError(e) { toast.error('No se pudo cambiar la alerta', e.message) },
  })
  // Activa/retira la alerta de seguridad (lista negra). Pide el motivo al activar
  // mediante un modal propio (sin el window.prompt nativo del navegador).
  const [alertaPrompt, setAlertaPrompt] = useState<any | null>(null)
  function toggleAlertaSeguridad(v: any) {
    if (v.enAlerta) {
      marcarAlertaSeguridad({ variables: { vehiculoId: parseInt(v.id), enAlerta: false } })
      return
    }
    setAlertaPrompt(v)
  }
  function confirmarAlertaSeguridad(motivo: string) {
    if (alertaPrompt) {
      marcarAlertaSeguridad({ variables: { vehiculoId: parseInt(alertaPrompt.id), enAlerta: true, motivo } })
    }
    setAlertaPrompt(null)
  }
  const [marcarFrecuente] = useMutation(MARCAR_FRECUENTE_MUTATION, {
    onCompleted(d) {
      const v = d.marcarVehiculoFrecuente
      refetch()
      toast.exito(v.esFrecuente ? 'Carril express activado' : 'Carril express retirado',
        `${v.placa}${v.esFrecuente ? ' ahora es frecuente' : ''}`)
    },
    onError(e) { toast.error('No se pudo cambiar', e.message) },
  })
  const [regenerarQr] = useMutation(REGENERAR_QR_MUTATION, {
    onCompleted(d) {
      setSeleccionado(prev => prev ? { ...prev, codigoQr: d.regenerarQr.codigoQr } : prev)
      refetch(); toast.exito('QR invalidado', 'El nuevo código QR ya está activo')
    },
    onError(e) { setError(e.message); toast.error('Error al regenerar QR', e.message) },
  })
  const [agregarDocumento, { loading: loadingDoc }] = useMutation(AGREGAR_DOCUMENTO_MUTATION, {
    async onCompleted(d) {
      const docId = d.agregarDocumento?.id
      // Si el usuario seleccionó un archivo, subirlo justo después de crear el doc
      if (archivoDoc && docId) {
        setSubiendoArchivo(true)
        try {
          const form = new FormData()
          form.append('archivo', archivoDoc)
          const token = localStorage.getItem('access_token') ?? ''
          const base  = (import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/').replace(/\/graphql\/?$/, '')
          const resp  = await fetch(`${base}/api/documentos/${docId}/subir/`, {
            method: 'POST', body: form,
            headers: { Authorization: `Bearer ${token}` },
          })
          if (resp.ok) {
            toast.exito('Documento agregado', 'Archivo subido correctamente ✓')
          } else {
            toast.info('Documento registrado', 'El archivo no se pudo subir — agrégalo desde el Historial')
          }
        } catch {
          toast.info('Documento registrado', 'Sin conexión para el archivo — agrégalo desde el Historial')
        } finally {
          setSubiendoArchivo(false)
        }
      } else {
        toast.exito('Documento agregado', 'Sin archivo adjunto')
      }
      cerrarModal(); refetch()
    },
    onError(e) { setError(e.message); toast.error('Error al agregar documento', e.message) },
  })

  const page      = data?.vehiculos
  const vehiculos: Vehiculo[] = page?.items ?? []
  const total: number         = page?.total ?? 0
  const totalPaginas: number  = page?.totalPaginas ?? 1
  const tipos    = tiposData?.tiposVehiculo ?? []
  const usuarios = usuariosData?.usuarios ?? []
  const pendientes: Vehiculo[] = pendientesData?.vehiculosPendientes ?? []

  function cerrarModal() {
    setModal(null); setSeleccionado(null); setError('')
    setConfirmarRegen(false); setMotivoRechazo(''); setFechaDoc('')
    setTipoDocSel('soat'); setArchivoDoc(null); setSubiendoArchivo(false)
    if (archivoInputRef.current) archivoInputRef.current.value = ''
  }
  function abrirQr(v: Vehiculo)       { setSeleccionado(v); setModal('qr') }
  function abrirEditar(v: Vehiculo)   { setSeleccionado(v); setModal('editar') }
  function abrirDocumento(v: Vehiculo){ setSeleccionado(v); setModal('documento') }
  function abrirRechazar(v: Vehiculo) { setSeleccionado(v); setModal('rechazar') }

  function cambioBusqueda(val: string) { setBusqueda(val); setPagina(1) }
  function cambioEstado(val: string)   { setFiltroEstado(val); setPagina(1) }

  function handleRegistrar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    const placa = (f.get('placa') as string).trim().toUpperCase()
    if (!/^[A-Z0-9\-]{3,10}$/.test(placa)) {
      setError('La placa debe tener entre 3 y 10 caracteres alfanuméricos'); return
    }
    const propietarioId = esAdmin
      ? parseInt(f.get('propietarioId') as string)
      : usuario.id
    registrarVehiculo({
      variables: {
        input: {
          placa,
          tipoId: parseInt(f.get('tipoId') as string),
          propietarioId,
          marca:  (f.get('marca') as string).trim(),
          modelo: (f.get('modelo') as string).trim(),
          anio:   parseInt(f.get('anio') as string),
          color:  (f.get('color') as string).trim(),
        },
      },
    })
  }

  function handleActualizar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    actualizarVehiculo({
      variables: {
        id: seleccionado!.id,
        input: {
          marca:  (f.get('marca') as string).trim() || null,
          modelo: (f.get('modelo') as string).trim() || null,
          anio:   parseInt(f.get('anio') as string) || null,
          color:  (f.get('color') as string).trim() || null,
          estado: (f.get('estado') as string) || null,
        },
      },
    })
  }

  function handleDocumento(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    const f = new FormData(e.currentTarget)
    agregarDocumento({
      variables: {
        input: {
          vehiculoId:       seleccionado!.id,
          tipoDoc:          f.get('tipoDoc') as string,
          numero:           (f.get('numero') as string).trim(),
          fechaVencimiento: f.get('fechaVencimiento') as string,
        },
      },
    })
  }

  function handleRechazar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    if (!motivoRechazo.trim()) { setError('Debes indicar el motivo del rechazo'); return }
    rechazarVehiculo({ variables: { vehiculoId: seleccionado!.id, motivo: motivoRechazo.trim() } })
  }

  return (
    <div className="p-4 sm:p-8">
      {/* Encabezado */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500 text-white p-2 rounded-xl"><Car size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Vehículos</h1>
            <p className="text-slate-500 text-xs">
              {esAdmin ? 'Gestión completa de vehículos' : 'Mis vehículos registrados'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setModal('registrar')}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Registrar Vehículo
        </button>
      </div>

      {/* Tabs (solo admin) */}
      {esAdmin && (
        <div className="flex gap-1 mb-4 border-b border-slate-200">
          <TabBtn active={tab === 'lista'} onClick={() => setTab('lista')}>
            Lista de vehículos
          </TabBtn>
          <TabBtn active={tab === 'pendientes'} onClick={() => setTab('pendientes')}>
            <span className="flex items-center gap-1.5">
              <Clock size={13} />
              Pendientes de aprobación
              {pendientes.length > 0 && (
                <span className="bg-amber-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full font-bold">
                  {pendientes.length > 9 ? '9+' : pendientes.length}
                </span>
              )}
            </span>
          </TabBtn>
        </div>
      )}

      {/* ── TAB: LISTA ── */}
      {tab === 'lista' && (
        <>
          {/* Barra de búsqueda y filtros */}
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por placa, marca, modelo, propietario..."
                value={busquedaInput}
                onChange={e => handleBusqueda(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />
            </div>
            <select
              value={filtroEstado}
              onChange={e => cambioEstado(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            >
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="sancionado">Sancionado</option>
            </select>
            {(busquedaInput || filtroEstado) && (
              <button
                onClick={() => { handleBusqueda(''); setBusquedaInput(''); setFiltroEstado(''); setPagina(1) }}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Limpiar
              </button>
            )}
            {/* Botón filtros avanzados con badge */}
            {esAdmin && (
              <button
                onClick={() => setFiltrosAbiertos(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors
                  ${filtrosActivos > 0
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 text-slate-600 hover:border-emerald-300 hover:bg-slate-50'}`}
              >
                <SlidersHorizontal size={14} />
                Filtros
                {filtrosActivos > 0 && (
                  <span className="bg-emerald-500 text-white text-[10px] font-bold w-4 h-4 flex items-center justify-center rounded-full">
                    {filtrosActivos}
                  </span>
                )}
                {filtrosAbiertos ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
          </div>

          {/* Panel de filtros avanzados colapsable */}
          {esAdmin && filtrosAbiertos && (
            <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Tipo */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
                  <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    <option value="">Todos los tipos</option>
                    {tipos.map((t: any) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                </div>
                {/* Fecha desde */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Registrado desde</label>
                  <input type="date" value={filtroFechaDesde} onChange={e => setFiltroFechaDesde(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
                {/* Fecha hasta */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Hasta</label>
                  <input type="date" value={filtroFechaHasta} onChange={e => setFiltroFechaHasta(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                </div>
                {/* Color */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Color</label>
                  <input type="text" value={filtroColor} onChange={e => setFiltroColor(e.target.value)}
                    placeholder="ej: rojo, azul..." list="colores-filtro-lista"
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  <datalist id="colores-filtro-lista">
                    {['Blanco','Negro','Gris','Plata','Rojo','Azul','Verde','Amarillo','Naranja','Morado','Café'].map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                {/* Infracciones activas */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 text-xs">Infracciones:</span>
                  {[['', 'Todos'], ['si', 'Con infracciones'], ['no', 'Sin infracciones']].map(([val, label]) => (
                    <label key={val} className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="filtroInfracciones" value={val}
                        checked={filtroInfracciones === val}
                        onChange={() => setFiltroInfracciones(val as 'si' | 'no' | '')}
                        className="accent-emerald-500" />
                      <span className="text-xs text-slate-600">{label}</span>
                    </label>
                  ))}
                </div>
                {/* Docs vencidos */}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500 text-xs">Docs:</span>
                  {[['', 'Todos'], ['si', 'Vencidos'], ['no', 'Al día']].map(([val, label]) => (
                    <label key={val} className="flex items-center gap-1 cursor-pointer">
                      <input type="radio" name="filtroDocsVenc" value={val}
                        checked={filtroDocsVenc === val}
                        onChange={() => setFiltroDocsVenc(val as 'si' | 'no' | '')}
                        className="accent-emerald-500" />
                      <span className="text-xs text-slate-600">{label}</span>
                    </label>
                  ))}
                </div>
                {/* Ordenar */}
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-xs">Orden:</span>
                  <select value={filtroOrden} onChange={e => setFiltroOrden(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    <option value="">Más reciente</option>
                    <option value="placa">Placa A→Z</option>
                    <option value="-placa">Placa Z→A</option>
                    <option value="fecha">Más antiguo</option>
                    <option value="propietario">Propietario</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                <button onClick={limpiarFiltros}
                  className="text-xs text-slate-500 hover:text-slate-700 underline">
                  Limpiar filtros
                </button>
                <button onClick={aplicarFiltros}
                  className="ml-auto flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-4 py-1.5 rounded-lg transition-colors font-medium">
                  Aplicar{filtrosActivos > 0 ? ` (${filtrosActivos})` : ''}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-white rounded-xl h-14 animate-pulse" />
              ))}
            </div>
          ) : vehiculos.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Car size={40} className="mx-auto mb-2 opacity-30" />
              <p className="font-medium text-slate-600">
                {busqueda || filtroEstado ? 'Sin resultados para esta búsqueda' : 'No hay vehículos registrados'}
              </p>
              {!esAdmin && !busqueda && (
                <p className="text-xs mt-1">Usa el botón "Registrar Vehículo" para agregar tu primer vehículo</p>
              )}
            </div>
          ) : (
            <>
              {/* ── Vista mobile: cards ── */}
              <div className="sm:hidden space-y-3">
                {vehiculos.map(v => (
                  <div key={v.id} className="bg-white rounded-xl shadow-sm p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-slate-800 text-base">{v.placa}</span>
                          {/* Badge semáforo de documentación */}
                          {v.estadoDocumentacion && v.estadoDocumentacion !== 'al_dia' && (() => {
                            const d = DOC_BADGE[v.estadoDocumentacion]
                            return d ? (
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${d.cls}`}>
                                {d.icon} {d.label}
                              </span>
                            ) : null
                          })()}
                          {enParqueo.has(v.placa) && (
                            <span className="flex items-center gap-1 text-[10px] font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full border border-violet-200"
                              title={`En parqueo: ${enParqueo.get(v.placa)}`}>
                              🅿 {enParqueo.get(v.placa)}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-600 mt-0.5">{v.marca} {v.modelo} · {v.anio}</p>
                        <p className="text-xs text-slate-400">{v.tipo?.nombre} · <span className="capitalize">{v.color}</span></p>
                        {esAdmin && <p className="text-xs text-slate-500 mt-0.5">{v.propietarioNombre}</p>}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${ESTADO_BADGE[v.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                        {v.estado}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <button onClick={() => abrirQr(v)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-emerald-700 bg-emerald-50 rounded-lg">
                        <QrCode size={13} /> QR
                      </button>
                      <button onClick={() => navigate(`/vehiculos/${v.id}/historial`)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-indigo-700 bg-indigo-50 rounded-lg">
                        <History size={13} /> Historial
                      </button>
                      {esAdmin && (
                        <button onClick={() => abrirEditar(v)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-blue-700 bg-blue-50 rounded-lg">
                          <Edit size={13} /> Editar
                        </button>
                      )}
                      {(esAdmin || !esAdmin) && (
                        <button onClick={() => abrirDocumento(v)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs text-violet-700 bg-violet-50 rounded-lg">
                          <FileText size={13} /> Docs
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Vista desktop: tabla ── */}
              <div className="hidden sm:block bg-white rounded-xl shadow-sm overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                    <tr>
                      <th className="px-4 py-3 text-left">Placa</th>
                      <th className="px-4 py-3 text-left">Tipo</th>
                      <th className="px-4 py-3 text-left">Marca / Modelo</th>
                      <th className="px-4 py-3 text-left">Año</th>
                      <th className="px-4 py-3 text-left">Color</th>
                      <th className="px-4 py-3 text-left">Estado</th>
                      {esAdmin && <th className="px-4 py-3 text-left">Propietario</th>}
                      <th className="px-4 py-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vehiculos.map(v => (
                      <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-slate-800">{v.placa}</span>
                            {enParqueo.has(v.placa) && (
                              <span className="text-[10px] font-medium bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full border border-violet-200 whitespace-nowrap"
                                title={`En parqueo: ${enParqueo.get(v.placa)}`}>
                                🅿 {enParqueo.get(v.placa)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{v.tipo?.nombre}</td>
                        <td className="px-4 py-3 text-slate-700">{v.marca} {v.modelo}</td>
                        <td className="px-4 py-3 text-slate-600">{v.anio}</td>
                        <td className="px-4 py-3 text-slate-600 capitalize">{v.color}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 items-start">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ESTADO_BADGE[v.estado] ?? 'bg-slate-100 text-slate-600'}`}>
                              {v.estado}
                            </span>
                            {v.enAlerta && (
                              <span title={v.motivoAlerta}
                                className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-600 text-white flex items-center gap-1 animate-pulse">
                                <AlertTriangle size={10} /> EN ALERTA
                              </span>
                            )}
                          </div>
                        </td>
                        {esAdmin && <td className="px-4 py-3 text-slate-600">{v.propietarioNombre}</td>}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button onClick={() => abrirQr(v)} title="Ver QR"
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                              <QrCode size={15} />
                            </button>
                            <button onClick={() => navigate(`/vehiculos/${v.id}/historial`)} title="Ver historial"
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                              <History size={15} />
                            </button>
                            {esAdmin && (
                              <>
                                <button onClick={() => abrirEditar(v)} title="Editar"
                                  className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                                  <Edit size={15} />
                                </button>
                                <button onClick={() => abrirDocumento(v)} title="Documentos"
                                  className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
                                  <FileText size={15} />
                                </button>
                                <button onClick={() => toggleAlertaSeguridad(v)}
                                  title={v.enAlerta ? 'Quitar alerta de seguridad' : 'Marcar en alerta de seguridad'}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    v.enAlerta
                                      ? 'text-red-600 bg-red-50 hover:bg-red-100'
                                      : 'text-slate-400 hover:text-red-600 hover:bg-red-50'}`}>
                                  <AlertTriangle size={15} />
                                </button>
                                <button onClick={() => marcarFrecuente({ variables: { vehiculoId: Number(v.id), esFrecuente: !v.esFrecuente } })}
                                  title={v.esFrecuente ? 'Quitar de carril express' : 'Marcar como frecuente (carril express)'}
                                  className={`p-1.5 rounded-lg transition-colors ${
                                    v.esFrecuente
                                      ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                      : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'}`}>
                                  <Zap size={15} />
                                </button>
                              </>
                            )}
                            {!esAdmin && v.propietarioNombre && (
                              <button onClick={() => abrirDocumento(v)} title="Mis documentos"
                                className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors">
                                <FileText size={15} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              {totalPaginas > 1 && (
                <div className="flex items-center justify-between mt-4 text-sm text-slate-500">
                  <span>{total} vehículo{total !== 1 ? 's' : ''} · Página {pagina} de {totalPaginas}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPagina(p => Math.max(1, p - 1))}
                      disabled={pagina === 1}
                      className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPaginas || Math.abs(p - pagina) <= 1)
                      .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                        if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…')
                        acc.push(p); return acc
                      }, [])
                      .map((p, i) =>
                        p === '…' ? (
                          <span key={`e${i}`} className="px-2">…</span>
                        ) : (
                          <button
                            key={p}
                            onClick={() => setPagina(p as number)}
                            className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                              pagina === p
                                ? 'bg-emerald-500 text-white'
                                : 'hover:bg-slate-100 text-slate-600'
                            }`}
                          >
                            {p}
                          </button>
                        )
                      )}
                    <button
                      onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                      disabled={pagina === totalPaginas}
                      className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
              {totalPaginas === 1 && total > 0 && (
                <p className="text-center text-xs text-slate-400 mt-3">{total} vehículo{total !== 1 ? 's' : ''}</p>
              )}
            </>
          )}
        </>
      )}

      {/* ── TAB: PENDIENTES ── */}
      {tab === 'pendientes' && esAdmin && (
        <>
          {pendientes.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <CheckCircle size={40} className="mx-auto mb-2 text-emerald-400 opacity-60" />
              <p className="font-medium text-slate-600">No hay vehículos pendientes</p>
              <p className="text-xs mt-1">Todos los vehículos han sido revisados</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendientes.map(v => (
                <div key={v.id} className="bg-white rounded-xl shadow-sm border border-amber-200 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono font-bold text-slate-800 text-lg">{v.placa}</span>
                        <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Clock size={10} /> Pendiente
                        </span>
                      </div>
                      <p className="text-slate-600 text-sm">{v.marca} {v.modelo} · {v.anio} · <span className="capitalize">{v.color}</span></p>
                      <p className="text-slate-500 text-xs mt-0.5">Tipo: {v.tipo?.nombre} · Propietario: {v.propietarioNombre}</p>
                      <p className="text-slate-400 text-xs mt-0.5">
                        Registrado: {new Date(v.createdAt).toLocaleString('es-BO', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                      {v.documentos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {v.documentos.map(d => (
                            <span key={d.id} className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full">
                              {TIPO_DOC_LABELS[d.tipoDoc]} · vence {d.fechaVencimiento}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => aprobarVehiculo({ variables: { vehiculoId: v.id } })}
                        disabled={loadingAprobar}
                        className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50 font-medium"
                      >
                        <CheckCircle size={15} /> Aprobar
                      </button>
                      <button
                        onClick={() => abrirRechazar(v)}
                        className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-sm px-3 py-2 rounded-lg transition-colors font-medium border border-red-200"
                      >
                        <XCircle size={15} /> Rechazar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── MODALES ── */}

      {/* Modal Registrar — Wizard de 3 pasos */}
      {modal === 'registrar' && (
        <WizardRegistrarVehiculo
          tipos={tipos}
          usuarios={usuarios}
          esAdmin={esAdmin}
          usuario={usuario}
          onClose={cerrarModal}
          onFotoFile={f => { fotoVehiculoRef.current = f }}
          registrarVehiculo={registrarVehiculo}
          loadingRegistrar={loadingRegistrar}
        />
      )}

      {/* Modal Rechazar */}
      {modal === 'rechazar' && seleccionado && (
        <ModalWrapper titulo={`Rechazar — ${seleccionado.placa}`} onClose={cerrarModal}>
          <form onSubmit={handleRechazar} className="space-y-3">
            <p className="text-sm text-slate-600">
              Indica el motivo del rechazo. El propietario recibirá una notificación.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Motivo *</label>
              <textarea
                value={motivoRechazo}
                onChange={e => setMotivoRechazo(e.target.value)}
                rows={3}
                placeholder="Ej: Documentación incompleta, placa ilegible..."
                className={`${inputCls} resize-none`}
              />
            </div>
            {error && <MsgError texto={error} />}
            <button
              type="submit"
              disabled={loadingRechazar}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              {loadingRechazar ? 'Rechazando...' : 'Confirmar rechazo'}
            </button>
          </form>
        </ModalWrapper>
      )}

      {/* Modal Editar */}
      {modal === 'editar' && seleccionado && (
        <ModalWrapper titulo={`Editar — ${seleccionado.placa}`} onClose={cerrarModal}>
          <form onSubmit={handleActualizar} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Marca" name="marca" defaultValue={seleccionado.marca} />
              <Campo label="Modelo" name="modelo" defaultValue={seleccionado.modelo} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo label="Año" name="anio" type="number" defaultValue={String(seleccionado.anio)} />
              <Campo label="Color" name="color" defaultValue={seleccionado.color} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Estado</label>
              <select name="estado" defaultValue={seleccionado.estado} className={inputCls}>
                <option value="pendiente">Pendiente de aprobación</option>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
                <option value="sancionado">Sancionado</option>
              </select>
            </div>
            {error && <MsgError texto={error} />}
            <BtnSubmit loading={loadingActualizar} label="Guardar cambios" />
          </form>
        </ModalWrapper>
      )}

      {/* Modal Documento — con semáforo + validación de fecha */}
      {modal === 'documento' && seleccionado && (
        <ModalWrapper titulo={`Documentos — ${seleccionado.placa}`} onClose={cerrarModal}>

          {/* Lista de documentos con semáforo visual */}
          {seleccionado.documentos.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Documentos registrados
              </p>
              <div className="space-y-1.5">
                {seleccionado.documentos.map(d => {
                  const sem = semDocModal(d.fechaVencimiento)
                  return (
                    <div key={d.id}
                      className={`flex items-center justify-between rounded-xl px-3 py-2.5 border ${sem.cls}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">{sem.icono}</span>
                        <span className="font-semibold text-sm truncate">
                          {TIPO_DOC_LABELS[d.tipoDoc] ?? d.tipoDoc}
                        </span>
                        <span className="text-xs opacity-70">N° {d.numero}</span>
                      </div>
                      <span className="text-xs font-medium shrink-0 ml-2">{sem.label}</span>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-slate-200 my-4" />
            </div>
          )}

          {/* Formulario — orden: Tipo → Foto (contextual) → Número → Fecha → Botón */}
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Agregar documento
          </p>
          <form onSubmit={handleDocumento} className="space-y-4">

            {/* 1. Tipo de documento */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipo *</label>
              <select
                name="tipoDoc"
                required
                value={tipoDocSel}
                onChange={e => setTipoDocSel(e.target.value)}
                className={inputCls}
              >
                <option value="soat">SOAT</option>
                <option value="tecnica">Revisión Técnica</option>
                <option value="circulacion">Permiso de Circulación</option>
                <option value="otro">Otro documento</option>
              </select>
            </div>

            {/* 2. Foto/PDF — AL INICIO, contextual por tipo, SIEMPRE VISIBLE */}
            <div className="rounded-2xl border-2 border-dashed p-4 transition-colors
              bg-slate-50 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50">
              <p className="text-xs font-semibold text-slate-600 mb-3">
                📸 {TEXTO_FOTO[tipoDocSel] ?? 'Foto o PDF del documento'}
                <span className="ml-1 font-normal text-slate-400">(recomendado)</span>
              </p>

              {archivoDoc ? (
                /* Vista previa cuando hay archivo seleccionado */
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-300 rounded-xl px-3 py-2.5">
                  <span className="text-2xl shrink-0">
                    {archivoDoc.name.endsWith('.pdf') ? '📄' : '🖼'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-800 truncate">{archivoDoc.name}</p>
                    <p className="text-xs text-emerald-600">{(archivoDoc.size / 1024).toFixed(0)} KB · listo para subir</p>
                  </div>
                  <button type="button"
                    onClick={e => { e.preventDefault(); setArchivoDoc(null); if (archivoInputRef.current) archivoInputRef.current.value = '' }}
                    className="shrink-0 text-slate-400 hover:text-red-500 p-1 rounded-lg hover:bg-red-50 transition-colors">
                    <X size={15} />
                  </button>
                </div>
              ) : (
                /* Botón de upload prominente */
                <label className="flex flex-col items-center gap-2 cursor-pointer py-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl">
                    📷
                  </div>
                  <p className="text-sm font-medium text-slate-700">Toca para seleccionar</p>
                  <p className="text-xs text-slate-400">JPG, PNG o PDF · máx. 5 MB</p>
                  <input
                    ref={archivoInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f && f.size > 5 * 1024 * 1024) {
                        toast.error('Archivo demasiado grande', 'El límite es 5 MB')
                        e.target.value = ''
                      } else {
                        setArchivoDoc(f ?? null)
                      }
                    }}
                  />
                </label>
              )}
            </div>

            {/* 3. Número de documento */}
            <Campo label="Número de documento *" name="numero" placeholder="Ej: P-12345" />

            {/* 4. Fecha de vencimiento con validación en tiempo real */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Fecha de vencimiento *
              </label>
              <input
                type="date"
                name="fechaVencimiento"
                required
                value={fechaDoc}
                onChange={e => setFechaDoc(e.target.value)}
                className={`${inputCls} ${
                  fechaDoc && validarFechaDoc(fechaDoc)?.tipo === 'error'
                    ? 'border-red-400 bg-red-50'
                    : fechaDoc && validarFechaDoc(fechaDoc)?.tipo === 'warn'
                    ? 'border-amber-400 bg-amber-50'
                    : ''
                }`}
              />
              {fechaDoc && (() => {
                const v = validarFechaDoc(fechaDoc)
                if (!v) return null
                const s = { error: 'text-red-600 bg-red-50 border-red-200', warn: 'text-amber-700 bg-amber-50 border-amber-200' }
                return (
                  <div className={`mt-1.5 text-xs px-3 py-2 rounded-lg border flex items-start gap-1.5 ${s[v.tipo]}`}>
                    <span className="shrink-0">{v.tipo === 'error' ? '🚫' : '⚠'}</span>
                    <span>{v.msg}</span>
                  </div>
                )
              })()}
            </div>

            {error && <MsgError texto={error} />}
            <button type="submit" disabled={loadingDoc || subiendoArchivo}
              className={`w-full font-semibold py-2.5 rounded-xl text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
                archivoDoc
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}>
              {(loadingDoc || subiendoArchivo)
                ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> {subiendoArchivo ? 'Subiendo archivo...' : 'Guardando...'}</>
                : archivoDoc
                ? <>📎 Agregar y subir archivo</>
                : 'Agregar documento'
              }
            </button>
          </form>
        </ModalWrapper>
      )}

      {/* Modal QR Dinámico */}
      {modal === 'qr' && seleccionado && (
        <ModalWrapper titulo={`Código QR — ${seleccionado.placa}`} onClose={cerrarModal}>
          <div className="flex flex-col items-center gap-4">

            {seleccionado.estado === 'pendiente' && (
              <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2 text-amber-700 text-xs">
                <Clock size={14} className="shrink-0 mt-0.5" />
                Vehículo <strong>pendiente de aprobación</strong>. El QR no será aceptado en portería hasta que un administrador lo apruebe.
              </div>
            )}

            {seleccionado.estado === 'sancionado' && (
              <div className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2 text-red-700 text-xs">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                Vehículo <strong>sancionado</strong>. El QR será rechazado hasta regularizar todas las sanciones pendientes.
              </div>
            )}

            {seleccionado.estado === 'activo' && (
              <QrDinamico vehiculoId={seleccionado.id} placa={seleccionado.placa} />
            )}

            {seleccionado.estado === 'inactivo' && (
              <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-center text-slate-500 text-sm">
                Vehículo inactivo. Contacta a la administración para reactivarlo.
              </div>
            )}

            {/* Botón de emergencia: invalidar secret si hubo compromiso */}
            {seleccionado.estado === 'activo' && (
              !confirmarRegen ? (
                <button
                  onClick={() => setConfirmarRegen(true)}
                  className="flex items-center gap-2 text-xs text-slate-400 hover:text-orange-600 border border-slate-200 hover:border-orange-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <RefreshCw size={12} /> Invalidar QR por seguridad
                </button>
              ) : (
                <div className="w-full bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-amber-800 text-sm font-medium mb-1">¿Invalidar QR actual?</p>
                  <p className="text-amber-700 text-xs mb-3">
                    Úsalo solo si crees que alguien tuvo acceso a tu pantalla en el momento exacto del código.
                    Se generará un nuevo secreto — los códigos anteriores dejarán de funcionar.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { regenerarQr({ variables: { vehiculoId: seleccionado.id } }); setConfirmarRegen(false) }}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm py-2 rounded-lg transition-colors"
                    >
                      Sí, invalidar
                    </button>
                    <button onClick={() => setConfirmarRegen(false)}
                      className="flex-1 border border-slate-300 text-slate-600 text-sm py-2 rounded-lg hover:bg-slate-50 transition-colors">
                      Cancelar
                    </button>
                  </div>
                </div>
              )
            )}
            {error && <MsgError texto={error} />}
          </div>
        </ModalWrapper>
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />

      <PromptModal
        open={!!alertaPrompt}
        titulo={alertaPrompt ? `Marcar ${alertaPrompt.placa} EN ALERTA` : ''}
        mensaje="Motivo de la alerta de seguridad (robo, búsqueda, acceso revocado):"
        placeholder="Ej: Reportado como robado"
        confirmLabel="Marcar en alerta"
        peligro
        onConfirmar={confirmarAlertaSeguridad}
        onCancelar={() => setAlertaPrompt(null)}
      />
    </div>
  )
}

// ── Componentes auxiliares ────────────────────────────────────────

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400'

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-emerald-500 text-emerald-600'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function Campo({ label, name, type = 'text', placeholder = '', defaultValue = '' }: {
  label: string; name: string; type?: string; placeholder?: string; defaultValue?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input
        type={type} name={name} placeholder={placeholder} defaultValue={defaultValue}
        className={inputCls}
      />
    </div>
  )
}

function ModalWrapper({ titulo, onClose, children, ancho = 'max-w-md' }: {
  titulo: string; onClose: () => void; children: React.ReactNode; ancho?: string
}) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${ancho} max-h-[90vh] overflow-y-auto animate-flip-modal`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 animate-text-pop-up-l">{titulo}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:rotate-90 transition-transform duration-200"><X size={18} /></button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function MsgError({ texto }: { texto: string }) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-start gap-2">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      {texto}
    </div>
  )
}

function BtnSubmit({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button
      type="submit" disabled={loading}
      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50"
    >
      {loading ? 'Guardando...' : label}
    </button>
  )
}

// ── Wizard de registro de vehículo en 3 pasos ─────────────────────────────

// Formato boliviano vigente (2016): 3-4 números + 3 letras (ej. 1234-ABC).
const PLACA_RE = /^\d{3,4}[-\s]?[A-Z]{3}$/i

const COLORES_PRESET = [
  { nombre: 'Blanco',      hex: '#FFFFFF' },
  { nombre: 'Negro',       hex: '#1a1a1a' },
  { nombre: 'Gris',        hex: '#9CA3AF' },
  { nombre: 'Plata',       hex: '#C0C0C0' },
  { nombre: 'Rojo',        hex: '#EF4444' },
  { nombre: 'Azul',        hex: '#3B82F6' },
  { nombre: 'Azul oscuro', hex: '#1E3A5F' },
  { nombre: 'Verde',       hex: '#22C55E' },
  { nombre: 'Amarillo',    hex: '#EAB308' },
  { nombre: 'Naranja',     hex: '#F97316' },
  { nombre: 'Morado',      hex: '#A855F7' },
  { nombre: 'Café',        hex: '#92400E' },
  { nombre: 'Beige',       hex: '#F5F0DC' },
  { nombre: 'Celeste',     hex: '#7DD3FC' },
  { nombre: 'Vino',        hex: '#7F1D1D' },
  { nombre: 'Verde oscuro',hex: '#14532D' },
]

const MARCAS_COMUNES = [
  'Toyota','Honda','Chevrolet','Hyundai','Kia','Nissan','Mazda','Ford',
  'Volkswagen','Suzuki','Mitsubishi','BMW','Mercedes-Benz','Audi',
  'Renault','Peugeot','Fiat','Jeep','Land Rover','Subaru',
]

function tipoIcon(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.includes('moto'))                       return '🏍'
  if (n.includes('bicicl'))                     return '🚲'
  if (n.includes('camioneta') || n.includes('pickup')) return '🚙'
  if (n.includes('camion'))                     return '🚛'
  if (n.includes('bus') || n.includes('mini'))  return '🚌'
  if (n.includes('tricicl'))                    return '🛺'
  return '🚗'
}

export interface WizardProps {
  tipos: any[]; usuarios: any[]; esAdmin: boolean; usuario: any
  onClose: () => void
  onFotoFile: (f: File | null) => void
  registrarVehiculo: (opts: any) => void
  loadingRegistrar: boolean
}

export function WizardRegistrarVehiculo({ tipos, usuarios, esAdmin, usuario, onClose, onFotoFile, registrarVehiculo, loadingRegistrar }: WizardProps) {
  const [paso, setPaso] = useState(1)

  // Paso 1
  const [placa, setPlaca]           = useState('')
  const [tipoId, setTipoId]         = useState(0)
  const [propietarioId, setPropId]  = useState<number>(esAdmin ? 0 : usuario.id)
  const [fotoFile, setFotoFile]     = useState<File | null>(null)
  const [fotoPreview, setFotoPreview] = useState('')
  const [dragOver, setDragOver]     = useState(false)
  const fotoInputRef                = useRef<HTMLInputElement>(null)

  // Paso 2
  const [marca, setMarca]           = useState('')
  const [modelo, setModelo]         = useState('')
  const [anio, setAnio]             = useState(new Date().getFullYear())
  const [colorNombre, setColorNombre] = useState('')
  const [colorHex, setColorHex]     = useState('')
  const [cilindrada, setCilindrada] = useState('')
  const [numPuertas, setNumPuertas] = useState<number | null>(null)
  const [capacidadCarga, setCapCarga] = useState('')

  // Paso 2 — documentación (agrupada con datos técnicos en un acordeón opcional)
  const [numeroSoat, setNumeroSoat]   = useState('')
  const [soatFecha, setSoatFecha]     = useState('')
  const [numeroMotor, setNumMotor]    = useState('')
  const [numeroChasis, setNumChasis]  = useState('')
  const [tooltipMotor, setTooltipMotor] = useState(false)
  const [tooltipChasis, setTooltipChasis] = useState(false)

  // Acordeones del paso 2 — colapsados por defecto para que registrar
  // un vehículo tome solo 2 pantallas en vez de 3 (feedback de predefensa:
  // "son muchos pasos"). Quien quiera detallar marca/SOAT/etc. los expande.
  const [verDatosVeh, setVerDatosVeh] = useState(false)
  const [verDocs, setVerDocs]         = useState(false)

  const [errWizard, setErrWizard]   = useState('')

  const placaValida = PLACA_RE.test(placa.trim())
  const tipoSel     = tipos.find((t: any) => t.id === tipoId)
  const esMotoCiclo = tipoSel && (tipoSel.nombre.toLowerCase().includes('moto') || tipoSel.nombre.toLowerCase().includes('bicicl'))
  const esCarga     = tipoSel && (tipoSel.nombre.toLowerCase().includes('camion') || tipoSel.nombre.toLowerCase().includes('pickup'))
  const paso1OK     = placaValida && tipoId > 0 && (!esAdmin || propietarioId > 0)

  function handleFotoChange(file: File | null) {
    if (!file) return
    if (file.size > 3 * 1024 * 1024) { setErrWizard('La foto supera 3 MB'); return }
    setFotoFile(file); setFotoPreview(URL.createObjectURL(file))
  }

  function selColor(nombre: string, hex: string) {
    setColorNombre(nombre); setColorHex(hex)
  }

  function avanzar() { setErrWizard(''); setPaso(p => p + 1) }
  function retroceder() { setErrWizard(''); setPaso(p => p - 1) }

  function buildInput() {
    return {
      placa: placa.trim().toUpperCase(),
      tipoId,
      propietarioId: esAdmin ? propietarioId : usuario.id,
      marca:  marca.trim()  || 'Sin especificar',
      modelo: modelo.trim() || 'Sin especificar',
      anio:   anio || new Date().getFullYear(),
      color:  colorNombre   || 'Sin especificar',
      colorHex:        colorHex        || null,
      cilindrada:      cilindrada      || null,
      numPuertas:      numPuertas,
      capacidadCarga:  capacidadCarga  || null,
      numeroSoat:      numeroSoat      || null,
      soatFechaVencimiento: (numeroSoat && soatFecha) ? soatFecha : null,
      numeroMotor:     numeroMotor     || null,
      numeroChasis:    numeroChasis    || null,
      fotoVehiculo:    '',
    }
  }

  function handleRegistrar() {
    setErrWizard('')
    onFotoFile(fotoFile)
    registrarVehiculo({ variables: { input: buildInput() } })
  }

  const PASOS = ['Identificación', 'Detalles (opcional)']

  return (
    <ModalWrapper titulo="Registrar Vehículo" onClose={onClose} ancho="max-w-lg">

      {/* Indicador de pasos */}
      <div className="flex items-center justify-center gap-0 mb-6">
        {PASOS.map((label, idx) => {
          const num = idx + 1
          const activo = num === paso
          const completado = num < paso
          return (
            <div key={num} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all
                  ${completado ? 'bg-emerald-500 text-white' : activo ? 'bg-emerald-600 text-white ring-4 ring-emerald-100' : 'bg-slate-200 text-slate-400'}`}>
                  {completado ? '✓' : num}
                </div>
                <span className={`text-[10px] font-medium ${activo ? 'text-emerald-600' : 'text-slate-400'}`}>{label}</span>
              </div>
              {idx < PASOS.length - 1 && (
                <div className={`w-10 h-0.5 mx-1 mb-4 transition-colors ${num < paso ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* ── PASO 1: Identificación básica ── */}
      {paso === 1 && (
        <div className="space-y-4">
          {!esAdmin && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
              El vehículo quedará en <strong>Pendiente</strong> hasta que un administrador lo apruebe.
            </div>
          )}

          {/* Placa con validación en tiempo real */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Placa *</label>
            <div className="relative">
              <input
                type="text"
                value={placa}
                onChange={e => setPlaca(e.target.value.toUpperCase())}
                placeholder="1234-ABC"
                maxLength={10}
                className={`${inputCls} pr-8 font-mono tracking-widest transition-colors ${
                  placa.length > 2
                    ? placaValida
                      ? 'border-emerald-400 bg-emerald-50 focus:ring-emerald-400'
                      : 'border-red-400 bg-red-50 focus:ring-red-400'
                    : ''
                }`}
              />
              {placa.length > 2 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                  {placaValida ? '✓' : '✗'}
                </span>
              )}
            </div>
            {placa.length > 2 && !placaValida && (
              <p className="text-xs text-red-600 mt-1">Formato: 3-4 números + 3 letras (ej: 1234-ABC, 123-XYZ)</p>
            )}
          </div>

          {/* Propietario (solo admin) */}
          {esAdmin ? (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Propietario *</label>
              <select
                value={propietarioId || ''}
                onChange={e => setPropId(parseInt(e.target.value))}
                className={inputCls}
                required
              >
                <option value="">Seleccionar usuario...</option>
                {usuarios.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.nombreCompleto} — {u.ci}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-600">
              Propietario: <strong>{usuario.nombreCompleto}</strong>
            </div>
          )}

          {/* Tipo con íconos */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Tipo de vehículo *</label>
            <div className="grid grid-cols-3 gap-2">
              {tipos.map((t: any) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTipoId(t.id); setNumPuertas(null) }}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 text-xs font-medium transition-all
                    ${tipoId === t.id
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 scale-105'
                      : 'border-slate-200 hover:border-emerald-300 text-slate-600'}`}
                >
                  <span className="text-xl">{tipoIcon(t.nombre)}</span>
                  <span className="text-center leading-tight">{t.nombre}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Foto del vehículo — drag & drop */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Foto del vehículo <span className="font-normal text-slate-400">(recomendado)</span></label>
            {fotoPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-emerald-300">
                <img src={fotoPreview} alt="Vista previa" className="w-full h-32 object-cover" />
                <button
                  type="button"
                  onClick={() => { setFotoFile(null); setFotoPreview(''); if (fotoInputRef.current) fotoInputRef.current.value = '' }}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors"
                >
                  <X size={12} />
                </button>
                <span className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                  {fotoFile?.name}
                </span>
              </div>
            ) : (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault(); setDragOver(false)
                  const f = e.dataTransfer.files[0]
                  if (f) handleFotoChange(f)
                }}
                onClick={() => fotoInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all
                  ${dragOver ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'}`}
              >
                <span className="text-3xl block mb-1">🚗</span>
                <p className="text-sm text-slate-500">Arrastra o toca para subir</p>
                <p className="text-xs text-slate-400 mt-0.5">JPG, PNG, WEBP · máx. 3 MB</p>
              </div>
            )}
            <input ref={fotoInputRef} type="file" className="hidden" accept="image/*"
              onChange={e => handleFotoChange(e.target.files?.[0] ?? null)} />
          </div>
        </div>
      )}

      {/* ── PASO 2: Detalles opcionales — agrupados en acordeones colapsados ──
           Antes eran 2 pasos separados (Datos técnicos / Documentación) con
           ~10 campos visibles de entrada. Ahora es un único paso opcional:
           el registro puede terminar aquí mismo, y quien quiera detallar
           marca/SOAT/etc. expande solo la sección que le interesa. */}
      {paso === 2 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            Todo lo de aquí es <strong>opcional</strong> — puedes registrar el vehículo ya mismo
            y completar estos datos después desde "Mis Vehículos". Ayudan a identificar tu
            vehículo y a crear automáticamente el documento del SOAT.
          </p>

          {/* Acordeón: Datos del vehículo */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setVerDatosVeh(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Car size={15} className="text-slate-400" />
                Datos del vehículo
                <span className="text-xs font-normal text-slate-400">marca, color, cilindrada...</span>
              </span>
              {verDatosVeh ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {verDatosVeh && (
              <div className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-100">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Marca</label>
                    <input type="text" list="marcas-lista" value={marca} onChange={e => setMarca(e.target.value)}
                      placeholder="Toyota" className={inputCls} />
                    <datalist id="marcas-lista">
                      {MARCAS_COMUNES.map(m => <option key={m} value={m} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Modelo</label>
                    <input type="text" value={modelo} onChange={e => setModelo(e.target.value)}
                      placeholder="Corolla" className={inputCls} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Año</label>
                  <input type="number" value={anio} min={1900} max={2027}
                    onChange={e => setAnio(parseInt(e.target.value))}
                    className={`${inputCls} ${anio < 1900 || anio > 2027 ? 'border-red-400' : ''}`} />
                  {(anio < 1900 || anio > 2027) && <p className="text-xs text-red-600 mt-1">Año entre 1900 y 2027</p>}
                </div>

                {/* Selector de color visual */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Color</label>
                  <div className="grid grid-cols-8 gap-1.5 mb-2">
                    {COLORES_PRESET.map(c => (
                      <button key={c.nombre} type="button" title={c.nombre}
                        onClick={() => selColor(c.nombre, c.hex)}
                        style={{ backgroundColor: c.hex }}
                        className={`w-7 h-7 rounded-full border transition-all
                          ${colorHex === c.hex
                            ? 'ring-2 ring-offset-1 ring-emerald-500 scale-125 border-emerald-400'
                            : 'border-slate-300 hover:scale-110'}`}
                      />
                    ))}
                  </div>
                  {colorNombre && (
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <span className="w-4 h-4 rounded-full border border-slate-300 shrink-0" style={{ backgroundColor: colorHex }} />
                      {colorNombre} seleccionado
                    </div>
                  )}
                </div>

                {/* Cilindrada y puertas (condicional) */}
                {!esMotoCiclo && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cilindrada</label>
                      <input type="text" value={cilindrada} onChange={e => setCilindrada(e.target.value)}
                        placeholder="1.6L" className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Puertas</label>
                      <div className="flex gap-1.5">
                        {[2, 3, 4, 5].map(n => (
                          <button key={n} type="button"
                            onClick={() => setNumPuertas(numPuertas === n ? null : n)}
                            className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all
                              ${numPuertas === n ? 'bg-emerald-500 text-white border-emerald-500' : 'border-slate-300 text-slate-600 hover:border-emerald-300'}`}>
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {esCarga && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Capacidad de carga</label>
                    <input type="text" value={capacidadCarga} onChange={e => setCapCarga(e.target.value)}
                      placeholder="1000 kg" className={inputCls} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Acordeón: Documentación */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setVerDocs(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <FileText size={15} className="text-slate-400" />
                Documentación
                <span className="text-xs font-normal text-slate-400">SOAT, motor, chasis</span>
              </span>
              {verDocs ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </button>
            {verDocs && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100">
                <p className="text-xs text-slate-500">Ingresa el SOAT para crear el documento automáticamente.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Número SOAT</label>
                    <input type="text" value={numeroSoat} onChange={e => setNumeroSoat(e.target.value)}
                      placeholder="SOA-123456" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Vencimiento SOAT{numeroSoat ? ' *' : ''}
                    </label>
                    <input type="date" value={soatFecha} onChange={e => setSoatFecha(e.target.value)}
                      className={`${inputCls} ${numeroSoat && !soatFecha ? 'border-red-400' : ''}`} />
                  </div>
                </div>
                {numeroSoat && !soatFecha && (
                  <p className="text-xs text-red-600 -mt-1">La fecha de vencimiento del SOAT es requerida</p>
                )}

                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <div className="relative">
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                      Número de motor
                      <button type="button" onMouseEnter={() => setTooltipMotor(true)} onMouseLeave={() => setTooltipMotor(false)}
                        className="text-slate-400 hover:text-slate-600">
                        <span className="text-xs border border-slate-300 rounded-full w-4 h-4 inline-flex items-center justify-center">?</span>
                      </button>
                    </label>
                    {tooltipMotor && (
                      <div className="absolute bottom-full left-0 mb-1 z-10 bg-slate-800 text-white text-xs px-3 py-2 rounded-lg max-w-xs shadow-lg">
                        Encuéntralo en la tarjeta de propiedad del vehículo o en el motor físicamente.
                      </div>
                    )}
                    <input type="text" value={numeroMotor} onChange={e => setNumMotor(e.target.value)}
                      placeholder="MTR-XYZ789" className={inputCls} />
                  </div>

                  <div className="relative">
                    <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1">
                      Número de chasis (VIN)
                      <button type="button" onMouseEnter={() => setTooltipChasis(true)} onMouseLeave={() => setTooltipChasis(false)}
                        className="text-slate-400 hover:text-slate-600">
                        <span className="text-xs border border-slate-300 rounded-full w-4 h-4 inline-flex items-center justify-center">?</span>
                      </button>
                    </label>
                    {tooltipChasis && (
                      <div className="absolute bottom-full left-0 mb-1 z-10 bg-slate-800 text-white text-xs px-3 py-2 rounded-lg max-w-xs shadow-lg">
                        17 caracteres alfanuméricos. Está en el parabrisas (esquina inferior izquierda) o en la tarjeta de propiedad.
                      </div>
                    )}
                    <input type="text" value={numeroChasis} onChange={e => setNumChasis(e.target.value.toUpperCase())}
                      placeholder="1HGCM82633A123456" className={`${inputCls} font-mono`} maxLength={17} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {errWizard && <MsgError texto={errWizard} />}

      {/* Navegación */}
      <div className="flex items-center gap-2 mt-6 pt-4 border-t border-slate-100">
        {paso > 1 && (
          <button type="button" onClick={retroceder}
            className="flex items-center gap-1 px-4 py-2 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
            <ChevronLeft size={14} /> Anterior
          </button>
        )}
        <div className="flex-1" />
        {paso === 1 ? (
          <button type="button" onClick={avanzar}
            disabled={!paso1OK}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-40">
            Siguiente <ChevronRight size={14} />
          </button>
        ) : (
          <button type="button" onClick={handleRegistrar} disabled={loadingRegistrar || (!!numeroSoat && !soatFecha)}
            className="flex items-center gap-2 px-5 py-2 text-sm bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg transition-colors disabled:opacity-40">
            {loadingRegistrar
              ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Registrando...</>
              : '✓ Registrar vehículo'}
          </button>
        )}
      </div>
    </ModalWrapper>
  )
}
