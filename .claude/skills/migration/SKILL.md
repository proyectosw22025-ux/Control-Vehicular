---
name: migration
description: Crea una migración Django de forma segura para el proyecto Control Vehicular. Verifica que no rompe tests existentes y que aplica correctamente. Úsalo cuando necesites agregar campos, modelos o cambios en la base de datos.
allowed-tools: Bash(python *) Bash(cd backend *) Read Glob Edit Write
arguments: [descripcion]
---

# Migration — Control Vehicular UAGRM

Eres un experto en Django. Ayuda al usuario a crear una migración segura para este proyecto.

## Estado actual de migraciones
```
!`cd backend && venv/Scripts/python.exe manage.py showmigrations --list 2>&1 | grep -v "^$"`
```

## Modelos actuales de la app relevante
```
!`ls backend/apps/`
```

## Tests que deben seguir pasando
```
!`cd backend && venv/Scripts/python.exe -m pytest --co -q 2>&1 | grep "test session\|collected\|error" | head -5`
```

---

El usuario quiere crear una migración para: **$descripcion**

Sigue este proceso paso a paso:

### Paso 1 — Planificación
Antes de escribir código, explica:
- Qué app de Django se modifica (`backend/apps/<nombre>/`)
- Qué campos o modelos se agregan/modifican
- Si el campo es nullable o required (y por qué importa para datos existentes)
- Si necesita datos semilla (RunPython)

### Paso 2 — Modificar el modelo
Edita `backend/apps/<app>/models.py` con el cambio solicitado.
- Campos nuevos siempre con `blank=True, default=...` o `null=True` para no romper registros existentes
- Agrega `help_text` descriptivo

### Paso 3 — Crear la migración
```bash
cd backend && venv/Scripts/python.exe manage.py makemigrations <app> --name <nombre_descriptivo>
```

### Paso 4 — Revisar el archivo generado
Lee el archivo de migración creado y verifica que:
- Las dependencias son correctas
- No hay operaciones destructivas inesperadas
- Si tiene RunPython, la función reverse está implementada

### Paso 5 — Actualizar el schema GraphQL
Si el campo nuevo debe exponerse en la API, actualiza:
- `VisitaType` / `VisitanteType` / etc. en `backend/apps/<app>/schema.py`
- El Input correspondiente si el campo es escribible

### Paso 6 — Aplicar y verificar
```bash
cd backend && venv/Scripts/python.exe manage.py migrate <app> --check
cd backend && venv/Scripts/python.exe manage.py migrate <app>
```

### Paso 7 — Correr tests
```bash
cd backend && venv/Scripts/python.exe -m pytest apps/<app>/tests/ -v --tb=short 2>&1 | tail -20
```

Si algún test falla, diagnostica la causa y corrígela antes de continuar.
