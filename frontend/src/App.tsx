import { lazy, Suspense } from 'react'
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
import GuardiaDashboard from './pages/GuardiaDashboard'
import HistorialVehiculo from './pages/HistorialVehiculo'
import Auditoria from './pages/Auditoria'
import MisAccesos     from './pages/MisAccesos'
import MiPaseQR      from './pages/MiPaseQR'

// Páginas pesadas (Leaflet/OSRM en mapas, Recharts en reportes): se cargan SOLO
// al abrirlas, en su propio chunk. Antes viajaban en el bundle inicial y todo
// usuario las descargaba aunque solo entrara a ver su QR.
const ParqueoDemo   = lazy(() => import('./pages/ParqueoDemo'))
const RastreoEnVivo = lazy(() => import('./pages/RastreoEnVivo'))
const Reportes      = lazy(() => import('./pages/Reportes'))

function CargandoPagina() {
  return (
    <div className="flex items-center justify-center h-full py-20 text-slate-400 text-sm">
      Cargando…
    </div>
  )
}

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
            <Route path="reportes" element={<PrivateRoute roles={['Administrador']}><Suspense fallback={<CargandoPagina />}><Reportes /></Suspense></PrivateRoute>} />
            <Route path="guardia" element={<PrivateRoute roles={['Administrador', 'Guardia']}><GuardiaDashboard /></PrivateRoute>} />
            <Route path="vehiculos/:vehiculoId/historial" element={<HistorialVehiculo />} />
            <Route path="auditoria" element={<PrivateRoute roles={['Administrador']}><Auditoria /></PrivateRoute>} />
            <Route path="parqueo-demo"   element={<Suspense fallback={<CargandoPagina />}><ParqueoDemo /></Suspense>} />
            <Route path="rastreo-en-vivo" element={<Suspense fallback={<CargandoPagina />}><RastreoEnVivo /></Suspense>} />
            <Route path="mis-accesos"    element={<MisAccesos />} />
            <Route path="mi-pase-qr"     element={<MiPaseQR />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ApolloProvider>
  )
}
