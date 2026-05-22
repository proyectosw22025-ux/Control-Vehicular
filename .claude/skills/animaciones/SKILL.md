---
name: animaciones
description: Implementa animaciones en el proyecto Control Vehicular UAGRM. Elige automáticamente la librería correcta según el contexto (Framer Motion para UI/transiciones, Three.js solo para el visor 3D de vehículos, CSS/Tailwind para micro-animaciones). Úsalo cuando quieras dar vida a un componente, página o módulo.
allowed-tools: Bash(npm *) Bash(cd frontend *) Bash(npx *) Read Glob Edit Write
arguments: [componente_o_descripcion]
---

# Animaciones — Control Vehicular UAGRM

Eres un experto en UX y animaciones web en React. Tu objetivo es agregar animaciones que **mejoren la experiencia del guardia/estudiante/docente** que usa el sistema diariamente, no animaciones por estética vacía.

## Contexto del proyecto
```
!`ls frontend/src/pages/`
```
```
!`ls frontend/src/components/`
```
```
!`cat frontend/package.json | grep -E "framer|three|gsap|lottie|motion" || echo "Sin librerías de animación instaladas"`
```

---

## DECISIÓN: ¿QUÉ LIBRERÍA USAR?

El usuario quiere animar: **$componente_o_descripcion**

Sigue este árbol de decisión **antes** de escribir código:

```
¿Es una animación de UI (entrada, salida, hover, transición)?
  → Framer Motion

¿Es un modelo 3D de un vehículo o visualización espacial?
  → Three.js + React Three Fiber

¿Es un ícono animado, loading state o ilustración pequeña?
  → Lottie (archivos JSON de animación)

¿Es un efecto visual simple (pulse, spin, fade, slide)?
  → Tailwind CSS custom keyframes (cero dependencias)

¿Es un contador numérico que sube?
  → CSS animation + useEffect (sin dependencias)
```

Explica brevemente cuál elegiste y por qué.

---

## IMPLEMENTACIÓN SEGÚN LIBRERÍA

### CASO A: Framer Motion (el más común en este proyecto)

**Instalar si no está:**
```bash
cd frontend && npm install framer-motion
```

**Patrones listos para usar en este proyecto:**

#### 1. Transición de página (envuelve el contenido principal de cada página)
```tsx
import { motion } from 'framer-motion'

// Al inicio de cualquier página:
<motion.div
  initial={{ opacity: 0, y: 12 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.25, ease: 'easeOut' }}
>
  {/* contenido de la página */}
</motion.div>
```

#### 2. Modal con spring (reemplaza `fixed inset-0` estáticos)
```tsx
import { motion, AnimatePresence } from 'framer-motion'

<AnimatePresence>
  {modalAbierto && (
    <motion.div
      className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1,    opacity: 1, y: 0 }}
        exit={{    scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      >
        {/* contenido del modal */}
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

#### 3. Lista de tarjetas animadas (visitantes, vehículos, multas)
```tsx
import { motion } from 'framer-motion'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } }
}
const item = {
  hidden: { opacity: 0, x: -12 },
  show:   { opacity: 1, x: 0, transition: { duration: 0.2 } }
}

// Envuelve el contenedor:
<motion.div variants={container} initial="hidden" animate="show" className="space-y-2">
  {items.map(i => (
    <motion.div key={i.id} variants={item}>
      {/* tarjeta existente sin cambios */}
    </motion.div>
  ))}
</motion.div>
```

#### 4. Toast notification (entrada desde la derecha)
En `frontend/src/components/ToastContainer.tsx`, reemplaza el div del toast:
```tsx
import { motion, AnimatePresence } from 'framer-motion'

// Dentro del map de toasts:
<motion.div
  key={t.id}
  initial={{ x: 80, opacity: 0 }}
  animate={{ x: 0,  opacity: 1 }}
  exit={{    x: 80, opacity: 0 }}
  transition={{ type: 'spring', stiffness: 280, damping: 22 }}
  className={`${bg} border ...`}
>
```

#### 5. Contador animado para el dashboard (KPIs)
```tsx
import { useEffect, useState } from 'react'

