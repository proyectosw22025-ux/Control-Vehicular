# Plan: Integración con el directorio de la universidad + paso a servidores propios

> Estado: **PLANIFICADO / EN ESPERA DE DATOS** (no implementado). Documento de
> análisis para cuando la universidad entregue el código (llave) de acceso a los
> datos de estudiantes, docentes y administrativos, y los servidores donde alojar
> el sistema. No tocar código hasta confirmar las preguntas del final.

---

## PARTE 1 — Explicación sencilla (leer primero)

### Qué es el "código" que te van a dar

Es una **llave de acceso para programas** (su nombre técnico es *API key* o *token*).
No es un usuario y contraseña para que entres vos a una página — es una credencial
que **tu sistema** usa para identificarse ante el sistema de la universidad y decir
"soy la app de Control Vehicular autorizada, dame los datos".

**Analogía:** la universidad tiene un gran archivo cerrado con la lista de todos los
estudiantes, docentes y administrativos. Te dan una **copia de la llave** (tu código).
Con esa llave, tu sistema puede abrir el archivo y **leer** la lista cuando la
necesite — pero no entra cualquiera, solo quien tenga la llave.

### Cómo funciona, paso a paso

1. La universidad te da: **una dirección** (una URL, ej. `https://api.uagrm.edu.bo/personas`)
   **+ tu código/llave**.
2. Tu sistema le "pregunta" a esa dirección mostrando la llave: *"Dame la lista de personas"*.
3. La universidad verifica que la llave sea válida y **devuelve los datos** (CI, nombre,
   apellido, email, si es estudiante/docente/administrativo...).
4. Tu sistema **guarda o actualiza** esas personas en tu base de datos automáticamente,
   sin que nadie tenga que registrarse a mano.

### Lo que cambia, en una frase

> Las personas (estudiantes, docentes, administrativos) **ya no se registran solas** —
> tu sistema las trae automáticamente con esa llave. Lo único que el usuario hace
> después es entrar y registrar **su vehículo** (eso sigue igual).

### Las dos formas en que puede venir la llave

| Forma | Qué hace la llave | Cómo entra el estudiante a tu sistema |
|---|---|---|
| **A) Solo datos** (lo más común con un "código") | Trae la lista de personas | Vos les pones/generas una contraseña en tu sistema (o usás su CI), y entran con eso |
| **B) Datos + login** (SSO) | Trae los datos *y* valida quién es quién al entrar | El estudiante entra con su **misma cuenta de la universidad**; vos no manejas contraseñas |

Como dijeron "te damos un **código** para **traer los datos**", lo más probable es la
**forma A**: la llave es para leer el padrón, y el login lo seguís manejando vos.

---

## PARTE 2 — Qué cambia en el sistema (detalle técnico)

### El cambio conceptual

Hoy el sistema es **dueño de su propia identidad**: cualquiera se auto-registra
(`crear_usuario` + `Register.tsx`) y declara su rol. Con el directorio de la
universidad, esa fuente pasa a ser **la verdad** para estudiantes/docentes/
administrativos. El sistema deja de *crear* esas identidades y pasa a *consumirlas*.

> **La idea central:** la universidad te ahorra **gestionar personas**, no **gestionar
> vehículos ni accesos**. El núcleo operativo (placas, parqueo, accesos, infracciones,
> visitantes) queda intacto; lo que se simplifica es la capa de identidad.

### Qué se vuelve innecesario (a obviar)

1. **Auto-registro de estudiante/docente/personal** — `Register.tsx` y la rama de
   `crear_usuario` para esos tipos. La persona no "crea cuenta": se **aprovisiona**
   al primer login (JIT) o por sincronización periódica.
   - ⚠️ **No borrar entero:** `Guardia` y `Administrador` **NO están en el directorio
     académico** — son roles operativos del sistema. La creación de esas cuentas (por
     admin) **se queda**.
2. **Auto-declaración del rol** (`tipo_usuario`) — el rol lo dicta el directorio (la
   API dice que ese CI es docente), no el usuario. El mapeo `TIPOS_USUARIO` se mantiene,
   pero la asignación pasa a ser automática.
3. **Edición local de datos que el directorio posee** — nombre, apellido, email, CI.
   En `actualizar_usuario` esos campos deben volverse **solo-lectura/sincronizados**
   para no desincronizarse con la fuente. Siguen editables: teléfono, WhatsApp, foto, 2FA.
4. **Gestión de contraseña** (`cambiar_password`, campo password) — **solo si hay SSO
   (forma B)**. Con forma A se queda.
5. **Email de "bienvenida por creación de cuenta"** — se reconvierte en "bienvenida al
   primer login".

### Qué hay que adaptar o agregar (no quitar)

1. **Capa de aprovisionamiento (adaptador de identidad)** — un servicio que, con la
   llave, hace *create-or-update* de `Usuario` y asigna el rol. Dos modos, normalmente
   ambos:
   - **JIT en el login**: autentica → busca el CI en el directorio → crea/actualiza
     Usuario + rol → emite token.
   - **Sincronización batch** (tarea Celery periódica): precarga y mantiene el padrón
     completo.
2. **Delegación de autenticación** (solo si hay SSO / forma B) — reemplazar
   `authenticate(ci, password)` por la validación de la universidad. Lo bueno: el resto
   del `login` (anti-fuerza-bruta, auditoría, emisión de JWT) **se conserva**.
3. **CI como clave de unión** — ya se usa CI como login, así que el cruce es natural.
   Solo hay que **normalizar el formato del CI** (con/sin complemento, expedición).
