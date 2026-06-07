import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ApolloProvider } from '@apollo/client'
import { client } from './apollo/client'
import PrivateRoute from './components/PrivateRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import PaseVisitante from './pages/PaseVisitante'
import Disponibilidad from './pages/Disponibilidad'
import AutorizacionesExternas from './pages/AutorizacionesExternas'
import VerAutorizacion from './pages/VerAutorizacion'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import Vehiculos from './pages/Vehiculos'
import Parqueos from './pages/Parqueos'
import Acceso from './pages/Acceso'
import Visitantes from './pages/Visitantes'
import Infracciones from './pages/Infracciones'
import Notificaciones from './pages/Notificaciones'
import Perfil from './pages/Perfil'
import Reportes from './pages/Reportes'
import GuardiaDashboard from './pages/GuardiaDashboard'
import HistorialVehiculo from './pages/HistorialVehiculo'
import Auditoria from './pages/Auditoria'
import ParqueoDemo    from './pages/ParqueoDemo'
import RastreoEnVivo  from './pages/RastreoEnVivo'
import MisAccesos     from './pages/MisAccesos'
import MiPaseQR      from './pages/MiPaseQR'

export default function App() {
  return (
    <ApolloProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/visita/:codigo" element={<PaseVisitante />} />
          <Route path="/disponibilidad" element={<Disponibilidad />} />
          <Route path="/autorizacion/:codigo" element={<VerAutorizacion />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="usuarios" element={<PrivateRoute roles={['Administrador']}><Usuarios /></PrivateRoute>} />
            <Route path="vehiculos" element={<Vehiculos />} />
            <Route path="parqueos" element={<Parqueos />} />
            <Route path="acceso" element={<PrivateRoute roles={['Administrador', 'Guardia']}><Acceso /></PrivateRoute>} />
            <Route path="autorizaciones-externas" element={<PrivateRoute roles={['Administrador', 'Guardia']}><AutorizacionesExternas /></PrivateRoute>} />
            <Route path="visitantes" element={<PrivateRoute roles={['Administrador', 'Guardia']}><Visitantes /></PrivateRoute>} />
            <Route path="infracciones" element={<Infracciones />} />
            <Route path="notificaciones" element={<Notificaciones />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path="reportes" element={<PrivateRoute roles={['Administrador']}><Reportes /></PrivateRoute>} />
            <Route path="guardia" element={<PrivateRoute roles={['Administrador', 'Guardia']}><GuardiaDashboard /></PrivateRoute>} />
            <Route path="vehiculos/:vehiculoId/historial" element={<HistorialVehiculo />} />
            <Route path="auditoria" element={<PrivateRoute roles={['Administrador']}><Auditoria /></PrivateRoute>} />
            <Route path="parqueo-demo"   element={<ParqueoDemo />} />
            <Route path="rastreo-en-vivo" element={<RastreoEnVivo />} />
            <Route path="mis-accesos"    element={<MisAccesos />} />
            <Route path="mi-pase-qr"     element={<MiPaseQR />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ApolloProvider>
  )
}
