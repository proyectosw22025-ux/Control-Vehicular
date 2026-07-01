# Informe del Proyecto — Sistema de Control Vehicular UAGRM

**Universidad Autónoma Gabriel René Moreno (UAGRM)**
Facultad de Ingeniería en Ciencias de la Computación y Telecomunicaciones

**Materia:** Ingeniería de Software II
**Proyecto:** Sistema de Control Vehicular
**Fecha:** _____________
**Integrantes:** _____________

---

## Índice

1. [Introducción](#1-introducción)
2. [Objetivos](#2-objetivos)
3. [Alcance del sistema](#3-alcance-del-sistema)
4. [Arquitectura del sistema](#4-arquitectura-del-sistema)
5. [Módulos funcionales](#5-módulos-funcionales)
6. [Tecnologías utilizadas](#6-tecnologías-utilizadas)
7. [Modelo de datos](#7-modelo-de-datos)
8. [Seguridad](#8-seguridad)
9. [Despliegue](#9-despliegue)
10. [Conclusiones](#10-conclusiones)

---

## 1. Introducción

El **Sistema de Control Vehicular UAGRM** es una aplicación web desarrollada para
gestionar de forma integral el ingreso, permanencia y salida de vehículos en el
campus universitario. El sistema atiende una necesidad concreta de la
universidad: **controlar el acceso vehicular de manera ágil y segura**, evitando
la formación de colas en las porterías y manteniendo un registro trazable de
cada movimiento.

El proyecto reemplaza los controles manuales tradicionales (planillas en papel,
revisión visual del guardia) por un sistema digital que combina credenciales
dinámicas (códigos QR que rotan cada 30 segundos), reconocimiento de placas por
visión artificial, orientación de parqueo en tiempo real y un módulo completo de
gestión de visitantes y proveedores externos.

## 2. Objetivos

### Objetivo general

Desarrollar un sistema informático que permita **controlar y gestionar el acceso
vehicular** al campus de la UAGRM, garantizando fluidez en las porterías,
seguridad en la identificación de vehículos y trazabilidad completa de los
accesos.

### Objetivos específicos

- Registrar y administrar los vehículos de la comunidad universitaria
  (estudiantes, docentes y administrativos) y sus propietarios.
- Controlar el ingreso y salida de vehículos mediante credenciales digitales
  seguras (QR dinámico TOTP), evitando la reutilización fraudulenta.
- Reducir la formación de colas en las porterías en horarios de alta afluencia.
- Gestionar el acceso de visitantes y proveedores externos con pre-registro,
  autorizaciones y control por tiempo.
- Administrar las zonas y espacios de parqueo, con orientación en tiempo real a
  los conductores.
- Registrar infracciones y sus sanciones, con un flujo de pago y apelación.
- Proveer trazabilidad y auditoría de todas las operaciones sensibles.
- Notificar en tiempo real a los usuarios sobre eventos relevantes de sus
  vehículos.

## 3. Alcance del sistema

El sistema abarca el ciclo completo del control vehicular:

- **Gestión de usuarios y roles** con permisos diferenciados (administrador,
  guardia, docente, estudiante, administrativo).
- **Registro de vehículos** con documentación (SOAT, revisión técnica) y control
  de vencimientos.
- **Control de acceso** por múltiples vías: QR dinámico, delegación a terceros,
  pases temporales, autorizaciones externas y registro manual.
- **Gestión de parqueos** con zonas, espacios, categorías y sesiones de
  ocupación.
- **Gestión de visitantes** con pre-registro sin autenticación, registro exprés
  y control de anfitrión/dependencia.
- **Infracciones y sanciones** con distintos tipos de consecuencia (amonestación,
  multa económica, suspensión de acceso, reporte a Bienestar).
- **Notificaciones** en tiempo real (WebSocket), correo electrónico y WhatsApp.
- **Reportes y estadísticas** de ocupación, accesos y sanciones.
- **Auditoría** de todas las operaciones.

## 4. Arquitectura del sistema

El sistema sigue una arquitectura **cliente-servidor desacoplada** de tres capas:

```
┌────────────────────┐      GraphQL / WebSocket      ┌────────────────────┐
│     FRONTEND       │  ◄──────────────────────────► │      BACKEND       │
│  React + TypeScript│         (HTTP / WSS)          │  Django + GraphQL  │
│   (SPA - Vite)     │                               │   (ASGI/Daphne)    │
└────────────────────┘                               └─────────┬──────────┘
                                                               │
                              ┌────────────────────────────────┼───────────────────┐
                              │                                 │                   │
                        ┌─────▼─────┐                    ┌──────▼──────┐     ┌──────▼──────┐
                        │PostgreSQL │                    │    Redis    │     │   Celery    │
                        │(datos)    │                    │(cache/colas)│     │(tareas async)│
                        └───────────┘                    └─────────────┘     └─────────────┘
```

- **Capa de presentación (Frontend):** aplicación de página única (SPA) construida
  con React y TypeScript, que consume la API del backend vía GraphQL y recibe
  eventos en tiempo real por WebSocket.
- **Capa de lógica de negocio (Backend):** API construida con Django y Strawberry
  GraphQL, ejecutada sobre un servidor ASGI (Daphne) para soportar conexiones
  WebSocket. Contiene la lógica de dominio, validaciones y la máquina de estados
  de acceso.
- **Capa de datos y servicios:** PostgreSQL como base de datos relacional, Redis
  para caché y colas de mensajes, y Celery para tareas asíncronas (envío de
  correos, análisis de anomalías, vencimiento de accesos temporales).

## 5. Módulos funcionales

| Módulo | Responsabilidad |
|---|---|
| **Usuarios** | Autenticación, roles y permisos, perfil, 2FA. |
| **Vehículos** | Registro de vehículos, documentos, historial de estado y propietario. |
| **Acceso** | Control de entrada/salida, QR dinámico, delegaciones, pases, autorizaciones externas, alertas y auditoría. |
| **Parqueos** | Zonas, espacios, categorías y sesiones de ocupación, con orientación en tiempo real. |
| **Visitantes** | Pre-registro, registro de visitas, control de anfitrión/dependencia y salida. |
| **Infracciones** | Tipos de infracción, sanciones, pagos y apelaciones. |
| **Notificaciones** | Notificaciones in-app, email y WhatsApp; preferencias por canal. |
| **Reportes/Estadísticas** | Indicadores de ocupación, accesos, throughput de porterías y sanciones. |

### Flujo principal de control de acceso

1. El conductor presenta su **QR dinámico** (o la placa es leída por el sistema OCR).
2. El guardia escanea el código; el sistema **resuelve la credencial** en varios
   niveles de prioridad (QR dinámico, delegación, pase temporal, autorización
   externa).
3. Se valida el **estado del vehículo** (activo, no sancionado, no en alerta de
   seguridad) y la **dirección del movimiento** (máquina de estados
   entrada→salida→entrada, con control anti-passback).
4. Se registra el acceso con responsable, punto, método y evidencia fotográfica.
5. Al ingresar, se ofrece **orientación de parqueo**; al salir, se **libera
   automáticamente** el espacio ocupado.

## 6. Tecnologías utilizadas

### Backend
- **Python 3.12** / **Django 5.2** — framework web principal.
- **Strawberry GraphQL** — capa de API (esquema tipado).
- **Django Channels** + **Daphne** (ASGI) — WebSockets en tiempo real.
- **PostgreSQL** — base de datos relacional.
- **Redis** — caché y broker de mensajes.
- **Celery** — procesamiento asíncrono y tareas programadas.

### Frontend
- **React 18** + **TypeScript** — interfaz de usuario.
- **Vite** — empaquetador y servidor de desarrollo.
- **Apollo Client** — cliente GraphQL.
- **Tailwind CSS** — estilos y diseño responsive.
- **Leaflet** — mapas interactivos de parqueo/rastreo.

### Visión artificial
- **FastALPR** (YOLOv9 + OCR ViT) — reconocimiento automático de placas.

### Infraestructura y despliegue
- **Docker** / **Docker Compose** — contenedorización para despliegue portable.
- **Railway** (backend) y **Vercel** (frontend) — despliegue en la nube.
- **GitHub Actions** — integración continua (CI).

## 7. Modelo de datos

El sistema se compone de **35 tablas** organizadas en 7 módulos. El detalle
completo de cada tabla, sus campos, tipos de datos, obligatoriedad y llaves se
encuentra en el documento **[Diccionario de Datos](DICCIONARIO_DE_DATOS.md)**.

Las entidades centrales son:

- **Usuario** y **Vehículo** (con propietario), núcleo del registro.
- **RegistroAcceso**, que documenta cada entrada/salida.
- **SesionParqueo**, que documenta la ocupación de espacios.
- **Visita**, que gestiona el ingreso de externos.
- **Infracción** y **Sanción** (separadas conceptualmente), para el régimen
  disciplinario.

## 8. Seguridad

El sistema implementa varias medidas de seguridad:

- **Autenticación con JWT** y control de acceso basado en **roles y permisos**.
- **Autenticación de doble factor (2FA/TOTP)** opcional para los usuarios.
- **QR dinámico TOTP:** las credenciales de acceso rotan cada 30 segundos, por lo
  que una captura de pantalla no puede reutilizarse. En producción, el QR
  estático legacy queda deshabilitado.
- **Máquina de estados anti-passback:** impide registrar dos entradas seguidas o
  una salida sin entrada previa.
- **Lista negra (alerta de seguridad):** un vehículo marcado (robo/acceso
  revocado) es denegado en portería y genera una alerta crítica.
- **Auditoría completa:** toda operación sensible queda registrada con usuario,
  acción, IP y fecha.
- **Concurrencia segura:** uso de bloqueo optimista (UPDATE WHERE) y restricciones
  de unicidad a nivel de base de datos para evitar dobles registros.

## 9. Despliegue

El sistema está completamente **contenedorizado con Docker**, lo que permite
levantarlo en cualquier entorno (servidor local, VPS o la nube) con un único
comando. Los detalles se documentan en **[DEPLOY.md](DEPLOY.md)**. Se ofrecen
tres modalidades:

- **Nube:** backend en Railway, frontend en Vercel (URL pública).
- **Local/servidor:** `docker compose up` levanta todos los servicios.
- **Portable (USB/flash):** paquete offline con imágenes pre-construidas.

## 10. Conclusiones

El Sistema de Control Vehicular UAGRM cumple con el objetivo de **digitalizar y
agilizar el control de acceso vehicular** al campus, atacando de forma directa el
problema de las colas (mediante credenciales dinámicas, pre-registro de
visitantes y modo de registro exprés) y el de la seguridad (con QR rotativo,
lista negra, anti-passback y auditoría integral).

El modelo de datos es coherente y completo, separando correctamente conceptos que
suelen mezclarse (por ejemplo, la infracción como *hecho* frente a la sanción
como *consecuencia*). La arquitectura desacoplada y la contenedorización permiten
un despliegue flexible y un mantenimiento ordenado.

Como líneas de mejora para un despliegue real a gran escala se identifican: la
incorporación de un **modo de operación offline** en las porterías (para tolerar
caídas de red), la **integración con el directorio institucional** de la UAGRM y
la **integración con barreras físicas** para automatizar por completo el paso
vehicular.
