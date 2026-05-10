import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ApolloProvider } from '@apollo/client'
import { client } from './apollo/client'
import PrivateRoute from './components/PrivateRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import Vehiculos from './pages/Vehiculos'
import Parqueos from './pages/Parqueos'
import Acceso from './pages/Acceso'
import Visitantes from './pages/Visitantes'
import Multas from './pages/Multas'
import Notificaciones from './pages/Notificaciones'
import Perfil from './pages/Perfil'
import Reportes from './pages/Reportes'
import GuardiaDashboard from './pages/GuardiaDashboard'
import HistorialVehiculo from './pages/HistorialVehiculo'
import Auditoria from './pages/Auditoria'

export default function App() {
  return (
    <ApolloProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="usuarios" element={<Usuarios />} />
            <Route path="vehiculos" element={<Vehiculos />} />
            <Route path="parqueos" element={<Parqueos />} />
            <Route path="acceso" element={<Acceso />} />
            <Route path="visitantes" element={<Visitantes />} />
            <Route path="multas" element={<Multas />} />
            <Route path="notificaciones" element={<Notificaciones />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path="reportes" element={<Reportes />} />
            <Route path="guardia" element={<GuardiaDashboard />} />
            <Route path="vehiculos/:vehiculoId/historial" element={<HistorialVehiculo />} />
            <Route path="auditoria" element={<Auditoria />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ApolloProvider>
  )
}