4. **Modelo de identidad de dos niveles:**
   - **Federadas** (estudiante/docente/personal) → del directorio, casi solo-lectura.
   - **Locales** (guardia, administrador) → creadas y gestionadas por el sistema.
   - **Sin cuenta** (visitantes, vehículos temporales, autorizaciones externas) → no
     necesitan directorio y **no se tocan**; son la vía para quien NO está en el padrón.
5. **Ciclo de vida dirigido por el directorio** — egresados/desvinculados se desactivan
   automáticamente según el padrón (hoy `desactivar_usuario` es manual). Más seguro.

### Barrido por módulo

| Módulo | ¿Cambia? | Qué pasa |
|---|---|---|
| **usuarios** | **Mucho** | Se quita auto-registro de roles federados; se agrega aprovisionamiento; rol automático; password/2FA según forma A/B; datos del directorio solo-lectura. Creación de guardia/admin **se queda**. |
| **vehiculos** | **Poco** | El `propietario` apunta a un Usuario federado. **El registro de vehículos NO se elimina** — la universidad da personas, no sus autos. El flujo de aprobación se mantiene. |
| **acceso** | **Casi nada** | Opera sobre placas/vehículos. `registrado_por` sigue siendo un guardia (cuenta local). |
| **parqueos** | No | Opera sobre vehículos/sesiones. |
| **visitantes** | No (más relevante) | Es la vía para los NO-federados. Se conserva tal cual. |
| **multas/infracciones** | No | Opera sobre vehículos; `registrado_por` = guardia/admin. |
| **notificaciones** | **Ajuste** | Email viene del directorio; "bienvenida" → "primer login"; teléfono/WhatsApp siguen locales. |
| **reportes/estadísticas** | No (se enriquece) | Si el directorio trae facultad/carrera, se puede reportar por unidad académica. |

---

## PARTE 3 — Pasar a los servidores de la universidad

### En simple

"Usar los servidores de la universidad" es un **cambio de dónde vive la app, no una
reescritura**. El proyecto ya está preparado para mudarse:

- Ya tiene **Dockerfiles (backend y frontend) + `docker-compose.yml`** → es portable.
- La configuración lee de **variables de entorno** (`DATABASE_URL`, `REDIS_URL`,
  `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`). Mudarse = **re-apuntar variables**, no
  recompilar.

### Qué implica según lo que te den

- **Una VM / servidor con SSH** (lo más probable) → desplegás con `docker-compose` en su
  máquina; nginx delante para el SSL.
- **Postgres/Redis gestionados por ellos** → apuntás `DATABASE_URL`/`REDIS_URL` a los suyos.
- Hay un detalle Railway-específico en `production.py` (`SECURE_PROXY_SSL_HEADER`) que
  habrá que ajustar a su reverse proxy.

### Cómo hacer la transición (NO de golpe)

1. **Mantener Railway/Vercel vivos** como referencia que funciona, hasta validar el
   entorno de la universidad. **No borrar el cloud todavía.**
2. Levantar el despliegue universitario **en paralelo** (mismas imágenes Docker,
   variables y DB de ellos).
3. **Migrar los datos** (`pg_dump` de Railway → restore en su Postgres). Ojo: el directorio
   aprovisionará usuarios, pero **vehículos, accesos, infracciones, etc. son tuyos** y hay
   que llevarlos.
4. Apuntar el dominio universitario (ej. `control-vehicular.uagrm.edu.bo`) → actualizar
   `ALLOWED_HOSTS` y `CORS`.
5. Recién entonces **dar de baja Railway/Vercel** para dejar de pagar.

### Consideraciones de su infraestructura

- Probablemente **on-premise / detrás del firewall** → el directorio queda accesible
  internamente (bueno), pero email/WhatsApp (Brevo/Fonnte) necesitan **salida a internet** —
  confirmarlo.
- **Residencia de datos**: el PII de estudiantes pasa a infraestructura de la universidad —
  mejor para privacidad/cumplimiento, y probablemente la razón del pedido.
- **Backups**: ahora la responsabilidad de respaldar la BD es propia, ya no de Railway.
- Celery/Redis/Channels deben correr como servicios en su infra (el `docker-compose` ya los
  define).

---

## PARTE 4 — Lo que hay que CONFIRMAR con la universidad (antes de implementar)

1. **¿La llave es solo para leer datos (forma A) o también valida el inicio de sesión
   (forma B / SSO)?** → decide si las contraseñas locales se quedan o se van.
2. **¿Qué datos trae cada persona?** (CI, nombre, email... ¿y dice si es estudiante/
   docente/administrativo? ¿facultad/carrera/cargo?).
3. **¿Cómo se entrega la llave al pedir los datos?** (normalmente en una cabecera
   `Authorization`, pero confirmar el formato exacto y la URL).
4. **¿La API marca bajas** (egresados, desvinculados) o solo altas?
5. **Servidor:** ¿VM con Docker? ¿Postgres gestionado? ¿Tiene salida a internet para
   email/WhatsApp?

---

## Plan de implementación tentativo (cuando lleguen las respuestas)

1. **Feature-flag** para desactivar el auto-registro de roles federados sin romper nada
   (permite volver atrás durante la transición).
2. **Adaptador de aprovisionamiento** (JIT en login + sync batch con Celery) usando la llave.
3. **Campos del directorio en solo-lectura** en perfil; dejar editables solo los locales
   (teléfono, WhatsApp, foto, 2FA).
4. **Asignación automática de rol** desde el dato del directorio.
5. (Si forma B) **Delegar autenticación**; conservar throttling/auditoría/JWT.
6. **Despliegue paralelo** en servidor universitario + migración de datos + cutover.

> Guardia, Administrador y todo el módulo de Visitantes **permanecen intactos** — son
> identidades que el directorio académico no cubre.
