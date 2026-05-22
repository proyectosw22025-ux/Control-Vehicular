# Sistema de Control Vehicular — UAGRM
**Universidad Autónoma "Gabriel René Moreno" · Santa Cruz, Bolivia**

---

## Resumen ejecutivo

Sistema web de gestión y control vehicular universitario diseñado para digitalizar y automatizar el flujo de acceso al campus de la UAGRM. Reemplaza el registro manual en papel con un sistema en tiempo real que integra escaneo QR, lectura de placas por OCR, notificaciones automáticas y guía de estacionamiento interactiva. La plataforma sirve simultáneamente a cuatro roles: Administrador, Guardia, Docente/Estudiante/Personal Administrativo y Visitante externo.

---

## Problema que resuelve

El control de ingreso vehicular en una universidad con miles de vehículos diarios presenta tres problemas concretos: filas en las garitas por registro lento, falta de trazabilidad de accesos y multas, y ausencia de información en tiempo real sobre disponibilidad de estacionamiento. El sistema aborda los tres de forma integral.

---

## Stack tecnológico

| Capa | Tecnología | Uso concreto |
|------|-----------|--------------|
| **Backend** | Django 5.2 + Strawberry GraphQL | API única GraphQL con tipos estrictos y resolvers por rol |
| **Base de datos** | PostgreSQL | Modelos relacionales, migraciones versionadas |
| **Tareas asíncronas** | Celery + Redis | Notificaciones, alertas automáticas, cierre de visitas por timeout |
| **WebSockets** | Django Channels + Redis | Notificaciones en tiempo real, rastreo GPS en vivo |
| **Frontend** | React 18 + TypeScript + Vite | SPA tipada con Apollo Client para consumo GraphQL |
| **UI/UX** | Tailwind CSS | Diseño mobile-first, paleta institucional UAGRM |
| **Mapas** | Leaflet + react-leaflet + OSRM | Mapa real del campus con enrutamiento por calles reales |
| **Autenticación** | JWT + SimpleJWT | Access token + refresh token, renovación automática |
| **OCR** | Tesseract (pytesseract) | Lectura de placas por cámara del guardia |
| **Deploy** | Railway (backend) + Vercel (frontend) | CI/CD automático desde GitHub `master` |
| **Testing** | pytest + fixtures | Suite de tests unitarios e integración para toda la lógica de negocio |

---

## Arquitectura general

```
Navegador / Móvil
       │
       ├── Apollo Client (GraphQL HTTP)
       │        └──► Railway: Django + Strawberry GraphQL
       │                      ├── PostgreSQL (datos)
       │                      ├── Celery + Redis (tareas)
       │                      └── Django Channels (WebSocket)
       │
       └── WebSocket (notificaciones en vivo)
                └──► Django Channels ──► Redis Channel Layer
```

La API GraphQL centraliza toda la lógica en un único endpoint, con validaciones de autenticación y rol en cada resolver. Los permisos siguen el principio de menor privilegio: cada rol accede solo a las operaciones que le corresponden.

---

## Módulos principales

### Control de Acceso
El guardia registra entradas y salidas mediante tres métodos: escaneo de QR dinámico (TOTP — cambia cada 30 segundos), lectura OCR de placa por cámara, o ingreso manual. El sistema aplica una máquina de estados (`entrada → salida → entrada`) que impide duplicados. Incluye modo offline con cola de sincronización y retry con exponential backoff.

### Vehículos y QR
Cada vehículo registrado recibe un QR permanente. El propietario puede generar QRs de delegación temporales (duración configurable, un solo uso, revocables) para autorizar a terceros a ingresar su vehículo. La delegación queda auditada con timestamp y usuario.

### Guía de Estacionamiento
Al ingresar al campus, el propietario recibe una notificación WebSocket con oferta de orientación. Si acepta, se activa un mapa interactivo del campus real UAGRM (coordenadas verificadas) con el vehículo animándose en tiempo real sobre rutas calculadas por OSRM. El sistema asigna automáticamente un espacio libre según el rol del usuario y registra la sesión de parqueo.

