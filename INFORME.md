# Sistema de Control Vehicular UAGRM
## Informe Técnico del Proyecto

---

**Universidad Autónoma Gabriel René Moreno (UAGRM)**

Facultad de Ingeniería en Ciencias de la Computación y Telecomunicaciones

**Materia:** Ingeniería de Software II

**Proyecto:** Sistema de Control Vehicular

**Docente:** _______________________________

**Integrantes:**
- _______________________________
- _______________________________
- _______________________________

**Fecha:** _______________________________

**Repositorio:** https://github.com/proyectosw22025-ux/Control-Vehicular

---

<div style="page-break-after: always;"></div>

## Resumen ejecutivo

El presente informe documenta el **Sistema de Control Vehicular UAGRM**, una
aplicación web desarrollada para gestionar de forma integral el acceso de
vehículos al campus de la Universidad Autónoma Gabriel René Moreno. El sistema
digitaliza el control que tradicionalmente se realiza de forma manual en las
porterías, con dos objetivos centrales: **evitar la formación de colas** en el
ingreso y **garantizar la seguridad** en la identificación de los vehículos.

La solución combina credenciales digitales seguras (códigos QR dinámicos que
rotan cada 30 segundos), reconocimiento automático de placas mediante visión
artificial, orientación de parqueo en tiempo real, gestión de visitantes y
proveedores externos, un régimen de infracciones y sanciones, y un sistema de
notificaciones multicanal. Está construido sobre una arquitectura cliente-servidor
desacoplada, contenedorizada con Docker y desplegable tanto en la nube como en
servidores locales.

El sistema comprende **35 entidades de datos** distribuidas en **7 módulos
funcionales**, con control de acceso basado en roles, auditoría integral de
operaciones y comunicación en tiempo real mediante WebSockets.

---

## Índice

