import { useState, useEffect } from 'react'
import { Car, DoorOpen, Bell, LayoutDashboard, X, ChevronRight, ChevronLeft, CheckCircle } from 'lucide-react'

const STORAGE_KEY = 'onboarding_completado'

const PASOS = [
  {
    icon: LayoutDashboard,
    color: 'bg-blue-500',
    titulo: '¡Bienvenido al Sistema de Control Vehicular!',
    descripcion:
      'Este sistema te permite gestionar el acceso de vehículos, parqueos, multas y visitantes de forma centralizada y en tiempo real.',
    detalle: 'Desde el Dashboard puedes ver un resumen de toda la actividad del día.',
  },
  {
    icon: Car,
    color: 'bg-emerald-500',
    titulo: 'Gestión de Vehículos',
    descripcion:
      'Registra y administra los vehículos del campus. Cada vehículo recibe un código QR único para control de acceso.',
    detalle:
      'Navega a "Vehículos" en el menú lateral para ver tus vehículos registrados o solicitar el registro de uno nuevo.',
  },
  {
    icon: DoorOpen,
    color: 'bg-orange-500',
    titulo: 'Control de Acceso',
    descripcion:
      'El sistema registra automáticamente cada entrada y salida mediante QR. También puedes generar pases temporales para visitantes.',
    detalle:
      'Los guardias pueden registrar acceso desde el "Panel Guardia" — diseñado para uso rápido en tablets.',
  },
  {
    icon: Bell,
    color: 'bg-violet-500',
    titulo: 'Notificaciones en Tiempo Real',
    descripcion:
      'Recibirás notificaciones instantáneas sobre accesos de tu vehículo, aprobaciones y multas directamente en el sistema.',
    detalle: 'Las alertas aparecen en la esquina inferior derecha y también se guardan en "Notificaciones".',
  },
]

export default function Onboarding() {
  const [visible, setVisible] = useState(false)
  const [paso, setPaso] = useState(0)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true)
    }
  }, [])

  function cerrar() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  const actual = PASOS[paso]
  const Icon = actual.icon
  const esUltimo = paso === PASOS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Barra de progreso */}
        <div className="flex">
          {PASOS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 transition-colors duration-300 ${i <= paso ? actual.color : 'bg-slate-100'}`}
            />
          ))}
        </div>

        {/* Contenido */}
        <div className="p-8">
          <div className="flex items-start justify-between mb-6">
            <div className={`${actual.color} text-white p-3 rounded-2xl`}>
              <Icon size={28} />
            </div>
            <button
              onClick={cerrar}
              className="text-slate-300 hover:text-slate-500 transition-colors"
              title="Cerrar y no mostrar de nuevo"
            >
              <X size={20} />
            </button>
          </div>

          <h2 className="text-xl font-bold text-slate-800 mb-3 leading-tight">{actual.titulo}</h2>
          <p className="text-slate-600 text-sm leading-relaxed mb-4">{actual.descripcion}</p>

          <div className="bg-slate-50 rounded-xl p-4 text-xs text-slate-500 leading-relaxed border border-slate-100">
            {actual.detalle}
          </div>
        </div>

        {/* Pie */}
        <div className="px-8 pb-8 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            Paso {paso + 1} de {PASOS.length}
          </span>

          <div className="flex items-center gap-2">
            {paso > 0 && (
              <button
                onClick={() => setPaso(p => p - 1)}
                className="flex items-center gap-1 text-slate-500 hover:text-slate-700 text-sm px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <ChevronLeft size={15} /> Anterior
              </button>
            )}

            {esUltimo ? (
              <button
                onClick={cerrar}
                className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <CheckCircle size={15} /> Comenzar
              </button>
            ) : (
              <button
                onClick={() => setPaso(p => p + 1)}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Siguiente <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
