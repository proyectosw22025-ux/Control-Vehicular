---
name: nuevo-modulo
description: Crea la estructura completa de un nuevo módulo para el sistema Control Vehicular UAGRM — backend (modelo, migration, schema GraphQL, tests) + frontend (query, mutation, página, ruta, nav item). Úsalo cuando el docente pida una funcionalidad completamente nueva.
allowed-tools: Bash(python *) Bash(git *) Read Glob Edit Write
arguments: [nombre, descripcion]
---

# Nuevo Módulo — Control Vehicular UAGRM

Implementa el módulo **"$nombre"** — $descripcion

Eres un desarrollador senior de este proyecto. Conoces la arquitectura completa:
- Backend: Django 5.2 + Strawberry GraphQL + PostgreSQL + Celery
- Frontend: React 18 + TypeScript + Vite + Apollo Client + Tailwind CSS
- Tests: pytest con fixtures en conftest.py

## Contexto del proyecto actual
```
!`ls backend/apps/`
```
```
!`ls frontend/src/pages/`
```
```
!`cd backend && venv/Scripts/python.exe manage.py showmigrations --list 2>&1 | grep "\[X\]" | tail -5`
```

---

## PLAN DE IMPLEMENTACIÓN

Antes de escribir código, presenta un plan de 5 líneas máximo con:
- Qué modelos se crean
- Qué endpoints GraphQL (queries + mutations)
- Qué vista frontend (tabs, acciones principales)
- Qué roles pueden acceder
- Si necesita Celery tasks o notificaciones

Espera confirmación implícita del contexto antes de implementar.

---

## PASO 1 — Backend: Modelo Django

Crea `backend/apps/$nombre/models.py` siguiendo el patrón de `apps/visitantes/models.py`:
- Campos con `help_text` descriptivos
- `created_at = DateTimeField(auto_now_add=True)`
- `Meta.db_table` con nombre explícito
- `__str__` descriptivo

## PASO 2 — Migration inicial

```bash
cd backend && venv/Scripts/python.exe manage.py makemigrations $nombre --name initial
```

Si necesita datos semilla, crea `0002_seed_datos.py` con `RunPython`.

## PASO 3 — Schema Strawberry GraphQL

Crea `backend/apps/$nombre/schema.py` siguiendo el patrón de `apps/multas/schema.py`:

```python
# Types: @strawberry.type — campos expuestos en la API
# Inputs: @strawberry.input — datos que llegan del frontend
# Query class con @strawberry.field — con auth checks
# Mutation class con @strawberry.mutation — con auth checks + log_audit
```

Reglas:
- Toda query/mutation verifica `user.is_authenticated`
- Operaciones sensibles usan `tiene_rol(user, "Administrador")`
- Mutaciones destructivas usan `transaction.atomic()`
- Notificaciones con `enviar_notificacion()` en hilo separado

## PASO 4 — Registrar en schema principal

Edita `backend/schema.py` para agregar las nuevas queries y mutations.

## PASO 5 — Tests

Crea `backend/apps/$nombre/tests/__init__.py` y `test_$nombre.py`:
- Usa fixtures de `conftest.py` (`gql_usuario_normal`, `gql_admin`, `gql_guardia`)
- Mínimo 6 tests: happy path, error de auth, error de validación, casos borde
- Patrón: `graphql(client, QUERY_STRING, variables)`

```bash
cd backend && venv/Scripts/python.exe -m pytest apps/$nombre/tests/ -v 2>&1 | tail -20
```

Todos los tests deben pasar antes de continuar.

## PASO 6 — Frontend: GraphQL queries y mutations

Crea `frontend/src/graphql/queries/$nombre.ts` y `mutations/$nombre.ts`:
- Usa los campos que expone el schema GraphQL
- Incluye todos los campos necesarios para la UI

## PASO 7 — Página React

Crea `frontend/src/pages/$nombre.tsx` siguiendo el patrón de `Multas.tsx` o `Visitantes.tsx`:
- Importa `useAuth`, `useToast`, `ToastContainer`
- Tabs para separar funcionalidades
- Manejo de loading/error states
- Acciones diferenciadas por rol (`esAdmin`, `esGuardia`)
- `<ToastContainer toasts={toast.toasts} onClose={toast.cerrar} />`

## PASO 8 — Ruta y navegación

En `frontend/src/App.tsx`:
```tsx
import $nombre from './pages/$nombre'
// dentro de <Routes>:
<Route path="$nombre" element={<$nombre />} />
```

En `frontend/src/components/Layout.tsx`:
```tsx
{ to: '/$nombre', label: '...', icon: IconName, roles: ['...'] },
```

## PASO 9 — Verificación final

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep "error TS"
cd backend && venv/Scripts/python.exe -m pytest apps/$nombre/tests/ -q 2>&1 | tail -10
git diff --stat
```

Si hay errores TypeScript, corrígelos antes de terminar.

## PASO 10 — Resumen del módulo implementado

Al terminar, presenta:
- Qué modelos se crearon y sus campos principales
- Qué queries y mutations están disponibles
- Qué roles pueden acceder a qué funciones
- Cómo se integra con módulos existentes (si aplica)