1. [Introducción](#1-introducción)
2. [Planteamiento del problema](#2-planteamiento-del-problema)
3. [Objetivos](#3-objetivos)
4. [Alcance y limitaciones](#4-alcance-y-limitaciones)
5. [Requerimientos del sistema](#5-requerimientos-del-sistema)
6. [Arquitectura del sistema](#6-arquitectura-del-sistema)
7. [Módulos funcionales](#7-módulos-funcionales)
8. [Flujos principales del sistema](#8-flujos-principales-del-sistema)
9. [Modelo de datos](#9-modelo-de-datos)
10. [Tecnologías utilizadas](#10-tecnologías-utilizadas)
11. [Seguridad](#11-seguridad)
12. [Pruebas](#12-pruebas)
13. [Despliegue](#13-despliegue)
14. [Conclusiones y trabajo futuro](#14-conclusiones-y-trabajo-futuro)

---

<div style="page-break-after: always;"></div>

## 1. Introducción

El control de acceso vehicular es una necesidad crítica en instituciones de gran
afluencia como la Universidad Autónoma Gabriel René Moreno, donde miles de
estudiantes, docentes y personal administrativo ingresan diariamente al campus.
Los métodos tradicionales de control —planillas en papel, revisión visual del
guardia, credenciales físicas— presentan limitaciones importantes: generan colas
en horas pico, son propensos a errores humanos, no dejan un registro fácilmente
consultable y son vulnerables a la suplantación.

El **Sistema de Control Vehicular UAGRM** surge como respuesta a esta
problemática. Se trata de una plataforma web moderna que automatiza y agiliza el
control de acceso, sustituyendo los procesos manuales por credenciales digitales
seguras y flujos de trabajo optimizados. El sistema no solo controla la entrada y
salida de vehículos, sino que gestiona todo el ciclo asociado: registro de
vehículos y propietarios, orientación de parqueo, atención de visitantes,
régimen de infracciones y notificaciones a los usuarios.

Este informe describe el problema que resuelve el sistema, sus objetivos, su
arquitectura técnica, sus módulos funcionales, el modelo de datos, las
tecnologías empleadas y las medidas de seguridad implementadas.

## 2. Planteamiento del problema

El control vehicular manual en el campus universitario presenta los siguientes
problemas concretos:

- **Formación de colas:** el registro manual de cada vehículo (anotar placa,
  verificar credencial, levantar barrera) es lento y provoca congestión en las
  porterías, especialmente en horarios de entrada y salida masiva.
- **Errores de dirección:** el guardia debe decidir manualmente si un vehículo
  entra o sale, lo que genera inconsistencias en el conteo de vehículos dentro
  del campus.
- **Vulnerabilidad de credenciales:** las credenciales físicas o los códigos
  estáticos pueden fotografiarse y reutilizarse por terceros no autorizados.
- **Falta de trazabilidad:** los registros en papel son difíciles de consultar,
  auditar o cruzar con otros datos.
- **Gestión desordenada de visitantes:** no existe un mecanismo ágil para
  pre-registrar visitantes ni para controlar el tiempo de permanencia de
  proveedores externos.
- **Ausencia de información de parqueo:** los conductores no saben dónde hay
  espacios disponibles, lo que genera circulación innecesaria dentro del campus.

### Justificación

La digitalización del control vehicular permite atacar estos problemas de raíz:
credenciales dinámicas que no se pueden reutilizar, deducción automática de la
dirección del movimiento, registro trazable y auditable, pre-registro de
visitantes y orientación de parqueo en tiempo real. El resultado es un control
más **ágil** (menos colas), más **seguro** (identificación confiable) y más
**transparente** (todo queda registrado).

## 3. Objetivos

### 3.1 Objetivo general

Desarrollar un sistema informático que permita **controlar y gestionar el acceso
vehicular** al campus de la UAGRM, garantizando fluidez en las porterías,
seguridad en la identificación de vehículos y trazabilidad completa de los
accesos.

### 3.2 Objetivos específicos

- Registrar y administrar los vehículos de la comunidad universitaria y sus
  propietarios, con su documentación asociada.
- Controlar el ingreso y salida de vehículos mediante credenciales digitales
  seguras (QR dinámico TOTP), evitando la reutilización fraudulenta.
- Reducir la formación de colas en las porterías mediante la deducción automática
  de la dirección de acceso y credenciales de lectura instantánea.
- Gestionar el acceso de visitantes y proveedores externos con pre-registro,
  autorizaciones y control por tiempo de permanencia.
- Administrar las zonas y espacios de parqueo, ofreciendo orientación en tiempo
  real a los conductores sobre disponibilidad.
- Registrar infracciones y sus sanciones, con flujos de pago y apelación.
- Proveer trazabilidad y auditoría de todas las operaciones sensibles del sistema.
- Notificar en tiempo real a los usuarios sobre eventos relevantes de sus
  vehículos (entradas, salidas, infracciones).

## 4. Alcance y limitaciones

### 4.1 Alcance

El sistema cubre el ciclo completo del control vehicular:

- Gestión de usuarios con roles y permisos diferenciados.
- Registro y administración de vehículos y su documentación.
- Control de acceso por múltiples vías (QR dinámico, delegación, pases
  temporales, autorizaciones externas, registro manual).
- Gestión de zonas, espacios y sesiones de parqueo.
- Gestión integral de visitantes (pre-registro, registro, control de salida).
- Régimen de infracciones y sanciones con pagos y apelaciones.
- Notificaciones multicanal (in-app en tiempo real, correo, WhatsApp).
- Reportes, estadísticas y auditoría.

### 4.2 Limitaciones

- El sistema requiere **conexión a internet** en las porterías; no cuenta aún con
  un modo de operación totalmente offline.
- El reconocimiento de placas (OCR) es una ayuda de identificación y registro; no
  sustituye la verificación de la credencial digital.
- La integración con **barreras físicas** automáticas y con el **directorio
  institucional** de la UAGRM se plantea como trabajo futuro.

## 5. Requerimientos del sistema

### 5.1 Requerimientos funcionales

| Código | Requerimiento |
|---|---|
| RF-01 | El sistema debe permitir el registro y autenticación de usuarios con roles. |
| RF-02 | El sistema debe permitir registrar vehículos asociados a un propietario. |
| RF-03 | El sistema debe generar un QR dinámico (rotativo) por vehículo para el acceso. |
| RF-04 | El sistema debe registrar entradas y salidas validando la dirección del movimiento. |
| RF-05 | El sistema debe permitir delegar el acceso de un vehículo a un tercero. |
| RF-06 | El sistema debe permitir el pre-registro de visitantes sin autenticación. |
| RF-07 | El sistema debe permitir emitir autorizaciones de acceso a proveedores externos. |
| RF-08 | El sistema debe controlar el tiempo de permanencia de vehículos temporales. |
| RF-09 | El sistema debe gestionar zonas y espacios de parqueo y su ocupación. |
| RF-10 | El sistema debe orientar al conductor sobre espacios disponibles al ingresar. |
| RF-11 | El sistema debe registrar infracciones y generar la sanción correspondiente. |
| RF-12 | El sistema debe permitir el pago y la apelación de sanciones. |
| RF-13 | El sistema debe notificar a los usuarios los eventos de sus vehículos. |
| RF-14 | El sistema debe registrar en auditoría todas las operaciones sensibles. |
| RF-15 | El sistema debe generar reportes y estadísticas de accesos, parqueo y sanciones. |

### 5.2 Requerimientos no funcionales

| Código | Requerimiento |
|---|---|
| RNF-01 | **Seguridad:** las credenciales de acceso deben ser dinámicas y no reutilizables. |
| RNF-02 | **Rendimiento:** la validación de un acceso debe resolverse en tiempo casi inmediato. |
| RNF-03 | **Concurrencia:** el sistema debe manejar accesos simultáneos sin duplicar registros. |
| RNF-04 | **Disponibilidad:** el sistema debe operar en tiempo real (notificaciones vía WebSocket). |
| RNF-05 | **Portabilidad:** el sistema debe poder desplegarse en la nube o en un servidor local. |
| RNF-06 | **Usabilidad:** la interfaz debe ser responsive (adaptable a móvil y escritorio). |
| RNF-07 | **Trazabilidad:** toda acción sensible debe quedar auditada con usuario, fecha e IP. |
| RNF-08 | **Mantenibilidad:** el sistema debe seguir una arquitectura modular y desacoplada. |

## 6. Arquitectura del sistema

El sistema sigue una arquitectura **cliente-servidor desacoplada** organizada en
tres capas, comunicadas mediante una API GraphFQL y canales WebSocket.

### 6.1 Diagrama de arquitectura

```
        CAPA DE PRESENTACIÓN                 CAPA DE LÓGICA DE NEGOCIO
   ┌──────────────────────────┐          ┌───────────────────────────┐
   │        FRONTEND          │  GraphQL │          BACKEND          │
   │  React 18 + TypeScript   │ ◄──────► │   Django 5.2 + Strawberry │
   │  Apollo Client + Vite    │ WebSocket│   GraphQL (ASGI / Daphne) │
   │  Tailwind CSS + Leaflet  │  (WSS)   │   Lógica de dominio        │
   └──────────────────────────┘          └───────────┬───────────────┘
                                                      │
                     CAPA DE DATOS Y SERVICIOS        │
       ┌──────────────┬───────────────────┬──────────┴──────────┐
       │              │                   │                     │
  ┌────▼─────┐  ┌─────▼─────┐      ┌───────▼──────┐      ┌───────▼──────┐
  │PostgreSQL│  │   Redis   │      │    Celery    │      │   FastALPR   │
  │  (datos) │  │(caché y   │      │  (tareas     │      │ (OCR placas) │
  │          │  │ colas)    │      │   asíncronas)│      │              │
  └──────────┘  └───────────┘      └──────────────┘      └──────────────┘
```

### 6.2 Descripción de las capas

**Capa de presentación (Frontend).** Aplicación de página única (SPA) construida
con React y TypeScript. Se comunica con el backend mediante consultas y
mutaciones GraphQL a través de Apollo Client, y recibe eventos en tiempo real
(notificaciones, disponibilidad de parqueo) mediante WebSockets. La interfaz es
completamente responsive, adaptándose a dispositivos móviles y de escritorio.

**Capa de lógica de negocio (Backend).** API construida con Django y Strawberry
GraphQL, ejecutada sobre un servidor ASGI (Daphne) para soportar conexiones
persistentes WebSocket. Contiene toda la lógica de dominio: validación de
credenciales, máquina de estados de acceso, reglas de negocio de parqueo,
visitantes e infracciones, y la capa de auditoría. La lógica de resolución de
credenciales utiliza **bloqueo optimista** para garantizar consistencia bajo
concurrencia sin bloquear la base de datos.

**Capa de datos y servicios.**
- **PostgreSQL:** base de datos relacional que almacena todas las entidades.
- **Redis:** caché de alto rendimiento (resolución de QR dinámico, semáforo de
  parqueo) y broker de mensajes para Celery y Channels.
- **Celery:** ejecución de tareas asíncronas y programadas (envío de correos,
  análisis diario de anomalías, control de vencimiento de accesos temporales,
  auto-cierre de visitas).
- **FastALPR:** módulo de visión artificial para el reconocimiento automático de
  placas.

### 6.3 Patrón de comunicación

La comunicación entre frontend y backend se realiza principalmente vía
**GraphQL**, lo que permite al cliente solicitar exactamente los datos que
necesita en una sola petición. Para eventos en tiempo real (notificaciones,
actualización de disponibilidad de parqueo) se emplea **WebSocket** a través de
Django Channels, evitando la necesidad de sondeo constante al servidor.

## 7. Módulos funcionales

El sistema se organiza en siete módulos funcionales, cada uno con
responsabilidades bien delimitadas.

### 7.1 Módulo de Usuarios y Seguridad
Gestiona la autenticación, los roles y los permisos. Implementa control de acceso
basado en roles (RBAC): cada usuario tiene uno o más roles (Administrador,
Guardia, Docente, Estudiante, Administrativo) y cada rol agrupa permisos por
módulo. Incluye autenticación de doble factor (2FA/TOTP) opcional y gestión de
perfil.

### 7.2 Módulo de Vehículos
Administra el registro de vehículos y su vinculación con el propietario. Gestiona
la documentación asociada (SOAT, revisión técnica, permiso de circulación) con
control de vencimientos, el historial de cambios de estado del vehículo y el
historial de propietarios. Genera y administra las credenciales de acceso (QR
dinámico y hash estático).

### 7.3 Módulo de Acceso
Es el núcleo del control vehicular. Gestiona los puntos de acceso (porterías), el
registro de cada entrada/salida, y resuelve las credenciales presentadas en
varios niveles de prioridad:
1. **QR dinámico TOTP** (código rotativo, seguro).
2. **QR de delegación** (autorización a un tercero).
3. **Pase temporal** (visitantes pre-registrados).
4. **Autorización externa** (proveedores).
5. **Registro manual** (respaldo del guardia).

Incluye la máquina de estados de acceso (control anti-passback), las alertas de
seguridad (lista negra) y el registro de auditoría.

### 7.4 Módulo de Parqueos
Administra las zonas de estacionamiento, sus espacios individuales, las categorías
de espacio (general, discapacidad, autoridades) y las sesiones de ocupación. La
capacidad disponible se calcula en tiempo real y se difunde a los usuarios,
ofreciendo orientación sobre dónde estacionar. Al registrar la salida de un
vehículo, su espacio se libera automáticamente.

### 7.5 Módulo de Visitantes
Gestiona el ingreso de personas externas. Permite el **pre-registro sin
autenticación** (el visitante deja sus datos desde su casa y recibe un QR por
correo/WhatsApp), el **registro exprés** por parte del guardia en momentos de alta
afluencia, y la asignación de un anfitrión o dependencia de destino. Controla la
entrada, la salida y el tiempo de permanencia, con auto-cierre de visitas que
exceden su duración esperada.

### 7.6 Módulo de Infracciones y Sanciones
Implementa el régimen disciplinario, separando conceptualmente la **infracción**
(el hecho registrado) de la **sanción** (su consecuencia). Una infracción puede
derivar en distintos tipos de sanción: amonestación, multa económica, suspensión
de acceso o reporte a Bienestar Estudiantil. Gestiona el pago de las multas
económicas (con distintos métodos) y las apelaciones de los usuarios.

### 7.7 Módulo de Notificaciones
Envía notificaciones a los usuarios por múltiples canales: in-app en tiempo real
(WebSocket), correo electrónico y WhatsApp. Cada usuario puede configurar sus
preferencias de notificación por tipo y canal.

## 8. Flujos principales del sistema

### 8.1 Flujo de acceso de un miembro de la comunidad

1. El conductor abre la aplicación y muestra su **QR dinámico** (o su placa es
   leída por el sistema OCR).
2. El guardia escanea el código con su dispositivo.
3. El sistema **resuelve la credencial**, identificando al vehículo.
4. Se valida el **estado del vehículo** (activo, no sancionado, sin alerta de
   seguridad).
5. Se determina la **dirección del movimiento** (entrada o salida) según el último
   registro, evitando errores de dirección.
6. Se registra el acceso con su responsable, punto, método y evidencia.
7. Si es una entrada, se ofrece **orientación de parqueo**; si es una salida, se
   **libera automáticamente** el espacio que ocupaba.
8. Se **notifica al propietario** el movimiento de su vehículo.

### 8.2 Flujo de acceso de un visitante

1. El visitante se **pre-registra** desde la web (sin cuenta), indicando sus
   datos y su destino. Recibe un **QR por correo y WhatsApp**.
2. Al llegar, presenta el QR; el guardia lo escanea y registra la visita,
   asignando un **anfitrión o dependencia**.
3. Si el visitante no se pre-registró, el guardia usa el **registro exprés**, que
   crea el visitante y registra la visita en una sola operación.
4. Si llega en vehículo, se crea un **vehículo temporal** vinculado a la visita
   para coordinar su parqueo y su salida.
5. Se **notifica al anfitrión** que su visitante ha llegado.
6. A la salida, la visita se cierra (por el guardia, por el anfitrión, o
   automáticamente si excede su tiempo).

### 8.3 Flujo de acceso de un proveedor externo

1. Un administrativo **emite una autorización** de acceso para la placa del
   proveedor, con una ventana horaria y una dependencia destino.
2. El proveedor recibe un **QR por correo**.
3. Al llegar, el guardia escanea el QR: el **primer escaneo registra la entrada**
   y el **segundo la salida**, controlados por el conteo de usos.

## 9. Modelo de datos

El sistema se compone de **35 tablas** organizadas en los 7 módulos descritos. El
detalle completo de cada tabla —sus campos, tipos de datos, obligatoriedad y
llaves primarias/foráneas— se encuentra en el documento complementario
**[Diccionario de Datos](DICCIONARIO_DE_DATOS.md)**.

Las entidades centrales del modelo son:

- **Usuario:** persona del sistema, con sus roles y permisos.
- **Vehículo:** vinculado a un propietario, con documentos e historial.
- **RegistroAcceso:** bitácora de cada entrada/salida del campus.
- **SesionParqueo:** ocupación de un espacio entre entrada y salida.
- **Visita:** ingreso de un externo, con anfitrión o dependencia.
- **Infracción** y **Sanción:** el hecho y su consecuencia, separados.

### Relaciones principales

- Un **Usuario** posee muchos **Vehículos** y puede tener varios **Roles**.
- Un **Vehículo** genera muchos **Registros de acceso**, **Sesiones de parqueo**
  e **Infracciones**.
- Una **Infracción** origina una **Sanción** (1:1); una sanción económica genera
  un **Pago** (1:1); una infracción puede tener una **Apelación** (1:1).
- Una **Zona de parqueo** contiene muchos **Espacios**; cada **Espacio** tiene
  muchas **Sesiones** a lo largo del tiempo.
- Un **Visitante** genera muchas **Visitas**, cada una con un anfitrión o una
  dependencia de destino.

## 10. Tecnologías utilizadas

### 10.1 Backend
| Tecnología | Uso |
|---|---|
| Python 3.12 | Lenguaje de programación del servidor |
| Django 5.2 | Framework web principal |
| Strawberry GraphQL | Definición del esquema y la API |
| Django Channels + Daphne | Comunicación en tiempo real (WebSockets, ASGI) |
| PostgreSQL | Base de datos relacional |
| Redis | Caché y broker de mensajes |
| Celery | Tareas asíncronas y programadas |

### 10.2 Frontend
| Tecnología | Uso |
|---|---|
| React 18 | Librería de interfaz de usuario |
| TypeScript | Tipado estático sobre JavaScript |
| Vite | Empaquetador y servidor de desarrollo |
| Apollo Client | Cliente GraphQL |
| Tailwind CSS | Framework de estilos y diseño responsive |
| Leaflet | Mapas interactivos (parqueo y rastreo) |

### 10.3 Visión artificial e infraestructura
| Tecnología | Uso |
|---|---|
| FastALPR (YOLOv9 + OCR ViT) | Reconocimiento automático de placas |
| Docker / Docker Compose | Contenedorización y despliegue portable |
| Railway | Despliegue del backend en la nube |
| Vercel | Despliegue del frontend en la nube |
| GitHub Actions | Integración continua (CI) |

## 11. Seguridad

El sistema implementa múltiples capas de seguridad:

- **Autenticación con JWT** y control de acceso basado en **roles y permisos**
  (RBAC), de modo que cada usuario solo accede a lo que su rol permite.
- **Autenticación de doble factor (2FA/TOTP)** opcional para reforzar el login.
- **QR dinámico TOTP:** las credenciales de acceso **rotan cada 30 segundos**, por
  lo que una captura de pantalla no puede reutilizarse. En producción, el QR
  estático legacy queda deshabilitado por seguridad.
- **Máquina de estados anti-passback:** impide registrar dos entradas seguidas o
  una salida sin entrada previa, manteniendo consistente el conteo de vehículos.
- **Lista negra (alerta de seguridad):** un vehículo marcado como robado o con
  acceso revocado es denegado en portería y genera una alerta crítica, dejando
  registrado el intento.
- **Auditoría integral:** toda operación sensible se registra con usuario, acción,
  dirección IP y fecha.
- **Concurrencia segura:** se emplea bloqueo optimista y restricciones de
  unicidad a nivel de base de datos para evitar registros duplicados cuando dos
  operaciones ocurren simultáneamente.

## 12. Pruebas

El proyecto incluye una **suite de pruebas automatizadas** tanto en el backend
(pruebas de la lógica de dominio: resolución de credenciales, máquina de estados
de acceso, flujos de infracciones y visitantes, control de concurrencia) como en
el frontend (pruebas de componentes clave). Las pruebas se ejecutan
automáticamente en cada cambio mediante **integración continua (GitHub Actions)**,
garantizando que las nuevas modificaciones no rompan la funcionalidad existente.

Adicionalmente, el sistema fue verificado de forma integral (build de producción
y despliegue completo en contenedores) para asegurar su correcto funcionamiento
extremo a extremo.

## 13. Despliegue

El sistema está completamente **contenedorizado con Docker**, lo que permite
levantarlo en cualquier entorno con un único comando. Se ofrecen tres modalidades
de despliegue (detalladas en el documento **[DEPLOY.md](DEPLOY.md)**):

1. **Nube:** backend desplegado en Railway y frontend en Vercel, accesible desde
   una URL pública.
2. **Local o servidor propio:** `docker compose up` levanta todos los servicios
   (base de datos, caché, backend, tareas asíncronas y frontend).
3. **Portable (USB/flash):** un paquete offline con las imágenes ya construidas,
   para instalar el sistema en equipos sin conexión a internet.

El frontend está preparado para funcionar en **mismo origen**, por lo que una
única imagen puede ejecutarse en cualquier host sin recompilación.

## 14. Conclusiones y trabajo futuro

### 14.1 Conclusiones

El Sistema de Control Vehicular UAGRM cumple con el objetivo de **digitalizar y
agilizar el control de acceso vehicular** al campus. Ataca de forma directa el
problema de las colas —mediante credenciales de lectura instantánea, deducción
automática de la dirección de acceso, pre-registro de visitantes y registro
exprés— y el problema de la seguridad —con QR rotativo, lista negra,
anti-passback y auditoría integral.

El modelo de datos es coherente y completo, y separa correctamente conceptos que
tradicionalmente se mezclan (por ejemplo, la infracción como *hecho* frente a la
sanción como *consecuencia*). La arquitectura desacoplada, modular y
contenedorizada facilita el mantenimiento y permite un despliegue flexible en la
nube o en servidores locales.

En conjunto, el sistema constituye una solución robusta, segura y escalable para
el control vehicular de una institución de gran afluencia como la UAGRM.

### 14.2 Trabajo futuro

Para un despliegue a gran escala en condiciones reales, se identifican las
siguientes líneas de mejora:

- **Modo de operación offline** en las porterías, para tolerar caídas de red sin
  detener el flujo de acceso.
- **Integración con el directorio institucional** de la UAGRM, para sincronizar
  automáticamente los datos de la comunidad universitaria.
- **Integración con barreras físicas** automáticas, para completar la
  automatización del paso vehicular.
- **Control de aforo:** condicionar el ingreso a la disponibilidad de espacios
  para evitar la sobreocupación del campus.

---

*Documento complementario: [Diccionario de Datos](DICCIONARIO_DE_DATOS.md) — detalle de las 35 tablas del sistema.*