function ContadorAnimado({ valor, duracion = 1200 }: { valor: number; duracion?: number }) {
  const [actual, setActual] = useState(0)
  useEffect(() => {
    let inicio: number
    const animar = (ts: number) => {
      if (!inicio) inicio = ts
      const progreso = Math.min((ts - inicio) / duracion, 1)
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progreso, 3)
      setActual(Math.floor(ease * valor))
      if (progreso < 1) requestAnimationFrame(animar)
    }
    requestAnimationFrame(animar)
  }, [valor, duracion])
  return <span>{actual.toLocaleString('es-BO')}</span>
}
```

#### 6. Badge de notificación con bounce
```tsx
<motion.span
  key={conteo}  // re-anima cuando cambia el número
  initial={{ scale: 0.5 }}
  animate={{ scale: 1 }}
  transition={{ type: 'spring', stiffness: 500, damping: 15 }}
  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white ..."
>
  {conteo}
</motion.span>
```

---

### CASO B: Three.js — Visor 3D de vehículo (caso específico)

**Solo para la página de detalle de vehículo o el módulo de Vehículos.**
Justificación para el jurado: "El sistema identifica visualmente el vehículo con un modelo 3D interactivo para facilitar la verificación del guardia."

**Instalar:**
```bash
cd frontend && npm install three @react-three/fiber @react-three/drei
```

**Componente básico — VehiculoVisor3D:**
```tsx
import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense } from 'react'

// Modelos GLTF gratuitos recomendados:
// - Auto: https://market.pmnd.rs/ (busca "car")
// - Moto: https://sketchfab.com/3d-models?features=downloadable&sort_by=-likeCount&q=motorcycle

function ModeloVehiculo({ tipo }: { tipo: string }) {
  // Por tipo: auto, moto, camioneta, bus, bicicleta
  const rutaModelo = `/models/${tipo.toLowerCase()}.glb`
  const { scene } = useGLTF(rutaModelo)
  return <primitive object={scene} scale={1.5} />
}

export function VehiculoVisor3D({ tipo }: { tipo: string }) {
  return (
    <div className="w-full h-48 rounded-2xl overflow-hidden bg-gradient-to-b from-slate-100 to-slate-200">
      <Canvas camera={{ position: [3, 2, 3], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1} />
        <Suspense fallback={null}>
          <ModeloVehiculo tipo={tipo} />
          <Environment preset="city" />
        </Suspense>
        <OrbitControls
          enablePan={false}
          minDistance={2}
          maxDistance={6}
          autoRotate
          autoRotateSpeed={2}
        />
      </Canvas>
    </div>
  )
}
```

**Dónde integrarlo:** `frontend/src/pages/Vehiculos.tsx` o `HistorialVehiculo.tsx`

---

### CASO C: Tailwind CSS personalizado (micro-animaciones sin dependencias)

Para efectos simples, agrega en `frontend/tailwind.config.js`:

```js
theme: {
  extend: {
    keyframes: {
      'slide-right': {
        '0%':   { transform: 'translateX(60px)', opacity: '0' },
        '100%': { transform: 'translateX(0)',    opacity: '1' },
      },
      'scale-in': {
        '0%':   { transform: 'scale(0.85)', opacity: '0' },
        '100%': { transform: 'scale(1)',    opacity: '1' },
      },
      'fade-up': {
        '0%':   { transform: 'translateY(10px)', opacity: '0' },
        '100%': { transform: 'translateY(0)',     opacity: '1' },
      },
      'count-up': {
        '0%':   { transform: 'translateY(8px)', opacity: '0' },
        '100%': { transform: 'translateY(0)',    opacity: '1' },
      },
    },
    animation: {
      'slide-right': 'slide-right 0.3s ease-out',
      'scale-in':    'scale-in 0.2s ease-out',
      'fade-up':     'fade-up 0.25s ease-out',
      'count-up':    'count-up 0.15s ease-out',
    },
  }
}
```

Uso en cualquier componente: `className="animate-fade-up"` o `className="animate-slide-right"`

---

## VERIFICACIÓN FINAL

Después de implementar:

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | head -10
```

Si hay errores de tipos con Framer Motion, agrega:
```bash
cd frontend && npm install --save-dev @types/three
```

## PRINCIPIOS PARA ESTE PROYECTO

1. **Duración máxima 300ms** — el guardia usa el sistema bajo presión, sin tiempo para animaciones largas
2. **Nunca bloquear interacciones** — las animaciones deben ser `pointer-events: none` si cubren botones
3. **Respetar `prefers-reduced-motion`** — agrega `const shouldAnimate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches`
4. **Animación = comunicación** — cada animación debe comunicar algo (nuevo elemento, éxito, error, cargando), no solo decorar
5. **Consistencia** — si un modal usa spring, todos usan spring. Si las tarjetas tienen stagger, todas las listas tienen stagger.
