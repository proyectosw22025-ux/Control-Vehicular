/**
 * Hook de disponibilidad real de parqueo.
 *
 * Fuente de datos: GraphQL `disponibilidadZonas` con polling cada 15 segundos.
 * Los datos son REALES: se calculan desde EspacioParqueo.estado y SesionParqueo activas.
 *
 * Cuando el backend hace broadcast via WebSocket (sesión abierta/cerrada),
 * el usuario verá el cambio en la próxima poll (máx. 15s de desfase).
 * Para la guía de parqueo, este intervalo es más que suficiente.
 */
import { useState, useEffect } from 'react'
import { useQuery } from '@apollo/client'
import { DISPONIBILIDAD_ZONAS_QUERY } from '../graphql/queries/parqueos'

export interface DisponibilidadZona {
  id:               number
  nombre:           string
  descripcion:      string
  ubicacion:        string
  capacidadTotal:   number
  libres:           number
  sesionesActivas:  number
  enMantenimiento:  number
  porcentajeLibre:  number
  estado:           'disponible' | 'limitado' | 'saturado' | 'lleno' | 'sin_datos'
  colorEstado:      string
}

export interface AlertaSaturacion {
  zonaId:         number
  zonaNombre:     string
  estadoAnterior: string
  estadoNuevo:    string
  libres:         number
  timestamp:      number
}

export function useDisponibilidadZonas() {
  const [zonasPrev, setZonasPrev]   = useState<DisponibilidadZona[]>([])
  const [alertas,   setAlertas]     = useState<AlertaSaturacion[]>([])

  const { data, loading, refetch } = useQuery(DISPONIBILIDAD_ZONAS_QUERY, {
    pollInterval: 15_000,
    fetchPolicy:  'network-only',
    notifyOnNetworkStatusChange: false,
  })

  const zonas: DisponibilidadZona[] = data?.disponibilidadZonas ?? []

  // Detectar cambios de estado entre polls para generar alertas
  useEffect(() => {
    if (!zonas.length || !zonasPrev.length) {
      if (zonas.length) setZonasPrev(zonas)
      return
    }
    const nuevasAlertas: AlertaSaturacion[] = []
    zonas.forEach(z => {
      const prev = zonasPrev.find(p => p.id === z.id)
      if (!prev || prev.estado === z.estado) return
      // Solo alertar cuando empeora (disponible→limitado, limitado→saturado, etc.)
      const orden = ['disponible', 'limitado', 'saturado', 'lleno']
      const idxPrev = orden.indexOf(prev.estado)
      const idxNuevo = orden.indexOf(z.estado)
      if (idxNuevo > idxPrev) {
        nuevasAlertas.push({
          zonaId:         z.id,
          zonaNombre:     z.nombre,
          estadoAnterior: prev.estado,
          estadoNuevo:    z.estado,
          libres:         z.libres,
          timestamp:      Date.now(),
        })
      }
    })
    if (nuevasAlertas.length) {
      setAlertas(prev => [...nuevasAlertas, ...prev].slice(0, 5))
    }
    setZonasPrev(zonas)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zonas])

  const descartarAlerta = (zonaId: number) =>
    setAlertas(a => a.filter(al => al.zonaId !== zonaId))

  return { zonas, loading, alertas, descartarAlerta, refetch }
}
