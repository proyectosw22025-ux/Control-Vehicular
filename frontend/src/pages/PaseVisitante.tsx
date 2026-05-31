/**
 * PaseVisitante — Página pública de verificación de pase de visitante.
 *
 * Accesible sin login: /visita/:codigo
 * El visitante abre esta URL en su celular y muestra la pantalla al guardia.
 * El guardia ve todos los datos del pre-registro y escanea el QR.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@apollo/client'
import { CheckCircle, XCircle, Clock, MapPin, User, QrCode, AlertTriangle, Loader2 } from 'lucide-react'
import { VERIFICAR_PASE_VISITANTE_QUERY } from '../graphql/queries/visitantes'

// Generación de QR usando el paquete qrcode (ya instalado)
async function generarQrUrl(texto: string): Promise<string> {
  try {
    const QRCode = await import('qrcode')
    return await QRCode.toDataURL(texto, {
      width: 280,
      margin: 2,
      color: { dark: '#1e293b', light: '#ffffff' },
      errorCorrectionLevel: 'H',
    })
  } catch {
    return ''
  }
}

type EstadoBadgeProps = { estado: string }
function EstadoBadge({ estado }: EstadoBadgeProps) {
  const cfg: Record<string, { label: string; color: string; icon: JSX.Element }> = {
    vigente:       { label: 'Válido — Puedes ingresar',      color: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: <CheckCircle size={16} /> },
    ya_usado:      { label: 'Ya utilizado',                  color: 'bg-slate-100 text-slate-600 border-slate-300',       icon: <XCircle size={16} /> },
    vencido:       { label: 'Vencido — solicita uno nuevo',  color: 'bg-red-100 text-red-700 border-red-300',             icon: <Clock size={16} /> },
    no_encontrado: { label: 'Código no encontrado',          color: 'bg-amber-100 text-amber-700 border-amber-300',       icon: <AlertTriangle size={16} /> },
  }
  const c = cfg[estado] ?? cfg.no_encontrado
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full border font-semibold text-sm ${c.color}`}>
      {c.icon}{c.label}
    </div>
  )
}

export default function PaseVisitante() {
  const { codigo } = useParams<{ codigo: string }>()
  const [qrUrl, setQrUrl] = useState('')
  const [grande, setGrande] = useState(false)

  const { data, loading, error } = useQuery(VERIFICAR_PASE_VISITANTE_QUERY, {
    variables: { codigo: codigo?.toUpperCase() ?? '' },
    skip: !codigo,
    fetchPolicy: 'network-only',
  })

  const pase = data?.verificarPaseVisitante

  useEffect(() => {
    if (pase?.valido && codigo) {
      generarQrUrl(codigo.toUpperCase()).then(setQrUrl)
    }
  }, [pase, codigo])

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={40} className="text-blue-400 animate-spin mx-auto mb-3" />
        <p className="text-slate-300 text-sm">Verificando pase...</p>
      </div>
    </div>
  )

  if (error || !pase) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
        <AlertTriangle size={40} className="text-amber-500 mx-auto mb-3" />
        <p className="font-bold text-slate-800">Código no reconocido</p>
        <p className="text-slate-500 text-sm mt-2">El pase no existe o el código está mal escrito.</p>
        <Link to="/register" className="mt-4 inline-block text-blue-600 text-sm hover:underline">
          Pre-registrarse para obtener un pase
        </Link>
      </div>
    </div>
  )

  return (
    <>
      {/* Modal pantalla completa del QR */}
      {grande && pase.valido && (
        <div
          className="fixed inset-0 z-50 bg-white flex items-center justify-center cursor-pointer"
          onClick={() => setGrande(false)}
        >
          <div className="text-center px-4">
            {qrUrl && <img src={qrUrl} alt="QR pase visitante" className="mx-auto rounded-2xl shadow-lg" style={{ width: 320, height: 320 }} />}
            <p className="mt-4 font-mono font-black text-slate-800 text-2xl tracking-widest">{codigo?.toUpperCase()}</p>
            <p className="text-slate-400 text-sm mt-2">Toca para cerrar</p>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        {/* Header UAGRM */}
        <div className="px-4 pt-6 pb-4 flex items-center gap-3 max-w-sm mx-auto">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
            <QrCode size={20} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Control Vehicular</p>
            <p className="text-slate-400 text-xs">Universidad Autónoma Gabriel René Moreno</p>
          </div>
        </div>

        <div className="max-w-sm mx-auto px-4 pb-10 space-y-4">

          {/* Estado del pase */}
          <div className="bg-white rounded-2xl shadow-xl p-6 text-center space-y-4">
            <p className="text-slate-500 text-xs uppercase tracking-widest font-semibold">Pase de Visitante</p>

            <EstadoBadge estado={pase.estado} />

            {/* QR — solo si el pase es vigente */}
            {pase.valido && qrUrl && (
              <div className="flex flex-col items-center gap-2">
                <button onClick={() => setGrande(true)} className="relative group">
                  <img
                    src={qrUrl}
                    alt="QR de acceso"
                    className="rounded-xl border-4 border-slate-100 shadow-lg transition-transform group-hover:scale-105"
                    style={{ width: 200, height: 200 }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10 rounded-xl">
                    <span className="text-white text-xs font-semibold bg-black/50 px-2 py-1 rounded">Ampliar</span>
                  </div>
                </button>
                <p className="font-mono font-black text-slate-700 text-xl tracking-[0.3em]">
                  {codigo?.toUpperCase()}
                </p>
                <p className="text-slate-400 text-xs">Muestra este código al guardia en portería</p>
              </div>
            )}

            {/* Código sin QR — para pases usados/vencidos */}
            {!pase.valido && (
              <div className="bg-slate-50 rounded-xl px-4 py-3">
                <p className="font-mono font-black text-slate-400 text-lg tracking-[0.3em]">
                  {codigo?.toUpperCase()}
                </p>
              </div>
            )}
          </div>

          {/* Datos del visitante */}
          <div className="bg-white rounded-2xl shadow-xl p-5 space-y-3">
            <p className="text-slate-500 text-xs uppercase tracking-widest font-semibold">Datos del visitante</p>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
                <User size={16} className="text-blue-600" />
              </div>
              <div>
                <p className="font-bold text-slate-800">{pase.visitanteNombre}</p>
                <p className="text-slate-500 text-xs">CI: {pase.visitanteCi}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                <MapPin size={16} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Destino</p>
                <p className="font-semibold text-slate-700 text-sm">{pase.destino}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                <Clock size={16} className="text-amber-600" />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Válido hasta</p>
                <p className="font-semibold text-slate-700 text-sm">{pase.validoHasta}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Usos</span>
                <span className="font-semibold">{pase.usosActual} / {pase.usosMax}</span>
              </div>
            </div>
          </div>

          {/* Acciones */}
          {!pase.valido && (
            <Link to="/register"
              className="block w-full text-center py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-sm transition-colors shadow-lg">
              Solicitar nuevo pase
            </Link>
          )}

          <p className="text-center text-slate-500 text-xs">
            Sistema de Control Vehicular UAGRM · Solo para uso oficial
          </p>
        </div>
      </div>
    </>
  )
}
