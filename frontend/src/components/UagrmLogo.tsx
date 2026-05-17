/**
 * Logo institucional UAGRM — Sistema de Control Vehicular
 * SVG inline con escudo universitario estilizado.
 * Colores institucionales: verde oscuro + dorado.
 */

interface Props {
  size?: number
  variant?: 'escudo' | 'texto' | 'completo'
  className?: string
}

// ── Escudo SVG UAGRM estilizado ────────────────────────────────
function Escudo({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 110"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Base del escudo */}
      <path
        d="M10 10 L90 10 L90 70 Q90 100 50 108 Q10 100 10 70 Z"
        fill="#1a4d1a"
        stroke="#c8a832"
        strokeWidth="3"
      />
      {/* Franja horizontal dorada superior */}
      <rect x="10" y="10" width="80" height="18" fill="#c8a832" rx="0" />
      {/* Texto "UAGRM" en la franja dorada */}
      <text
        x="50"
        y="23"
        textAnchor="middle"
        fill="#1a4d1a"
        fontSize="11"
        fontWeight="bold"
        fontFamily="serif"
        letterSpacing="1"
      >
        UAGRM
      </text>
      {/* Libro abierto (símbolo universitario) */}
      <path d="M28 45 L50 40 L72 45 L72 70 Q50 65 50 65 Q50 65 28 70 Z" fill="#c8a832" opacity="0.3"/>
      <path d="M28 45 L50 40 L50 65 L28 70 Z" fill="#c8a832" opacity="0.5"/>
      <path d="M50 40 L72 45 L72 70 L50 65 Z" fill="#c8a832" opacity="0.4"/>
      {/* Línea central del libro */}
      <line x1="50" y1="40" x2="50" y2="65" stroke="#c8a832" strokeWidth="1.5"/>
      {/* Líneas de texto del libro */}
      <line x1="33" y1="51" x2="47" y2="49" stroke="#c8a832" strokeWidth="1" opacity="0.7"/>
      <line x1="33" y1="56" x2="47" y2="54" stroke="#c8a832" strokeWidth="1" opacity="0.7"/>
      <line x1="33" y1="61" x2="47" y2="59" stroke="#c8a832" strokeWidth="1" opacity="0.7"/>
      <line x1="53" y1="49" x2="67" y2="51" stroke="#c8a832" strokeWidth="1" opacity="0.7"/>
      <line x1="53" y1="54" x2="67" y2="56" stroke="#c8a832" strokeWidth="1" opacity="0.7"/>
      <line x1="53" y1="59" x2="67" y2="61" stroke="#c8a832" strokeWidth="1" opacity="0.7"/>
      {/* Laureles en la base */}
      <path d="M20 78 Q25 72 30 76 Q25 80 20 78Z" fill="#c8a832" opacity="0.7"/>
      <path d="M24 83 Q30 77 35 81 Q29 85 24 83Z" fill="#c8a832" opacity="0.7"/>
      <path d="M80 78 Q75 72 70 76 Q75 80 80 78Z" fill="#c8a832" opacity="0.7"/>
      <path d="M76 83 Q70 77 65 81 Q71 85 76 83Z" fill="#c8a832" opacity="0.7"/>
      {/* Año fundación */}
      <text
        x="50"
        y="90"
        textAnchor="middle"
        fill="#c8a832"
        fontSize="7"
        fontFamily="serif"
        opacity="0.9"
      >
        1879
      </text>
    </svg>
  )
}

export function UagrmLogo({ size = 48, variant = 'escudo', className = '' }: Props) {
  if (variant === 'escudo') {
    return <Escudo size={size} />
  }

  if (variant === 'texto') {
    return (
      <div className={`flex flex-col items-center ${className}`}>
        <span className="font-black text-xl tracking-widest text-white" style={{ fontFamily: 'serif' }}>
          UAGRM
        </span>
        <span className="text-[9px] text-white/70 tracking-wide uppercase font-medium">
          Control Vehicular
        </span>
      </div>
    )
  }

  // completo: escudo + texto
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Escudo size={size} />
      <div className="flex flex-col">
        <span className="font-black text-base tracking-wider text-white leading-tight" style={{ fontFamily: 'serif' }}>
          UAGRM
        </span>
        <span className="text-[10px] text-white/70 font-medium leading-tight">
          Control Vehicular
        </span>
      </div>
    </div>
  )
}