### Parqueos
Gestión de zonas, espacios y sesiones de estacionamiento. Cada espacio tiene estado en tiempo real (`disponible / ocupado / reservado`). La sesión se cierra automáticamente al registrar la salida del campus por QR.

### Multas
Flujo completo: registro por guardia → notificación al propietario (WebSocket + email) → pago con comprobante digital → confirmación por administrador → apelación con resolución. El propietario puede ver y gestionar sus multas desde su perfil.

### Visitantes
Registro de visitantes con destino institucional (dependencia UAGRM como la Secretaría de Admisiones o Biblioteca) o personal específico como anfitrión. Incluye registro exprés de un solo paso para alta afluencia, pre-registro público desde `/register` para agilizar la garita, detección de tiempo excesivo en campus con notificación al anfitrión para confirmación de salida, y cierre automático honesto (`tipo_cierre: 'auto'`) que distingue en el historial una salida confirmada de una estimada.

### Notificaciones
Sistema en tiempo real por WebSocket con fallback por email (Resend API). Cada evento relevante (acceso, multa, visita, delegación QR) genera una notificación con metadatos (`datos_extra`) para que el frontend pueda ejecutar acciones contextuales, como navegar directamente al módulo relacionado.

### Rastreo GPS
El propietario puede compartir su ubicación en tiempo real desde el campus. Administradores y guardias ven un mapa con todos los vehículos activos. La posición se transmite por WebSocket y se actualiza cada 3 segundos.

### Dashboard y Auditoría
El administrador accede a estadísticas en tiempo real, historial de auditoría con IP y usuario, gestión de roles y reportes descargables en PDF. Todo cambio sensible (acceso, multa, delegación, resolución de apelación) se registra en `AuditLog`.

---

## Características técnicas destacadas

- **GraphQL con tipado estricto**: Strawberry genera el schema desde las clases Python, eliminando discrepancias entre backend y frontend
- **QR dinámico TOTP**: el código cambia cada 30 segundos — una foto del QR no sirve para entrar al día siguiente
- **Máquina de estados de acceso**: impide entradas duplicadas o salidas sin entrada previa, validada en backend con select atómico
- **Auto-cierre de sesiones**: al registrar salida por QR, el espacio de parqueo se libera automáticamente en el mismo request
- **errorPolicy: 'all' manejado explícitamente**: los errores GraphQL se verifican en `result.errors` antes de mostrar éxito — evita falsos positivos en la UI del guardia
- **Debounce multicapa en scanner**: QrScanner filtra detecciones repetidas del mismo código en < 2 segundos; el hook usa `useRef` síncrono como guard
- **Hooks automáticos de desarrollo**: al editar archivos del backend recuerda correr tests; antes de pushear recuerda verificar deploy

---

## Roles y accesos

| Rol | Acceso principal |
|-----|-----------------|
| **Administrador** | Todo el sistema, reportes, auditoría, gestión de usuarios y roles |
| **Guardia** | Panel de control de acceso, visitantes, multas, parqueos |
| **Estudiante / Docente / Personal** | Sus vehículos, sus multas, su historial de accesos, Mi Pase QR, Guía de Parqueo |
| **Visitante** | Pre-registro público sin cuenta, acceso gestionado por guardia |

---

## Alcance del proyecto

**Punto de partida:** sistema de autenticación básico con registro de vehículos y generación de QR estático. Sin control de acceso, sin parqueos, sin notificaciones, sin roles diferenciados.

**Estado actual:** plataforma integral con diez módulos productivos, desplegada en Railway y Vercel con CI/CD desde GitHub, cobertura de tests en lógica de negocio crítica, notificaciones en tiempo real, OCR de placas, rastreo GPS, guía interactiva de estacionamiento con mapa real del campus y gestión completa del ciclo de vida de visitantes y vehículos.

**Decisiones de diseño con impacto:** API GraphQL única (evita inconsistencias REST), errorPolicy explícita en Apollo (correctitud sobre conveniencia), `tipo_cierre` en visitas (honestidad sobre incertidumbre), máquina de estados en accesos (integridad sobre rendimiento), Framer Motion solo donde agrega información (UX sobre decoración).

---

*Sistema desarrollado como proyecto académico evaluado por iteraciones — UAGRM 2026*
