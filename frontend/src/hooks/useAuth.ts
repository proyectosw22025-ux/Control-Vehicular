interface UsuarioGuardado {
  id: number
  ci: string
  nombreCompleto: string
  email: string
  isSuperuser: boolean
  roles: { nombre: string }[]
}

export function useAuth() {
  const token = localStorage.getItem('access_token')
  const usuario: UsuarioGuardado = JSON.parse(localStorage.getItem('usuario') || '{}')
  const roles: string[] = usuario.roles?.map(r => r.nombre) ?? []

  const esAdmin = usuario.isSuperuser === true || roles.includes('Administrador')
  const esGuardia = roles.includes('Guardia')
  const esResidente = roles.includes('Residente')

  function tieneRol(...nombres: string[]) {
    return nombres.some(n => roles.includes(n))
  }

  function logout() {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('usuario')
    window.location.href = '/login'
  }

  return {
    isAuthenticated: !!token,
    usuario,
    roles,
    esAdmin,
    esGuardia,
    esResidente,
    tieneRol,
    logout,
  }
}
