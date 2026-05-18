/**
 * EmptyState — componente reutilizable con ilustración SVG inline.
 *
 * Reemplaza todos los "texto gris + ícono opaco" del sistema con
 * una ilustración contextual que comunica el estado sin lectura profunda.
 *
 * Uso:
 *   <EmptyState tipo="vehiculos" titulo="Sin vehículos" sub="Registra tu primer vehículo" accion={...} />
 */

interface Props {
  tipo?: 'vehiculos' | 'multas' | 'visitas' | 'parqueo' | 'notificaciones' | 'documentos' | 'acceso' | 'generico'
  titulo: string
  sub?: string
  accion?: { label: string; onClick: () => void }
}

// ── Ilustraciones SVG inline — sin dependencias externas ──────────────────

const SVG_VEHICULO = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <rect x="20" y="55" width="160" height="40" rx="8" fill="#e2e8f0"/>
    <rect x="45" y="30" width="90" height="35" rx="6" fill="#cbd5e1"/>
    <circle cx="55" cy="95" r="14" fill="#94a3b8"/>
    <circle cx="55" cy="95" r="8" fill="#e2e8f0"/>
    <circle cx="145" cy="95" r="14" fill="#94a3b8"/>
    <circle cx="145" cy="95" r="8" fill="#e2e8f0"/>
    <rect x="50" y="35" width="35" height="22" rx="4" fill="#bfdbfe" opacity="0.8"/>
    <rect x="90" y="35" width="35" height="22" rx="4" fill="#bfdbfe" opacity="0.8"/>
    <path d="M30 55 L50 30 L140 30 L165 55" stroke="#94a3b8" strokeWidth="2" fill="none"/>
  </svg>
)

const SVG_MULTA = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <rect x="60" y="20" width="80" height="90" rx="8" fill="#fee2e2"/>
    <rect x="70" y="35" width="60" height="6" rx="3" fill="#fca5a5"/>
    <rect x="70" y="48" width="45" height="6" rx="3" fill="#fca5a5"/>
    <rect x="70" y="61" width="55" height="6" rx="3" fill="#fca5a5"/>
    <circle cx="100" cy="85" r="12" fill="#ef4444"/>
    <text x="100" y="90" textAnchor="middle" fill="white" fontSize="16" fontWeight="bold">✓</text>
  </svg>
)

const SVG_VISITA = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <circle cx="100" cy="45" r="25" fill="#e0f2fe"/>
    <circle cx="100" cy="38" r="12" fill="#7dd3fc"/>
    <path d="M68 90 Q100 70 132 90" fill="#bae6fd"/>
    <path d="M45 100 L80 80 L100 90 L120 80 L155 100" fill="#e0f2fe" stroke="#7dd3fc" strokeWidth="1"/>
  </svg>
)

const SVG_PARQUEO = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <rect x="20" y="20" width="50" height="80" rx="4" fill="#ede9fe"/>
    <rect x="80" y="20" width="50" height="80" rx="4" fill="#ede9fe"/>
    <rect x="140" y="20" width="50" height="80" rx="4" fill="#ede9fe"/>
    <rect x="25" y="55" width="40" height="40" rx="3" fill="#c4b5fd"/>
    <rect x="85" y="55" width="40" height="40" rx="3" fill="#c4b5fd"/>
    <rect x="145" y="25" width="40" height="70" rx="3" fill="#a78bfa" opacity="0.5"/>
    <text x="165" y="68" textAnchor="middle" fill="#7c3aed" fontSize="20">P</text>
  </svg>
)

const SVG_NOTIF = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <path d="M100 20 C70 20 55 40 55 60 L55 80 L45 90 L155 90 L145 80 L145 60 C145 40 130 20 100 20Z" fill="#f1f5f9"/>
    <rect x="85" y="90" width="30" height="10" rx="5" fill="#cbd5e1"/>
    <circle cx="100" cy="20" r="5" fill="#94a3b8"/>
    <circle cx="150" cy="30" r="8" fill="#10b981"/>
    <text x="150" y="35" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">✓</text>
  </svg>
)

const SVG_DOC = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <rect x="65" y="10" width="70" height="95" rx="6" fill="#f0fdf4"/>
    <rect x="65" y="10" width="70" height="95" rx="6" stroke="#86efac" strokeWidth="1.5"/>
    <rect x="75" y="30" width="50" height="5" rx="2.5" fill="#86efac"/>
    <rect x="75" y="42" width="40" height="5" rx="2.5" fill="#86efac"/>
    <rect x="75" y="54" width="45" height="5" rx="2.5" fill="#86efac"/>
    <circle cx="100" cy="78" r="12" fill="#22c55e"/>
    <text x="100" y="83" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">+</text>
  </svg>
)

const SVG_ACCESO = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <rect x="70" y="15" width="60" height="90" rx="6" fill="#fff7ed"/>
    <rect x="70" y="15" width="60" height="90" rx="6" stroke="#fdba74" strokeWidth="1.5"/>
    <rect x="80" y="30" width="40" height="40" rx="4" fill="#fed7aa"/>
    <rect x="85" y="35" width="10" height="10" rx="1" fill="#f97316"/>
    <rect x="100" y="35" width="10" height="10" rx="1" fill="#f97316"/>
    <rect x="85" y="50" width="10" height="10" rx="1" fill="#f97316"/>
    <rect x="100" y="50" width="10" height="10" rx="1" fill="#f97316"/>
    <circle cx="100" cy="82" r="8" fill="#fb923c"/>
  </svg>
)

const SVG_GENERICO = (
  <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-40 h-24">
    <circle cx="100" cy="55" r="40" fill="#f1f5f9"/>
    <circle cx="100" cy="55" r="28" fill="#e2e8f0"/>
    <text x="100" y="65" textAnchor="middle" fill="#94a3b8" fontSize="30">∅</text>
  </svg>
)

const SVGS = {
  vehiculos:      SVG_VEHICULO,
  multas:         SVG_MULTA,
  visitas:        SVG_VISITA,
  parqueo:        SVG_PARQUEO,
  notificaciones: SVG_NOTIF,
  documentos:     SVG_DOC,
  acceso:         SVG_ACCESO,
  generico:       SVG_GENERICO,
}

export function EmptyState({ tipo = 'generico', titulo, sub, accion }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-slide-up">
      <div className="mb-4 opacity-80 animate-float">
        {SVGS[tipo]}
      </div>
      <p className="font-semibold text-slate-700 text-base animate-text-pop-up-l">{titulo}</p>
      {sub && (
        <p className="text-slate-400 text-sm mt-1 max-w-xs">{sub}</p>
      )}
      {accion && (
        <button
          onClick={accion.onClick}
          className="mt-5 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
        >
          {accion.label}
        </button>
      )}
    </div>
  )
}
