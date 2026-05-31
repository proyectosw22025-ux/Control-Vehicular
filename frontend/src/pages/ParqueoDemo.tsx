/**
 * ParqueoDemo v5 — Campus UAGRM con vehículo realista por tipo.
 *
 * Mejoras v5:
 *   - 8 puntos P verificados en campo (P8 nuevo: -17.7774, -63.1962)
 *   - SVG top-down realista por tipo de vehículo (auto, moto, camioneta, bus, bici)
 *   - Vehículo rota automáticamente en la dirección del movimiento (bearing GPS)
 *   - Línea de ruta SÓLIDA con gradiente de color (sin línea punteada)
 *   - Velocidad calibrada: 100ms/sub-punto → ~30-40 seg cruzar el campus (~15 km/h)
 *   - Icono del vehículo se actualiza al seleccionar el vehículo propio
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation } from '@apollo/client'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Navigation, RotateCcw, CheckCircle2, XCircle, Clock,
  Car, Wifi, Loader2, Settings, MapPin, Save, X,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { ZONAS_QUERY, ESPACIOS_POR_ZONA_QUERY } from '../graphql/queries/parqueos'
import { VEHICULOS_QUERY } from '../graphql/queries/vehiculos'
import { INICIAR_SESION_MUTATION } from '../graphql/mutations/parqueos'
import { useDisponibilidadZonas, type AlertaSaturacion } from '../hooks/useDisponibilidadZonas'

// ── Coordenadas exactas verificadas en campo ──────────────────────────────
const CAMPUS_CENTRO: [number, number] = [-17.775468, -63.196007]

// 8 puntos P reales dentro del contorno UAGRM
const TODOS_LOS_P: [number, number][] = [
  [-17.77301822153669,  -63.19795575180268],   // P1 noroeste
  [-17.77485723307645,  -63.19709744495157],   // P2 central norte
  [-17.775592832410638, -63.19814350638387],   // P3 oeste central
  [-17.776476569253845, -63.197419309978244],  // P4 central sur
  [-17.774959399845905, -63.19565978093347],   // P5 centro este
  [-17.775107541533966, -63.19314923339397],   // P6 noreste Mód.250
  [-17.77716036098754,  -63.1939319724439],    // P7 sur este
  [-17.777404365444593, -63.1961688456745],    // P8 sur central ← NUEVO
]

// Zonas agrupadas (centroides calculados de los 8 puntos):
//   A (noreste): P2, P5, P6
//   B (oeste/central): P1, P3
//   C (sur): P4, P7, P8
const ZONAS_DEFAULT = [
  {
    id: 'A', nombre: 'Zona A', sub: 'Módulo 250 — Noreste',
    // centroide P2+P5+P6
    coords: [-17.77497, -63.19530] as [number,number],
    color: '#3b82f6', libres: 12, total: 40,
    roles: 'Docentes / Administrativos',
  },
  {
    id: 'B', nombre: 'Zona B', sub: 'Estadio / La Poza — Oeste',
    // centroide P1+P3
    coords: [-17.77431, -63.19805] as [number,number],
    color: '#22c55e', libres: 25, total: 80,
    roles: 'Todos los usuarios',
  },
  {
    id: 'C', nombre: 'Zona C', sub: 'Fac. Politécnica — Sur',
    // centroide P4+P7+P8
    coords: [-17.77701, -63.19584] as [number,number],
    color: '#f59e0b', libres: 8, total: 50,
    roles: 'Todos los usuarios',
  },
] as const

// ── Porterías vehiculares reales — coordenadas verificadas en OSM ─────────
// Fuente: Overpass API, barrier=gate, Way perimetral 165843591 UAGRM campus.
const PORTERIAS_UAGRM: { nombre: string; coords: [number,number] }[] = [
  { nombre: 'Portería Este',        coords: [-17.77765, -63.19344] },
  { nombre: 'Portería Sur Central', coords: [-17.77901, -63.19481] },
  { nombre: 'Portería Av. Busch',   coords: [-17.77877, -63.19660] },
]

// ── Perímetro real del campus — 42 nodos OSM, Way 165843591 ───────────────
const CAMPUS_PERIMETER: [number,number][] = [
  [-17.7793098,-63.1932882],[-17.7792576,-63.1933367],[-17.7792003,-63.1933659],
  [-17.7791426,-63.1933734],[-17.7790649,-63.1933689],[-17.7788301,-63.1932993],
  [-17.7785216,-63.1932072],[-17.7780892,-63.1930785],[-17.7780866,-63.1930777],
  [-17.7769272,-63.1927327],[-17.7768874,-63.1927209],[-17.7764950,-63.1926044],
  [-17.7762342,-63.1925265],[-17.7758219,-63.1924038],[-17.7755023,-63.1923071],
  [-17.7750132,-63.1921591],[-17.7751603,-63.1918238],[-17.7752126,-63.1917047],
  [-17.7753018,-63.1912720],[-17.7755238,-63.1910954],[-17.7755550,-63.1910707],
  [-17.7755827,-63.1910486],[-17.7757867,-63.1908186],[-17.7760476,-63.1906757],
  [-17.7764739,-63.1905661],[-17.7764645,-63.1905219],[-17.7765003,-63.1904663],
  [-17.7765677,-63.1905000],[-17.7765847,-63.1905128],[-17.7766889,-63.1905275],
  [-17.7776025,-63.1900856],[-17.7777751,-63.1901146],[-17.7778202,-63.1901222],
  [-17.7778519,-63.1901276],[-17.7792965,-63.1903963],[-17.7793016,-63.1909620],
  [-17.7797533,-63.1910161],[-17.7796485,-63.1914382],[-17.7796401,-63.1914776],
  [-17.7796329,-63.1915201],[-17.7795400,-63.1920671],[-17.7794861,-63.1923533],
]

type Zona = { id:string; nombre:string; sub:string; coords:[number,number]; color:string; libres:number; total:number; roles:string }

// ── SVG top-down realistas por tipo de vehículo ───────────────────────────
// El triángulo amarillo superior indica la dirección de avance.
const VEHICLE_SVG: Record<string, { svg: string; w: number; h: number }> = {
  'Automóvil': {
    w: 28, h: 50,
    svg: `<svg width="28" height="50" viewBox="0 0 28 50" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="sh"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.45"/></filter></defs>
      <g filter="url(#sh)">
        <rect x="3" y="8" width="22" height="34" rx="7" fill="#2563eb"/>
        <rect x="5" y="10" width="18" height="13" rx="4" fill="#93c5fd" opacity="0.85"/>
        <rect x="5" y="29" width="18" height="11" rx="4" fill="#93c5fd" opacity="0.55"/>
        <rect x="0"  y="11" width="4" height="9" rx="2" fill="#111827"/>
        <rect x="24" y="11" width="4" height="9" rx="2" fill="#111827"/>
        <rect x="0"  y="30" width="4" height="9" rx="2" fill="#111827"/>
        <rect x="24" y="30" width="4" height="9" rx="2" fill="#111827"/>
        <line x1="5" y1="24" x2="23" y2="24" stroke="#1d4ed8" stroke-width="1.5" opacity="0.6"/>
      </g>
      <polygon points="14,2 9,9 19,9" fill="#fbbf24" opacity="0.95"/>
    </svg>`,
  },
  'Motocicleta': {
    w: 18, h: 44,
    svg: `<svg width="18" height="44" viewBox="0 0 18 44" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="sh"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4"/></filter></defs>
      <g filter="url(#sh)">
        <ellipse cx="9" cy="7" rx="5" ry="6" fill="#111827"/>
        <rect x="5" y="11" width="8" height="22" rx="4" fill="#7c3aed"/>
        <ellipse cx="9" cy="37" rx="5" ry="6" fill="#111827"/>
        <ellipse cx="9" cy="7"  rx="2.5" ry="3" fill="#374151"/>
        <ellipse cx="9" cy="37" rx="2.5" ry="3" fill="#374151"/>
      </g>
      <polygon points="9,2 6,7 12,7" fill="#fbbf24" opacity="0.95"/>
    </svg>`,
  },
  'Camioneta': {
    w: 32, h: 54,
    svg: `<svg width="32" height="54" viewBox="0 0 32 54" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="sh"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.45"/></filter></defs>
      <g filter="url(#sh)">
        <rect x="2" y="8" width="28" height="38" rx="6" fill="#0891b2"/>
        <rect x="4" y="10" width="24" height="14" rx="4" fill="#a5f3fc" opacity="0.8"/>
        <rect x="4" y="30" width="24" height="12" rx="4" fill="#a5f3fc" opacity="0.45"/>
        <rect x="0"  y="12" width="4" height="11" rx="2" fill="#111827"/>
        <rect x="28" y="12" width="4" height="11" rx="2" fill="#111827"/>
        <rect x="0"  y="33" width="4" height="11" rx="2" fill="#111827"/>
        <rect x="28" y="33" width="4" height="11" rx="2" fill="#111827"/>
        <line x1="4" y1="25" x2="28" y2="25" stroke="#0e7490" stroke-width="1.5" opacity="0.5"/>
      </g>
      <polygon points="16,2 11,9 21,9" fill="#fbbf24" opacity="0.95"/>
    </svg>`,
  },
  'Minibús': {
    w: 36, h: 58,
    svg: `<svg width="36" height="58" viewBox="0 0 36 58" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="sh"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.4"/></filter></defs>
      <g filter="url(#sh)">
        <rect x="2" y="7" width="32" height="44" rx="5" fill="#059669"/>
        <rect x="4" y="9" width="28" height="16" rx="3" fill="#a7f3d0" opacity="0.8"/>
        <rect x="4" y="29" width="28" height="7" rx="2" fill="#a7f3d0" opacity="0.4"/>
        <rect x="4" y="39" width="28" height="7" rx="2" fill="#a7f3d0" opacity="0.4"/>
        <rect x="0"  y="12" width="4" height="12" rx="2" fill="#111827"/>
        <rect x="32" y="12" width="4" height="12" rx="2" fill="#111827"/>
        <rect x="0"  y="38" width="4" height="11" rx="2" fill="#111827"/>
        <rect x="32" y="38" width="4" height="11" rx="2" fill="#111827"/>
      </g>
      <polygon points="18,2 13,8 23,8" fill="#fbbf24" opacity="0.95"/>
    </svg>`,
  },
  'Bicicleta': {
    w: 20, h: 42,
    svg: `<svg width="20" height="42" viewBox="0 0 20 42" xmlns="http://www.w3.org/2000/svg">
      <defs><filter id="sh"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.3"/></filter></defs>
      <g filter="url(#sh)">
        <circle cx="10" cy="6"  r="5" fill="none" stroke="#374151" stroke-width="2"/>
        <rect x="7" y="10" width="6" height="22" rx="3" fill="#dc2626"/>
        <circle cx="10" cy="36" r="5" fill="none" stroke="#374151" stroke-width="2"/>
        <circle cx="10" cy="6"  r="2" fill="#374151"/>
        <circle cx="10" cy="36" r="2" fill="#374151"/>
      </g>
      <polygon points="10,1 7,6 13,6" fill="#fbbf24" opacity="0.95"/>
    </svg>`,
  },
}

function getVehicleSvg(tipoNombre: string) {
  return VEHICLE_SVG[tipoNombre] ?? VEHICLE_SVG['Automóvil']
}

// ── Cálculo de bearing (dirección de movimiento) ──────────────────────────
function calcularBearing(a: [number,number], b: [number,number]): number {
  const toR = (d: number) => d * Math.PI / 180
  const dL  = toR(b[1] - a[1])
  const y   = Math.sin(dL) * Math.cos(toR(b[0]))
  const x   = Math.cos(toR(a[0])) * Math.sin(toR(b[0])) -
              Math.sin(toR(a[0])) * Math.cos(toR(b[0])) * Math.cos(dL)
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
}

// ── Interpolación + OSRM ──────────────────────────────────────────────────
function interpolarRuta(pts: [number,number][], factor = 5): [number,number][] {
  if (pts.length < 2) return pts
  const res: [number,number][] = []
  for (let i = 0; i < pts.length - 1; i++) {
    res.push(pts[i])
    for (let j = 1; j < factor; j++) {
      const t = j / factor
      res.push([pts[i][0] + (pts[i+1][0]-pts[i][0])*t, pts[i][1] + (pts[i+1][1]-pts[i][1])*t])
    }
  }
  res.push(pts[pts.length - 1])
  return res
}

async function obtenerRutaOSRM(
  entrada: [number,number], destino: [number,number],
): Promise<{ puntos: [number,number][]; duracionSeg: number|null; esReal: boolean }> {
  const url = `https://router.project-osrm.org/route/v1/driving/${entrada[1]},${entrada[0]};${destino[1]},${destino[0]}?geometries=geojson&overview=full&steps=false`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) })
    const data = await resp.json()
    const ruta = data?.routes?.[0]
    if (data.code === 'Ok' && ruta?.geometry?.coordinates?.length) {
      return {
        puntos:      interpolarRuta(ruta.geometry.coordinates.map(([lng,lat]:[number,number]) => [lat,lng] as [number,number]), 5),
        duracionSeg: Math.round(ruta.duration),
        esReal:      true,
      }
    }
  } catch { /**/ }
  const base = Array.from({ length: 25 }, (_, i) => [
    entrada[0] + (destino[0]-entrada[0])*i/24,
    entrada[1] + (destino[1]-entrada[1])*i/24,
  ] as [number,number])
  return { puntos: interpolarRuta(base, 5), duracionSeg: null, esReal: false }
}

