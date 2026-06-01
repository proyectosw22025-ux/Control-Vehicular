/**
 * VerAutorizacion — Página pública /autorizacion/:codigo
 * El proveedor abre esta URL en su celular y muestra la pantalla al guardia.
 * El guardia también puede verificar escaneando el código manualmente.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import {
  CheckCircle, XCircle, Clock, Building2, Truck,
  MapPin, AlertTriangle, Loader2, QrCode,
} from 'lucide-react'
import { VERIFICAR_AUTORIZACION_EXTERNA_QUERY } from '../graphql/queries/acceso'

const ESTADO_CFG: Record<string, {
  label: string; color: string; bg: string; border: string; icon: JSX.Element
}> = {
  vigente:  { label: 'VÁLIDO — puede ingresar',    color: '#166534', bg: '#dcfce7', border: '#22c55e', icon: <CheckCircle size={18}/> },
  pendiente:{ label: 'AÚN NO VÁLIDO',              color: '#854d0e', bg: '#fef9c3', border: '#eab308', icon: <Clock size={18}/> },
  usada:    { label: 'YA UTILIZADO',               color: '#475569', bg: '#f1f5f9', border: '#94a3b8', icon: <XCircle size={18}/> },
  vencida:  { label: 'VENCIDO',                    color: '#9a3412', bg: '#fee2e2', border: '#ef4444', icon: <Clock size={18}/> },
  revocada: { label: 'REVOCADO',                   color: '#991b1b', bg: '#fee2e2', border: '#dc2626', icon: <XCircle size={18}/> },
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-BO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function VerAutorizacion() {
  const { codigo } = useParams<{ codigo: string }>()
  const [qrUrl, setQrUrl] = useState('')
  const [grande, setGrande] = useState(false)

  const { data, loading, error } = useQuery(VERIFICAR_AUTORIZACION_EXTERNA_QUERY, {
    variables: { codigo: codigo?.toUpperCase() ?? '' },
    skip: !codigo,
    fetchPolicy: 'network-only',
  })

  const auth = data?.verificarAutorizacionExterna

  useEffect(() => {
    if (auth?.vigente && codigo) {
      import('qrcode').then(QR =>
        QR.toDataURL(codigo.toUpperCase(), {
          width: 280, margin: 2, errorCorrectionLevel: 'H',
          color: { dark: '#1e293b', light: '#ffffff' },
        }).then(setQrUrl)
      )
    }
  }, [auth, codigo])

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <Loader2 size={36} className="text-blue-400 animate-spin" />
    </div>
  )

  if (error || !auth) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
        <AlertTriangle size={40} className="text-amber-500 mx-auto mb-3" />
        <p className="font-bold text-slate-800">Código no encontrado</p>
        <p className="text-slate-500 text-sm mt-2">
          La autorización no existe o el código está mal escrito.
        </p>
      </div>
    </div>
  )

  const cfg = ESTADO_CFG[auth.estado] ?? ESTADO_CFG.vencida

  return (
    <>
      {/* QR pantalla completa */}
      {grande && auth.vigente && (
        <div className="fixed inset-0 bg-white z-50 flex items-center justify-center cursor-pointer"
          onClick={() => setGrande(false)}>
          <div className="text-center px-6">
            {qrUrl
              ? <img src={qrUrl} alt="QR" className="mx-auto rounded-2xl shadow-xl" style={{ width: 320, height: 320 }} />
              : <div className="w-80 h-80 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto"><Loader2 className="animate-spin text-slate-400" /></div>
            }
            <p className="mt-5 font-mono font-black text-slate-800 text-xl tracking-widest">{codigo?.toUpperCase()}</p>
            <p className="text-slate-400 text-sm mt-2">Toca para cerrar</p>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">

        {/* Header */}
        <div className="px-4 pt-5 pb-3 flex items-center gap-3 max-w-sm mx-auto">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <Truck size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm">Autorización de Acceso</p>
            <p className="text-slate-400 text-xs">Campus UAGRM</p>
          </div>
        </div>

        <div className="max-w-sm mx-auto px-4 pb-8 space-y-4">

          {/* Badge de estado */}
          <div className="bg-white rounded-2xl shadow-xl p-5 text-center space-y-4">
            <div className="flex items-center justify-center gap-2 font-bold text-sm px-4 py-2.5 rounded-full border-2 mx-auto w-fit"
              style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
              {cfg.icon} {cfg.label}
            </div>

            {/* QR grande — solo si vigente */}
            {auth.vigente && (
              <button onClick={() => setGrande(true)} className="relative group mx-auto block">
                {qrUrl
                  ? <img src={qrUrl} alt="QR acceso" className="rounded-2xl border-4 border-slate-100 shadow-lg mx-auto transition-transform group-hover:scale-105"
                      style={{ width: 220, height: 220 }} />
                  : <div className="w-52 h-52 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto">
                      <Loader2 className="animate-spin text-slate-400" />
                    </div>
                }
                <div className="absolute top-2 right-2 bg-blue-600 text-white text-[9px] font-bold px-2 py-1 rounded-lg flex items-center gap-1 opacity-80 group-hover:opacity-100">
                  <QrCode size={10} /> AMPLIAR
                </div>
              </button>
            )}

            <p className="font-mono font-black text-slate-700 text-lg tracking-[0.25em]">
              {codigo?.toUpperCase()}
            </p>
            {auth.vigente && (
              <p className="text-slate-400 text-xs">Muestra este QR al guardia en portería</p>
            )}
          </div>

          {/* Datos de la autorización */}
          <div className="bg-white rounded-2xl shadow-xl p-5 space-y-3">
            <p className="text-slate-500 text-xs uppercase tracking-widest font-semibold">Detalles</p>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                <Truck size={15} className="text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800">{auth.empresa}</p>
                <p className="text-slate-500 text-xs">Placa: <span className="font-mono font-semibold">{auth.placa}</span></p>
              </div>
            </div>

            {auth.dependenciaNombre && (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                  <Building2 size={15} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-slate-500 text-xs">Destino</p>
                  <p className="font-semibold text-slate-700 text-sm">{auth.dependenciaNombre}</p>
                  {auth.dependenciaUbicacion && (
                    <p className="text-slate-400 text-[11px]">{auth.dependenciaUbicacion}</p>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                <MapPin size={15} className="text-amber-600" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Motivo</p>
                <p className="font-semibold text-slate-700 text-sm">{auth.motivo}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center shrink-0">
                <Clock size={15} className="text-violet-600" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Ventana horaria</p>
                <p className="font-semibold text-slate-700 text-sm">{fmt(auth.validoDesde)}</p>
                <p className="text-slate-400 text-xs">hasta {fmt(auth.validoHasta)}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 text-xs text-slate-400">
              Autorizado por: <span className="font-semibold text-slate-600">{auth.autorizadoPorNombre}</span>
            </div>
          </div>

          {/* Si no está vigente — acción */}
          {!auth.vigente && (
            <div className="bg-slate-800 rounded-2xl p-4 text-center">
              <p className="text-white text-sm font-semibold mb-1">
                {auth.estado === 'pendiente' ? 'Esta autorización aún no está activa' :
                 auth.estado === 'usada' ? 'Esta autorización ya fue utilizada' :
                 auth.estado === 'vencida' ? 'Esta autorización ha vencido' :
                 'Esta autorización fue revocada'}
              </p>
              <p className="text-slate-400 text-xs">Contacta con la dependencia que te autorizó</p>
            </div>
          )}

          <p className="text-center text-slate-600 text-[10px]">
            Sistema de Control Vehicular · Universidad Autónoma Gabriel René Moreno
          </p>
        </div>
      </div>
    </>
  )
}
