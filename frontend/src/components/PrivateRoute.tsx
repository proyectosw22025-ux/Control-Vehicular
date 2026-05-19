import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

interface Props {
  children: React.ReactNode
  roles?: string[]
}

export default function PrivateRoute({ children, roles }: Props) {
  const { isAuthenticated, esAdmin, tieneRol } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (roles && !esAdmin && !tieneRol(...roles)) return <Navigate to="/" replace />
  return <>{children}</>
}