// ── localStorage ──────────────────────────────────────────────────────────
const LS_KEY = 'uagrm_zonas_coords_v3'  // v3 invalida coords antiguas

function cargarZonas(): Zona[] {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (!saved) return ZONAS_DEFAULT.map(z => ({ ...z }))
    const parsed = JSON.parse(saved) as Record<string,[number,number]>
    return ZONAS_DEFAULT.map(z => ({ ...z, coords: parsed[z.id] ?? z.coords }))
  } catch { return ZONAS_DEFAULT.map(z => ({ ...z })) }
}
function guardarZonas(zonas: Zona[]) {
  const obj: Record<string,[number,number]> = {}
  zonas.forEach(z => { obj[z.id] = z.coords })
  localStorage.setItem(LS_KEY, JSON.stringify(obj))
}

type FlowState = 'bienvenida'|'inicio'|'cargando_ruta'|'en_ruta'|'confirmando'|'parqueado'|'completado'
type ConfigZona = 'A'|'B'|'C'|null

// ── Componente Leaflet ────────────────────────────────────────────────────
function MapaLeaflet({
  zonas, entrada, zonaDestino, flowState, rutaPuntos,
  modoConfig, zonaConfig, tipoVehiculo, porteriaEntrada,
  onZonaClick, onLlegada, onMapClick,
}: {
  zonas: Zona[]; entrada: [number,number]; zonaDestino: Zona|null
  flowState: FlowState; rutaPuntos: [number,number][]
  modoConfig: boolean; zonaConfig: ConfigZona; tipoVehiculo: string
  porteriaEntrada: string
  onZonaClick: (z:Zona) => void; onLlegada: () => void; onMapClick: (lat:number,lng:number)=>void
}) {
  const mapRef      = useRef<any>(null)
  const vehicleRef  = useRef<any>(null)
  const lineaRef    = useRef<any>(null)
  const zonaMarksRef = useRef<Record<string,any>>({})
  const animRef     = useRef<ReturnType<typeof setInterval>|null>(null)
  const divRef      = useRef<HTMLDivElement>(null)

  function crearIconoVehiculo(L: any, tipo: string, bearing = 0) {
    const { svg, w, h } = getVehicleSvg(tipo)
    return L.divIcon({
      html: `<div style="transform:rotate(${bearing}deg);transform-origin:center;width:${w}px;height:${h}px;
                         filter:drop-shadow(0 3px 6px rgba(0,0,0,0.5))">${svg}</div>`,
      className: '', iconSize: [w, h], iconAnchor: [w/2, h/2],
    })
  }

  // ── Init mapa ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const t = setTimeout(() => {
      if (!divRef.current || mapRef.current) return
      import('leaflet').then(L => {
        delete (L.Icon.Default.prototype as any)._getIconUrl
        L.Icon.Default.mergeOptions({
          iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
          iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
          shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
        })
        const map = L.map(divRef.current!, { center: CAMPUS_CENTRO, zoom: 17, zoomControl: true })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap — Campus UAGRM Santa Cruz, Bolivia',
          maxZoom: 19,
        }).addTo(map)
        setTimeout(() => map.invalidateSize(), 250)

        // Perímetro del campus — polígono OSM real (Way 165843591)
        L.polygon(CAMPUS_PERIMETER, {
          color: '#1e40af', weight: 2.5, opacity: 0.7,
          fillColor: '#3b82f6', fillOpacity: 0.06,
          dashArray: '6 4',
        }).addTo(map).bindPopup('<b>Campus UAGRM</b><br>Perímetro oficial OSM · Way 165843591')

        // Porterías vehiculares OSM — marcadores secundarios
        PORTERIAS_UAGRM.forEach(p => {
          const iconP = L.divIcon({
            html: `<div style="background:#1e40af;color:white;border-radius:8px;padding:3px 7px;
                     font-size:10px;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,0.4);
                     border:2px solid white;white-space:nowrap">🚧 ${p.nombre}</div>`,
            className: '', iconSize: [120, 24], iconAnchor: [60, 12],
          })
          L.marker(p.coords, { icon: iconP, zIndexOffset: 400 }).addTo(map)
            .bindPopup(`<b>${p.nombre}</b><br>Portería vehicular UAGRM<br><small>${p.coords[0].toFixed(5)}, ${p.coords[1].toFixed(5)}</small>`)
        })

        // Portería usada — marcador principal destacado
        const nombrePorteria = porteriaEntrada || 'Portería Campus'
        const iconEntrada = L.divIcon({
          html: `<div style="background:#1e40af;color:white;border-radius:50%;width:42px;height:42px;
                   display:flex;align-items:center;justify-content:center;font-size:22px;
                   border:3px solid white;box-shadow:0 4px 14px rgba(0,0,0,0.55)">🚧</div>`,
          className: '', iconSize: [42,42], iconAnchor: [21,21],
        })
        L.marker(entrada, { icon: iconEntrada, zIndexOffset: 800 }).addTo(map)
          .bindPopup(`<b>${nombrePorteria}</b><br>📍 Punto de ingreso al campus<br><small>${entrada[0].toFixed(5)}, ${entrada[1].toFixed(5)}</small>`)

        // 8 puntos P verificados
        TODOS_LOS_P.forEach((coords, i) => {
          const iconP = L.divIcon({
            html: `<div style="background:white;color:#1e40af;border:2px solid #1e40af;border-radius:4px;
                     font-size:10px;font-weight:900;width:22px;height:22px;
                     display:flex;align-items:center;justify-content:center;
                     box-shadow:0 2px 5px rgba(0,0,0,0.3)">P</div>`,
            className: '', iconSize: [22,22], iconAnchor: [11,11],
          })
          L.marker(coords, { icon: iconP, zIndexOffset: 300 }).addTo(map)
            .bindPopup(`<b>Parqueo P${i+1}</b><br><small>${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}</small>`)
        })

        // Vehículo inicial
        vehicleRef.current = L.marker(entrada, {
          icon: crearIconoVehiculo(L, 'Automóvil', 0),
          zIndexOffset: 1000,
        }).addTo(map)

        map.on('click', (e: any) => onMapClick(e.latlng.lat, e.latlng.lng))
        mapRef.current = map
        dibujarZonas(L, map, zonas, zonaMarksRef, onZonaClick)
      })
    }, 80)
    return () => {
      clearTimeout(t)
      if (animRef.current) clearInterval(animRef.current)
      mapRef.current?.remove()
      mapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Actualizar ícono cuando cambia el tipo de vehículo
  useEffect(() => {
    if (!vehicleRef.current || !mapRef.current) return
    import('leaflet').then(L => {
      vehicleRef.current.setIcon(crearIconoVehiculo(L, tipoVehiculo, 0))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoVehiculo])

  // Redibujar zonas
  useEffect(() => {
    if (!mapRef.current) return
    import('leaflet').then(L => {
      Object.values(zonaMarksRef.current).forEach((m: any) => m.remove())
      zonaMarksRef.current = {}
      dibujarZonas(L, mapRef.current, zonas, zonaMarksRef, onZonaClick)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonas])

  // Cursor crosshair en modo config
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.getContainer().style.cursor = (modoConfig && zonaConfig) ? 'crosshair' : ''
  }, [modoConfig, zonaConfig])

  // ── Animar ruta con rotación del vehículo ─────────────────────────────
  useEffect(() => {
    if (!rutaPuntos.length || flowState !== 'en_ruta' || !mapRef.current || !vehicleRef.current) return
    import('leaflet').then(L => {
      if (lineaRef.current)  { lineaRef.current.remove();  lineaRef.current = null }
      if (animRef.current)   { clearInterval(animRef.current); animRef.current = null }

      // Línea SÓLIDA (sin dashArray) — azul/color de zona con opacidad alta
      lineaRef.current = L.polyline(rutaPuntos, {
        color:  zonaDestino?.color ?? '#3b82f6',
        weight: 6,
        opacity: 0.9,
        // Sin dashArray → línea sólida
        lineJoin: 'round',
        lineCap:  'round',
      }).addTo(mapRef.current)

      // Vista de la ruta completa
      if (zonaDestino) {
        mapRef.current.flyToBounds(
          L.latLngBounds([entrada, zonaDestino.coords]),
          { padding: [70, 70], duration: 1.5, maxZoom: 18 }
        )
      }

      let idx = 0
      // 100ms/sub-punto con x5 interpolación:
      // ~60 waypoints OSRM × 5 = 300 sub-puntos × 100ms = 30 segundos (~15 km/h campus)
      animRef.current = setInterval(() => {
        if (idx >= rutaPuntos.length) {
          clearInterval(animRef.current!)
          if (zonaDestino) mapRef.current?.flyTo(zonaDestino.coords, 18, { duration: 1.5 })
          onLlegada()
          return
        }
        vehicleRef.current?.setLatLng(rutaPuntos[idx])

        // Rotar el vehículo en la dirección de movimiento
        const nextIdx = Math.min(idx + 3, rutaPuntos.length - 1)
        if (rutaPuntos[nextIdx]) {
          const bearing = calcularBearing(rutaPuntos[idx], rutaPuntos[nextIdx])
          const el = vehicleRef.current?.getElement()
          if (el) {
            const inner = el.querySelector('div') as HTMLElement | null
            if (inner) inner.style.transform = `rotate(${bearing}deg)`
          }
        }
        idx += 1
      }, 100)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaPuntos, flowState])

  return <div ref={divRef} style={{ position:'absolute', inset:0, minHeight:400 }} />
}

function dibujarZonas(L:any, map:any, zonas:Zona[], ref:React.MutableRefObject<Record<string,any>>, onClick:(z:Zona)=>void) {
  zonas.forEach(zona => {
    const icon = L.divIcon({
      html: `<div style="background:${zona.color};color:white;border-radius:12px;padding:5px 10px;
               font-weight:900;font-size:12px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,0.4);
               white-space:nowrap;border:2px solid rgba(255,255,255,0.9)">
               🅿 Zona ${zona.id} · ${zona.libres} libres</div>`,
      className: '', iconSize: [130,30], iconAnchor: [65,15],
    })
    const m = L.marker(zona.coords, { icon, zIndexOffset: 600 }).addTo(map)
      .on('click', () => onClick(zona))
      .bindPopup(`<b>${zona.nombre}</b><br>${zona.sub}<br><span style="color:green">${zona.libres} libres</span><br><small>${zona.roles}</small>`)
    ref.current[zona.id] = m
  })
}

// ── Componente principal ──────────────────────────────────────────────────
export default function ParqueoDemo() {
  const { esAdmin, usuario } = useAuth()
  const navigate     = useNavigate()
  const [searchParams] = useSearchParams()
  const vehiculoIdParam = searchParams.get('vehiculoId')
  const latParam        = searchParams.get('elat')
  const lngParam        = searchParams.get('elng')
  const porteriaParam   = searchParams.get('porteria') ?? ''

  const [zonas, setZonas]           = useState<Zona[]>(cargarZonas)

  // ── Disponibilidad real desde el backend ──────────────────────────────────
  const { zonas: disponibilidad, alertas, descartarAlerta } = useDisponibilidadZonas()

  // Mapear disponibilidad real a las zonas visuales (A, B, C) por nombre
  useEffect(() => {
    if (!disponibilidad.length) return
    setZonas(prev => prev.map(z => {
      // Buscar la zona en la BD que corresponde a esta zona visual (A, B, C)
      const match = disponibilidad.find(d =>
        d.nombre.toLowerCase().includes(`zona ${z.id.toLowerCase()}`)
      )
      if (!match) return z
      return { ...z, libres: match.libres, total: match.capacidadTotal }
    }))
  }, [disponibilidad])

  // Punto de entrada real — coordenadas de la portería usada según la notificación WebSocket.
  // Fallback: Portería Av. Busch (coordenada OSM verificada, Way 165843591).
  const entrada = useMemo<[number,number]>(() => {
    if (latParam && lngParam) {
      const lat = parseFloat(latParam); const lng = parseFloat(lngParam)
      if (!isNaN(lat) && !isNaN(lng)) return [lat, lng]
    }
    return [-17.77877, -63.19660]
  }, [latParam, lngParam])
  const [zonaRecomendada, setZonaRecomendada] = useState<string | null>(null)
  const [flow, setFlow]             = useState<FlowState>('bienvenida')
  const [zonaDestino, setZonaD]     = useState<Zona|null>(null)
  const [rutaPuntos, setRuta]       = useState<[number,number][]>([])
  const [vehiculoSelId, setVehId]   = useState<number|null>(null)
  const [tipoVehiculo, setTipoV]    = useState('Automóvil')  // sincronizado con el vehículo elegido
  const [segundos, setSegundos]     = useState(0)
  const [horaEntrada, setHoraE]     = useState('')
  const [horaSalida, setHoraS]      = useState('')
  const [msg, setMsg]               = useState('')
  const [tiempoRuta, setTiempoR]    = useState<number|null>(null)

  // Config zonas
  const [modoConfig, setModoConfig] = useState(false)
  const [zonaConfig, setZonaConfig] = useState<ConfigZona>(null)
  const [zonasTmp, setZonasTmp]     = useState<Zona[]>([])
  const [guardado, setGuardado]     = useState(false)

  function entrarConfig() { setModoConfig(true); setZonasTmp(zonas.map(z=>({...z}))); setZonaConfig('A') }
  function salirConfig(guardar: boolean) {
    if (guardar) { guardarZonas(zonasTmp); setZonas(zonasTmp); setGuardado(true); setTimeout(()=>setGuardado(false),3000) }
    setModoConfig(false); setZonaConfig(null)
  }
  const handleMapClick = useCallback((lat:number, lng:number) => {
    if (!modoConfig || !zonaConfig) return
    setZonasTmp(prev => prev.map(z => z.id===zonaConfig ? {...z,coords:[lat,lng] as [number,number]} : z))
    const ids = ['A','B','C']
    const idx = ids.indexOf(zonaConfig)
    setZonaConfig(idx < 2 ? ids[idx+1] as ConfigZona : null)
  }, [modoConfig, zonaConfig])

  // Queries
  const { data: zonasData } = useQuery(ZONAS_QUERY, { variables: { soloActivas: true } })
  // Bug fix: estudiante solo ve SUS propios vehículos, no todos los del sistema
  const { data: vehData }   = useQuery(VEHICULOS_QUERY, {
    variables: { propietarioId: esAdmin ? undefined : usuario.id, estado:'activo', porPagina:50 },
  })
  const { data: espData }   = useQuery(ESPACIOS_POR_ZONA_QUERY, {
    variables: { zonaId: (() => {
      if (!zonaDestino || !zonasData?.zonas?.length) return null
      const z = (zonasData.zonas as any[]).find(z => z.nombre.includes(`Zona ${zonaDestino.id}`))
      return z?.id ?? zonasData.zonas[0]?.id ?? null
    })() },
    skip: !zonaDestino || !zonasData, fetchPolicy: 'network-only',
  })

  const [iniciarSesion, { loading: lSesion }] = useMutation(INICIAR_SESION_MUTATION, {
    onCompleted(d) {
      const s = d.iniciarSesionParqueo
      setFlow('parqueado'); setSegundos(0)
      setMsg(`✅ ${s.placaVehiculo} → #${s.espacio.numero} — ${s.espacio.zona.nombre}`)
    },
    onError(e) { setMsg(`❌ ${e.message}`) },
  })

  const vehiculos  = vehData?.vehiculos?.items ?? []
  const vehSel     = vehiculos.find((v:any) => v.id===vehiculoSelId)

  // Fix 1 — Selección de espacio por categoría del propietario
  // Evita asignar espacio "Docente" a un Estudiante o "Discapacitado" a cualquiera sin permiso.
  const ROLES_CATEGORIA: Record<string, string[]> = {
    'Docente':                 ['Docente', 'General'],
    'Estudiante':              ['Estudiante', 'General'],
    'Personal Administrativo': ['Personal Administrativo', 'General'],
    'Guardia':                 ['General'],
    'Administrador':           ['General', 'Docente', 'Estudiante', 'Personal Administrativo'],
  }
  const rolesOwner = (vehSel?.propietarioRoles ?? []) as string[]
  const categoriasAceptables = rolesOwner.length > 0
    ? [...new Set(rolesOwner.flatMap(r => ROLES_CATEGORIA[r] ?? ['General']))]
    : ['General', 'Estudiante']  // fallback para usuarios sin rol asignado

  const espaciosDisp = (espData?.espaciosPorZona ?? []).filter((e:any) => e.estado === 'disponible')
  const primerEsp =
    // 1. Espacio cuya categoría coincide exactamente con el rol del propietario
    espaciosDisp.find((e:any) => categoriasAceptables.includes(e.categoria?.nombre)) ??
    // 2. Espacio General como fallback seguro
    espaciosDisp.find((e:any) => e.categoria?.nombre === 'General') ??
    // 3. Último recurso: el primero disponible (con aviso en UI)
    espaciosDisp[0]

  const categoriaIncompatible = primerEsp &&
    !categoriasAceptables.includes(primerEsp.categoria?.nombre) &&
    primerEsp.categoria?.nombre !== 'General'

  // Fix 3 — Pre-seleccionar el vehículo escaneado en el QR cuando viene de la notificación
  useEffect(() => {
    if (!vehiculoIdParam || vehiculos.length === 0) return
    const id = parseInt(vehiculoIdParam)
    const v  = vehiculos.find((v:any) => v.id === id)
    if (v) {
      setVehId(id)
      setTipoV(v.tipo?.nombre ?? 'Automóvil')
    }
  }, [vehiculoIdParam, vehiculos])

  // Si llega con vehiculoId en la URL, saltar la bienvenida directo a la guía
  useEffect(() => {
    if (vehiculoIdParam && flow === 'bienvenida') {
      setFlow('inicio')
    }
  }, [vehiculoIdParam, flow])

  // Auto-recomendar la zona más cercana a la portería usada
  useEffect(() => {
    if (!latParam || !lngParam || !zonas.length) return
    const [lat, lng] = [parseFloat(latParam), parseFloat(lngParam)]
    if (isNaN(lat) || isNaN(lng)) return
    const cercana = [...zonas].sort((a, b) =>
      Math.hypot(lat - a.coords[0], lng - a.coords[1]) -
      Math.hypot(lat - b.coords[0], lng - b.coords[1])
    )[0]
    setZonaRecomendada(cercana?.id ?? null)
  }, [latParam, lngParam, zonas])

  useEffect(() => {
    if (flow !== 'parqueado') return
    const t = setInterval(() => setSegundos(s=>s+1), 1000)
    return () => clearInterval(t)
  }, [flow])

  const handleZonaClick = useCallback(async (zona: Zona) => {
    if (modoConfig) return
    if (flow==='confirmando'||flow==='parqueado'||flow==='completado') return
    if (!horaEntrada) setHoraE(new Date().toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'}))
    setZonaD(zona); setFlow('cargando_ruta'); setRuta([]); setTiempoR(null)
    const { puntos, duracionSeg } = await obtenerRutaOSRM(entrada, zona.coords)
    setTiempoR(duracionSeg); setRuta(puntos); setFlow('en_ruta')
  }, [flow, horaEntrada, modoConfig, entrada])

  const handleLlegada = useCallback(() => setFlow('confirmando'), [])

  // Al seleccionar vehículo → actualizar tipo para el icono del mapa
  function handleVehiculoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id  = e.target.value ? parseInt(e.target.value) : null
    setVehId(id)
    const v = vehiculos.find((v:any) => v.id===id)
    setTipoV(v?.tipo?.nombre ?? 'Automóvil')
  }

  function confirmar() {
    if (!vehiculoSelId || !primerEsp) { setMsg('Selecciona tu vehículo'); return }
    iniciarSesion({ variables: { input: { espacioId: primerEsp.id, vehiculoId: vehiculoSelId } } })
  }
  function simularSalida() {
    setHoraS(new Date().toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'}))
    setFlow('completado')
  }
  function reiniciar() {
    setFlow('bienvenida'); setZonaD(null); setRuta([]); setVehId(null)
    setSegundos(0); setHoraE(''); setHoraS(''); setMsg(''); setTiempoR(null); setTipoV('Automóvil')
  }

  const min=Math.floor(segundos/60), sec=segundos%60
  const zonasActivas = modoConfig ? zonasTmp : zonas

  // Badge de disponibilidad para mostrar en la lista de zonas
  function estadoBadge(zonaId: string) {
    const match = disponibilidad.find(d =>
      d.nombre.toLowerCase().includes(`zona ${zonaId.toLowerCase()}`)
    )
    if (!match) return null
    const labels: Record<string, string> = {
      disponible: 'Disponible', limitado: 'Limitado',
      saturado: 'Saturado', lleno: 'Sin espacio', sin_datos: '—',
    }
    return (
      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white"
        style={{ background: match.colorEstado }}>
        {labels[match.estado] ?? match.estado}
      </span>
    )
  }

  return (
    <div className="flex flex-col bg-slate-900 overflow-hidden" style={{height:'100%'}}>

      {/* Toasts de saturación */}
      {alertas.map((al: AlertaSaturacion) => (
        <div key={al.zonaId}
          className="fixed top-4 right-4 z-[2000] bg-white border-l-4 rounded-xl shadow-2xl p-4 flex gap-3 items-start max-w-sm animate-pulse"
          style={{ borderColor: al.estadoNuevo === 'lleno' ? '#ef4444' : '#f97316' }}>
          <span className="text-xl shrink-0">
            {al.estadoNuevo === 'lleno' ? '🔴' : '🟠'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-800 text-sm">
              {al.zonaNombre} — {al.estadoNuevo === 'lleno' ? 'Sin espacio' : 'Capacidad crítica'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {al.estadoNuevo === 'lleno'
                ? 'No hay espacios disponibles en esta zona'
                : `Solo ${al.libres} espacio${al.libres !== 1 ? 's' : ''} libre${al.libres !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button onClick={() => descartarAlerta(al.zonaId)}
            className="text-slate-400 hover:text-slate-700 shrink-0 mt-0.5">
            <X size={14} />
          </button>
        </div>
      ))}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{background:'linear-gradient(90deg,#061840 0%,#0a2a6e 100%)'}}>
        <div className="flex items-center gap-3">
          <div className="bg-orange-500 p-2 rounded-xl"><Navigation size={18}/></div>
          <div>
            <h1 className="font-bold text-white text-sm">Guía de Parqueo — Campus UAGRM</h1>
            <p className="text-blue-300 text-xs flex items-center gap-2">
              <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse">DEMO</span>
              <Wifi size={10}/> OSM + OSRM · 8 puntos P verificados · Santa Cruz, Bolivia
            </p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {guardado && <span className="text-xs text-emerald-400">✓ Guardado</span>}
          {!modoConfig && esAdmin && (
            <button onClick={entrarConfig}
              className="flex items-center gap-1 text-xs text-amber-300 hover:text-white border border-amber-600 px-3 py-1.5 rounded-lg">
              <Settings size={12}/> Configurar
            </button>
          )}
          <button onClick={()=>navigate('/parqueos')} className="text-xs text-blue-300 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg">Parqueos →</button>
          <button onClick={reiniciar} className="flex items-center gap-1 text-xs text-blue-200 hover:text-white border border-blue-600 px-3 py-1.5 rounded-lg">
            <RotateCcw size={12}/> Reiniciar
          </button>
        </div>
      </div>

      <div className="flex overflow-hidden" style={{flex:1}}>
        {/* Panel */}
        <div className="w-72 shrink-0 bg-white overflow-y-auto border-r border-slate-200 p-4 space-y-3">

          {modoConfig ? (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4">
                <p className="font-bold text-amber-800 text-sm flex items-center gap-2"><Settings size={14}/>Configurar Zonas</p>
                <p className="text-xs text-amber-700 mt-1">Toca el mapa donde está cada P del campus.</p>
              </div>
              {(['A','B','C'] as const).map(id => {
                const z = zonasTmp.find(z=>z.id===id)!
                const activa = zonaConfig===id
                return (
                  <button key={id} onClick={()=>setZonaConfig(id)}
                    className={`w-full text-left rounded-xl p-3 border-2 transition-all ${activa?'shadow-md':'border-slate-200'}`}
                    style={{borderColor:activa?z.color:undefined,background:activa?z.color+'15':undefined}}>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0" style={{background:z.color}}>{id}</div>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-800 text-xs">{z.nombre}</p>
                        <p className="text-[10px] text-slate-500">{activa?'👆 Toca en el mapa':z.coords.map(c=>c.toFixed(4)).join(', ')}</p>
                      </div>
                      {activa && <span className="text-[10px] bg-amber-400 text-white px-1.5 py-0.5 rounded-full font-bold">ACTIVA</span>}
                    </div>
                  </button>
                )
              })}
              <div className="flex gap-2">
                <button onClick={()=>salirConfig(false)} className="flex-1 flex items-center justify-center gap-1 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm"><X size={12}/>Cancelar</button>
                <button onClick={()=>salirConfig(true)} className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm"><Save size={12}/>Guardar</button>
              </div>
            </div>
          ) : (
            <>
              {/* ── BIENVENIDA ── */}
              {flow === 'bienvenida' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-blue-50 to-violet-50 border border-blue-200 rounded-2xl p-5 text-center">
                    <div className="text-4xl mb-2">🏫</div>
                    <p className="font-black text-slate-800 text-base">¡Bienvenido al campus UAGRM!</p>
                    <p className="text-slate-500 text-xs mt-1">Tu ingreso fue registrado exitosamente</p>
                    <div className="mt-3 bg-white/80 rounded-xl px-3 py-2 text-xs border border-slate-200">
                      <p className="font-semibold text-slate-700">{usuario?.nombreCompleto ?? 'Estudiante'}</p>
                      <p className="text-slate-400">{new Date().toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'})}</p>
                    </div>
                    {porteriaParam && (
                      <div className="mt-2 flex items-center justify-center gap-1.5 bg-blue-50 border border-blue-200 rounded-xl px-3 py-1.5 text-xs">
                        <span>🚧</span>
                        <span className="text-blue-700 font-semibold">{decodeURIComponent(porteriaParam)}</span>
                      </div>
                    )}
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                    <p className="font-bold text-amber-800 text-sm mb-1">🅿 ¿Necesitas orientación para encontrar estacionamiento?</p>
                    <p className="text-xs text-amber-700">El sistema puede guiarte a una zona disponible</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setFlow('inicio')}
                      className="flex flex-col items-center gap-1.5 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-bold text-sm transition-colors shadow-lg">
                      <span className="text-2xl">✅</span>
                      Sí, guíame
                    </button>
                    <button onClick={() => window.history.back()}
                      className="flex flex-col items-center gap-1.5 py-4 border-2 border-slate-200 text-slate-600 rounded-2xl font-medium text-sm hover:bg-slate-50 transition-colors">
                      <span className="text-2xl">🚗</span>
                      No, gracias
                    </button>
                  </div>
                  <p className="text-center text-[10px] text-slate-400">
                    Si eliges "No", el guardia confirmará tu parqueo al llegar
                  </p>
                </div>
              )}

              {/* ── ESTADO (para todos los pasos excepto bienvenida) ── */}
              {flow !== 'bienvenida' && (
              <div className={`rounded-2xl p-3 text-xs border ${flow==='parqueado'?'bg-emerald-50 border-emerald-300':flow==='confirmando'?'bg-amber-50 border-amber-300':flow==='en_ruta'?'bg-blue-50 border-blue-300':flow==='cargando_ruta'?'bg-slate-50 border-slate-200':'bg-violet-50 border-violet-200'}`}>
                <p className="font-bold text-sm mb-0.5">
                  {flow==='inicio'&&'🅿 Elige una zona en el mapa'}
                  {flow==='cargando_ruta'&&'🗺 Calculando ruta real...'}
                  {flow==='en_ruta'&&`🚗 Navegando · ${tipoVehiculo}`}
                  {flow==='confirmando'&&'📍 ¡Llegaste!'}
                  {flow==='parqueado'&&`✅ Parqueado — ${tipoVehiculo}`}
                  {flow==='completado'&&'🏁 Demo completado'}
                </p>
                {horaEntrada&&<p className="text-slate-500">Entrada: {horaEntrada}</p>}
                {zonaDestino&&<p className="text-slate-600">→ {zonaDestino.nombre}</p>}
                {flow==='en_ruta'&&tiempoRuta&&<p className="text-blue-600 font-medium">⏱ ~{Math.ceil(tiempoRuta/60)} min estimado (OSRM)</p>}
                {flow==='parqueado'&&<p className="font-mono text-orange-500 font-bold text-base mt-1">⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}</p>}
              </div>
              )}

              {flow==='cargando_ruta'&&(
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <Loader2 size={18} className="text-blue-500 animate-spin shrink-0"/>
                  <p className="text-sm text-blue-700">Calculando ruta por calles reales...</p>
                </div>
              )}

              {(flow==='inicio'||flow==='en_ruta')&&(
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Zonas del campus</p>
                    {porteriaParam && zonaRecomendada && (
                      <span className="text-[10px] text-blue-600 font-semibold">📍 Desde {decodeURIComponent(porteriaParam)}</span>
                    )}
                  </div>
                  {zonas.map(zona => {
                    const disp = disponibilidad.find(d =>
                      d.nombre.toLowerCase().includes(`zona ${zona.id.toLowerCase()}`)
                    )
                    const estaLlena = disp?.estado === 'lleno'
                    return (
                    <button key={zona.id}
                      onClick={() => !estaLlena && handleZonaClick(zona)}
                      disabled={estaLlena}
                      className={`w-full text-left rounded-xl border-2 p-3 transition-all
                        ${estaLlena ? 'opacity-50 cursor-not-allowed border-red-200 bg-red-50' :
                          zonaDestino?.id===zona.id ? 'shadow-md hover:shadow-md' : 'border-slate-200 hover:shadow-md'}`}
                      style={{borderColor: estaLlena ? '#fca5a5' : zonaDestino?.id===zona.id ? zona.color : undefined}}>
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0"
                          style={{background: estaLlena ? '#ef4444' : zona.color}}>
                          {zona.id}
                        </div>
                        <span className="font-semibold text-slate-800 text-sm">{zona.nombre}</span>
                        {zonaRecomendada === zona.id && !estaLlena && (
                          <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-bold">⭐ Cercana</span>
                        )}
                        {estadoBadge(zona.id)}
                        <span className="ml-auto text-xs font-bold"
                          style={{color: disp ? disp.colorEstado : zona.color}}>
                          {estaLlena ? '🔴 Llena' : `${zona.libres} libres`}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 pl-8">{zona.sub}</p>
                      {disp && !estaLlena && (
                        <div className="pl-8 mt-1">
                          <div className="w-full bg-slate-200 rounded-full h-1">
                            <div className="h-1 rounded-full transition-all duration-500"
                              style={{
                                width: `${100 - disp.porcentajeLibre}%`,
                                background: disp.colorEstado,
                              }} />
                          </div>
                        </div>
                      )}
                    </button>
                    )
                  })}
                  {flow==='inicio'&&(
                    <button onClick={()=>handleZonaClick(zonas[1])}
                      className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl text-sm mt-1">
                      🏫 Simular entrada — Av. Busch
                    </button>
                  )}
                </div>
              )}

              {flow==='confirmando'&&zonaDestino&&(
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 text-center">
                    <p className="text-2xl mb-1">📍</p>
                    <p className="font-bold text-amber-800">¡Llegaste a Zona {zonaDestino.id}!</p>
                    <p className="text-xs text-amber-600">{zonaDestino.sub}</p>
                  </div>
                  {vehiculoIdParam ? (
                    // ── VEHÍCULO BLOQUEADO — viene del escaneo QR en portería ──
                    // No se puede cambiar: el parqueo debe registrarse para el vehículo
                    // que realmente ingresó al campus, no para otro del mismo propietario.
                    <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-slate-400 text-xs">🔒</span>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Vehículo que ingresó al campus</span>
                      </div>
                      {vehSel ? (
                        <div className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-slate-200">
                          <div dangerouslySetInnerHTML={{ __html: getVehicleSvg(tipoVehiculo).svg }}
                            style={{ width: getVehicleSvg(tipoVehiculo).w, height: getVehicleSvg(tipoVehiculo).h, flexShrink: 0 }} />
                          <div className="flex-1 min-w-0">
                            <p className="font-mono font-black text-slate-800">{vehSel.placa}</p>
                            <p className="text-xs text-slate-500">{vehSel.tipo?.nombre} — {vehSel.marca} {vehSel.modelo}</p>
                          </div>
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                            En campus
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">Cargando vehículo...</p>
                      )}
                      <p className="text-[10px] text-slate-400 mt-2">
                        Solo puedes registrar el parqueo del vehículo con el que ingresaste.
                        El guardia escaneó este QR en la portería.
                      </p>
                    </div>
                  ) : (
                    // ── VEHÍCULO LIBRE — flujo manual desde el sidebar (sin QR) ──
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Tu vehículo</label>
                      <select value={vehiculoSelId??''} onChange={handleVehiculoChange}
                        className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                        <option value="">Seleccionar...</option>
                        {vehiculos.map((v:any)=>(
                          <option key={v.id} value={v.id}>
                            {v.placa} · {v.tipo?.nombre} — {v.marca} {v.modelo}
                          </option>
                        ))}
                      </select>
                      {vehiculoSelId && (
                        <div className="flex items-center gap-2 mt-2 bg-slate-50 rounded-xl px-3 py-2">
                          <div dangerouslySetInnerHTML={{ __html: getVehicleSvg(tipoVehiculo).svg }}
                            style={{ width: getVehicleSvg(tipoVehiculo).w, height: getVehicleSvg(tipoVehiculo).h, flexShrink: 0 }} />
                          <div>
                            <p className="text-xs font-semibold text-slate-700">{vehSel?.tipo?.nombre ?? tipoVehiculo}</p>
                            <p className="text-[10px] text-slate-500">El mapa muestra este ícono</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {primerEsp ? (
                    <div className={`rounded-xl p-2.5 text-xs border ${categoriaIncompatible ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                      <p className="font-semibold">
                        {categoriaIncompatible ? '⚠ ' : ''}Espacio: <strong>#{primerEsp.numero}</strong> · {primerEsp.zona?.nombre}
                      </p>
                      <p className="text-[10px] opacity-80">
                        Categoría: {primerEsp.categoria?.nombre}
                        {categoriaIncompatible && ' — No es la categoría de tu rol, pero es el único disponible'}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-2 text-xs text-red-600">Sin espacios disponibles en esta zona</div>
                  )}
                  {msg&&<div className={`rounded-xl p-2 text-xs ${msg.startsWith('✅')?'bg-emerald-50 text-emerald-700':'bg-red-50 text-red-700'}`}>{msg}</div>}
                  <div className="flex gap-2">
                    <button onClick={()=>{setZonaD(null);setRuta([]);setFlow('en_ruta')}}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 border-2 border-slate-200 text-slate-600 rounded-xl text-sm">
                      <XCircle size={13}/>Cambiar zona
                    </button>
                    <button onClick={confirmar} disabled={lSesion||!vehiculoSelId||!primerEsp}
                      className="flex-1 flex items-center justify-center gap-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold text-sm disabled:opacity-40">
                      {lSesion?<Loader2 size={13} className="animate-spin"/>:<CheckCircle2 size={13}/>}Confirmar
                    </button>
                  </div>
                </div>
              )}

              {flow==='parqueado'&&(
                <div className="space-y-3">
                  <div className="bg-slate-800 text-white rounded-2xl p-4">
                    <p className="font-mono font-black text-xl">{vehSel?.placa??'—'}</p>
                    <p className="text-slate-300 text-sm">{tipoVehiculo} · {zonaDestino?.nombre}</p>
                    <p className="font-mono text-orange-400 font-bold text-lg mt-2">⏱ {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}</p>
                  </div>
                  {msg&&<div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 text-xs text-emerald-700">{msg}</div>}
                  <button onClick={()=>navigate('/parqueos')} className="w-full py-3 bg-violet-500 hover:bg-violet-600 text-white rounded-xl font-bold text-sm">Ver en Parqueos →</button>
                  <button onClick={simularSalida} className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm">
                    <Car size={13}/>Simular salida
                  </button>
                </div>
              )}

              {flow==='completado'&&(
                <div className="space-y-3">
                  <div className="text-center py-4"><p className="text-4xl">✅</p><p className="font-bold text-slate-800 mt-1">Demo completado</p></div>
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 space-y-1.5 text-sm">
                    {[['Vehículo',vehSel?.placa,'font-mono font-bold'],['Tipo',tipoVehiculo,''],['Zona',zonaDestino?.nombre,''],['Entrada',horaEntrada,'text-emerald-600'],['Salida',horaSalida,'text-red-500'],['Tiempo',`${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')} min`,'text-orange-500 font-bold']].map(([k,v,cls])=>(
                      <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className={String(cls??'')}>{String(v??'—')}</span></div>
                    ))}
                  </div>
                  <button onClick={reiniciar} className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm">
                    <RotateCcw size={13}/>Repetir demo
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mapa */}
        <div className="relative" style={{flex:1}}>
          <MapaLeaflet
            zonas={zonasActivas} entrada={entrada} zonaDestino={zonaDestino}
            flowState={flow} rutaPuntos={rutaPuntos}
            modoConfig={modoConfig} zonaConfig={zonaConfig} tipoVehiculo={tipoVehiculo}
            porteriaEntrada={decodeURIComponent(porteriaParam)}
            onZonaClick={handleZonaClick} onLlegada={handleLlegada} onMapClick={handleMapClick}
          />
          {modoConfig&&zonaConfig&&(
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-amber-500 text-white rounded-xl px-4 py-2 text-sm font-bold shadow-lg flex items-center gap-2">
              <MapPin size={14} className="animate-bounce"/>Toca donde está la Zona {zonaConfig} en el campus
            </div>
          )}
          {flow==='cargando_ruta'&&(
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-white/95 rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <Loader2 size={13} className="animate-spin text-blue-500"/>Calculando ruta OSRM...
            </div>
          )}
          {flow==='en_ruta'&&zonaDestino&&(
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000]
              bg-blue-700/90 text-white rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <Navigation size={13} className="animate-pulse"/>
              Zona {zonaDestino.id} {tiempoRuta&&`· ~${Math.ceil(tiempoRuta/60)} min`}
            </div>
          )}
          {flow==='parqueado'&&(
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000]
              bg-emerald-700/90 text-white rounded-xl px-4 py-2 flex items-center gap-2 text-sm shadow-lg">
              <CheckCircle2 size={13}/>Zona {zonaDestino?.id} · {String(min).padStart(2,'0')}:{String(sec).padStart(2,'0')}
            </div>
          )}
          {flow==='inicio'&&(
            <div className="absolute top-3 left-3 z-[1000] bg-white/90 rounded-xl px-3 py-2 text-xs shadow-md border border-slate-200 max-w-[230px]">
              <p className="font-semibold">🗺 Campus UAGRM · 8 zonas P verificadas</p>
              <p className="text-slate-500 mt-0.5">Toca 🅿 o una zona para navegar</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
