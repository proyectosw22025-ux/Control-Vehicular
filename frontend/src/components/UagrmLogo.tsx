/**
 * Logo institucional UAGRM — Sistema de Control Vehicular
 *
 * Usa la imagen PNG oficial del escudo universitario.
 * Si la imagen no carga, muestra un SVG simplificado como fallback.
 *
 * Para actualizar con el logo real:
 *   1. Sube el escudo a Cloudinary → obtén la URL pública
 *   2. Reemplaza ESCUDO_URL con esa URL
 */

// URL del escudo UAGRM en Cloudinary con transformaciones:
//   e_trim:15  → recorta el fondo blanco uniforme de los bordes
//   f_png      → fuerza PNG con canal alpha (transparencia)
//   q_auto     → calidad automática optimizada
const ESCUDO_URL = 'https://res.cloudinary.com/dhrd5ee5c/image/upload/e_trim:15,f_png,q_auto/uagrm-escudo.png'

interface Props {
  size?: number
  variant?: 'escudo' | 'texto' | 'completo'
  className?: string
}

// ── SVG fallback simplificado con colores UAGRM ────────────────
function EscudoFallback({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="50" cy="50" rx="46" ry="46" fill="#0a2a6e" stroke="#e8951a" strokeWidth="3"/>
      {/* Sol radiante */}
      {[0,30,60,90,120,150,180,210,240,270,300,330].map(a => (
        <line key={a}
          x1="50" y1="50"
          x2={50 + 28 * Math.cos(a * Math.PI / 180)}
          y2={50 + 28 * Math.sin(a * Math.PI / 180)}
          stroke="#e8951a" strokeWidth="1.5" opacity="0.7"/>
      ))}
      {/* Globo */}
      <ellipse cx="50" cy="58" rx="16" ry="16" fill="#4fa3e0" stroke="#1a6fb8" strokeWidth="1"/>
      <ellipse cx="50" cy="58" rx="8" ry="16" fill="none" stroke="#1a6fb8" strokeWidth="0.5"/>
      <line x1="34" y1="58" x2="66" y2="58" stroke="#1a6fb8" strokeWidth="0.5"/>
      {/* Gorro frigio */}
      <path d="M42 22 Q50 8 58 22 Q54 18 50 20 Q46 18 42 22Z" fill="#c0392b"/>
      {/* Banner */}
      <rect x="30" y="24" width="40" height="10" rx="2" fill="#1a6fb8"/>
      <text x="50" y="32" textAnchor="middle" fill="white" fontSize="5" fontWeight="bold">UAGRM</text>
      {/* Texto inferior */}
      <text x="50" y="95" textAnchor="middle" fill="#1a6fb8" fontSize="5.5" fontWeight="bold" letterSpacing="0.5">UAGRM</text>
    </svg>
  )
}

// ── Imagen oficial con fallback ────────────────────────────────
function EscudoImg({ size, className = '' }: { size: number; className?: string }) {
  // El PNG del escudo es 1179×912px (proporción 1.29:1, más ancho que alto).
  // Estrategia: contenedor OVAL con esa misma proporción + objectFit:fill
  // → la imagen se estira para llenar exactamente el óvalo, el overflow:hidden
  //   recorta el fondo blanco de las 4 esquinas.
  const ancho = size * 1.29  // mismo aspect ratio que el PNG
  const alto  = size

  return (
    <div
      className={className}
      style={{
        width: ancho,
        height: alto,
        borderRadius: '50%',
        background: 'linear-gradient(160deg, #061840 0%, #0a2a6e 100%)',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        filter: 'drop-shadow(0 4px 14px rgba(232, 149, 26, 0.5))',
      }}
    >
      <img
        src={ESCUDO_URL}
        alt="Escudo UAGRM"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'fill',  // llena el óvalo exactamente
          display: 'block',
        }}
        onError={(e) => {
          const parent = (e.target as HTMLImageElement).parentElement
          if (parent) {
            parent.innerHTML = `<svg width="${size * 0.92}" height="${size * 0.92}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <ellipse cx="50" cy="50" rx="44" ry="44" fill="#0f3a8c" stroke="#e8951a" stroke-width="3"/>
              <text x="50" y="45" text-anchor="middle" fill="#e8951a" font-size="14" font-weight="bold" font-family="serif">UAGRM</text>
              <text x="50" y="62" text-anchor="middle" fill="white" font-size="7">Ctrl. Vehicular</text>
            </svg>`
          }
        }}
      />
    </div>
  )
}

export function UagrmLogo({ size = 48, variant = 'escudo', className = '' }: Props) {
  if (variant === 'escudo') {
    return <EscudoImg size={size} className={className} />
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
    <div className={`flex items-center gap-2.5 ${className}`}>
      <EscudoImg size={size} className="shrink-0" />
      <div className="flex flex-col leading-tight">
        <span className="font-black text-sm tracking-wider text-white" style={{ fontFamily: 'serif' }}>
          UAGRM
        </span>
        <span className="text-[10px] text-yellow-200/70 font-medium">
          Control Vehicular
        </span>
      </div>
    </div>
  )
}

// ── Paleta de colores institucionales UAGRM ───────────────────
// Exportada para usar en otros componentes
export const UAGRM_COLORS = {
  navyDark:  '#061840',   // fondo profundo
  navy:      '#0a2a6e',   // azul marino principal
  navyMed:   '#0f3a8c',   // azul medio
  gold:      '#e8951a',   // dorado sol
  goldLight: '#f5b81c',   // dorado claro
  blue:      '#1a6fb8',   // azul Santa Cruz
  green:     '#1a5c1a',   // verde laureles
  brown:     '#3d1c02',   // marrón borde
}
