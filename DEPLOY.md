# Guía de Despliegue — Sistema Control Vehicular UAGRM

## Opción A — Correr localmente con Docker (demo al docente)

### Requisitos
- Docker Desktop instalado y corriendo
- Archivo `.env` creado a partir de `.env.example`

### Pasos

```bash
# 1. Copiar el archivo de ejemplo y editar las variables
cp .env.example .env
# Edita .env con tus valores (DB_PASSWORD, SECRET_KEY, etc.)

# 2. Levantar todos los servicios
docker compose up --build

# 3. Acceder al sistema
#    Frontend:  http://localhost
#    GraphQL:   http://localhost/graphql/
#    Admin:     http://localhost/admin/
```

### Comandos útiles
```bash
docker compose up --build -d      # levantar en segundo plano
docker compose logs -f backend    # ver logs del backend
docker compose logs -f celery_worker
docker compose down               # apagar todo
docker compose down -v            # apagar y borrar volúmenes (BD incluida)
```

---

## Opción B — Deploy en la nube (URL pública gratuita)

### Arquitectura
- **Backend** → Railway (Django + Daphne + Celery)
- **Frontend** → Vercel (React build estático)
- **BD + Redis** → addons de Railway

---

## B1 — Deploy del Backend en Railway

### 1. Crear cuenta y proyecto
1. Ir a [railway.app](https://railway.app) e iniciar sesión con GitHub
2. Clic en **New Project → Deploy from GitHub repo**
3. Seleccionar el repositorio del proyecto

### 2. Agregar servicios de infraestructura
Dentro del proyecto en Railway:
- Clic en **+ New → Database → PostgreSQL** → se crea automáticamente
- Clic en **+ New → Database → Redis** → se crea automáticamente

### 3. Configurar el servicio backend
Railway detecta el `backend/Dockerfile` automáticamente. Configurar:

**Root Directory:** `backend`

**Variables de entorno** (en la pestaña Variables del servicio):
```
DJANGO_SETTINGS_MODULE=config.settings.production
SECRET_KEY=<generar una clave larga aleatoria>
ALLOWED_HOSTS=<tu-app>.up.railway.app
CORS_ALLOWED_ORIGINS=https://<tu-frontend>.vercel.app
DB_NAME=railway
DB_USER=postgres
DB_PASSWORD=<copiar de las variables de PostgreSQL en Railway>
DB_HOST=<copiar HOST de PostgreSQL en Railway>
DB_PORT=5432
REDIS_URL=<copiar URL de Redis en Railway>
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=<tu-correo>@gmail.com
EMAIL_HOST_PASSWORD=<contraseña de aplicación de Google>
DEFAULT_FROM_EMAIL=Parqueo UAGRM <noreply@uagrm.edu.bo>
SENTRY_DSN=<opcional — de sentry.io>
```

> **Nota:** Los valores de DB y Redis los encuentras en las pestañas de cada servicio
> en Railway → sección "Connect" → Variables.

### 4. Agregar servicio Celery Worker
- Clic en **+ New → GitHub Repo** (mismo repo)
- Root Directory: `backend`
- **Start Command:** `celery -A celery_app worker -l info --concurrency=2`
- Agregar las mismas variables de entorno que el backend

### 5. Agregar servicio Celery Beat
- Clic en **+ New → GitHub Repo** (mismo repo)
- Root Directory: `backend`
- **Start Command:** `celery -A celery_app beat -l info`
- Agregar las mismas variables de entorno

### 6. Obtener la URL del backend
En el servicio backend → pestaña **Settings → Networking → Generate Domain**
Guardar esa URL (ej: `https://control-vehicular-backend.up.railway.app`)

---

## B2 — Deploy del Frontend en Vercel

### 1. Crear cuenta y proyecto
1. Ir a [vercel.com](https://vercel.com) e iniciar sesión con GitHub
2. Clic en **Add New → Project**
3. Importar el repositorio

### 2. Configurar el proyecto
- **Framework Preset:** Vite
- **Root Directory:** `frontend`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

### 3. Variables de entorno en Vercel
En la sección **Environment Variables**:
```
VITE_GRAPHQL_URI=https://<tu-backend>.up.railway.app/graphql/
VITE_WS_URI=wss://<tu-backend>.up.railway.app/ws/
VITE_SENTRY_DSN=<opcional>
```

> **Importante:** El frontend actualmente tiene la URL del backend hardcodeada
> en `src/apollo/client.ts`. Ver sección "Preparar el frontend para producción".

### 4. Preparar el frontend para producción
Actualizar `frontend/src/apollo/client.ts` para leer la URL del backend desde
variables de entorno:

```ts
const GRAPHQL_URI = import.meta.env.VITE_GRAPHQL_URI ?? 'http://127.0.0.1:8000/graphql/'
```

Y el WebSocket en `frontend/src/hooks/useNotificaciones.ts`:
```ts
const WS_URI = import.meta.env.VITE_WS_URI ?? 'ws://localhost:8000/ws/notificaciones/'
```

---

## B3 — Configurar GitHub Actions

El pipeline CI ya está en `.github/workflows/ci.yml` y corre automáticamente
en cada push. Para que funcione correctamente agregar en GitHub:

**Repositorio → Settings → Secrets and variables → Actions:**
```
SECRET_KEY=<misma clave que en Railway>
```
(Las demás variables usan valores de prueba definidos en el propio workflow)

---

## B4 — Sentry (opcional pero recomendado)

1. Ir a [sentry.io](https://sentry.io) → crear cuenta gratuita
2. **Create Project → Django** → copiar el DSN → pegarlo en Railway como `SENTRY_DSN`
3. **Create Project → React** → copiar el DSN → pegarlo en Vercel como `VITE_SENTRY_DSN`

---

## Checklist final antes de la demo

- [ ] `docker compose up --build` corre sin errores localmente
- [ ] Frontend accesible en `http://localhost`
- [ ] Login funciona, notificaciones WebSocket llegan en tiempo real
- [ ] GitHub Actions muestra check verde en el último commit
- [ ] URL pública de Railway responde en `/graphql/`
- [ ] URL pública de Vercel carga el frontend correctamente
