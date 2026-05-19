import { useState, useCallback, useRef } from 'react'
import { useApolloClient, gql } from '@apollo/client'

const BUSQUEDA_QUERY = gql`
  query BusquedaGlobal($termino: String!, $limite: Int) {
    busquedaGlobal(termino: $termino, limite: $limite) {
      tipo id titulo subtitulo estado url meta
    }
  }
`

export interface ResultadoBusqueda {
  tipo: 'vehiculo' | 'usuario' | 'multa' | 'visitante'
  id: number
  titulo: string
  subtitulo: string
  estado: string
  url: string
  meta: string
}

export interface GrupoResultados {
  tipo: string
  label: string
  items: ResultadoBusqueda[]
}

const TIPO_LABEL: Record<string, string> = {
  vehiculo:  'Vehículos',
  usuario:   'Usuarios',
  multa:     'Multas',
  visitante: 'Visitantes',
}

function agrupar(resultados: ResultadoBusqueda[]): GrupoResultados[] {
  const mapa: Record<string, ResultadoBusqueda[]> = {}
  for (const r of resultados) {
    if (!mapa[r.tipo]) mapa[r.tipo] = []
    mapa[r.tipo].push(r)
  }
  return Object.entries(mapa).map(([tipo, items]) => ({
    tipo,
    label: TIPO_LABEL[tipo] ?? tipo,
    items,
  }))
}

export function useBusquedaGlobal() {
  const client = useApolloClient()
  const [termino, setTermino]       = useState('')
  const [grupos, setGrupos]         = useState<GrupoResultados[]>([])
  const [cargando, setCargando]     = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const buscar = useCallback((valor: string) => {
    setTermino(valor)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (valor.trim().length < 2) { setGrupos([]); return }

    debounceRef.current = setTimeout(async () => {
      setCargando(true)
      try {
        const { data } = await client.query({
          query: BUSQUEDA_QUERY,
          variables: { termino: valor.trim(), limite: 5 },
          fetchPolicy: 'network-only',
        })
        setGrupos(agrupar(data?.busquedaGlobal ?? []))
      } catch {
        setGrupos([])
      } finally {
        setCargando(false)
      }
    }, 300)
  }, [client])

  const limpiar = useCallback(() => {
    setTermino('')
    setGrupos([])
    setCargando(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const totalResultados = grupos.reduce((s, g) => s + g.items.length, 0)

  return { termino, grupos, cargando, totalResultados, buscar, limpiar }
}
