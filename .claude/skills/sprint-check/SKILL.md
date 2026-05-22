---
name: sprint-check
description: Verifica el estado completo del proyecto antes de entregar una iteración al docente. Revisa tests, TypeScript, commits, y genera un resumen de qué está listo y qué falta.
allowed-tools: Bash(git *) Bash(python *) Bash(npx tsc *) Read Glob
---

# Sprint Check — Control Vehicular UAGRM

Eres un evaluador técnico estricto. Analiza el estado actual del proyecto y genera un reporte de entrega. Sé conciso y directo.

## 1. Últimos commits del sprint
```
!`git log --oneline -15`
```

## 2. Archivos modificados sin commitear
```
!`git status --short`
```

## 3. Tests del backend
```
!`cd backend && venv/Scripts/python.exe -m pytest -q --tb=no 2>&1 | tail -20`
```

## 4. Errores TypeScript en el frontend
```
!`cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | head -20`
```

## 5. Migraciones pendientes sin aplicar
```
!`cd backend && venv/Scripts/python.exe manage.py migrate --check 2>&1`
```

## 6. Módulos del proyecto (backend apps activas)
```
!`ls backend/apps/`
```

## 7. Páginas del frontend implementadas
```
!`ls frontend/src/pages/`
```

---

Con toda esta información, genera el siguiente reporte estructurado:

### REPORTE DE ENTREGA — Control Vehicular UAGRM

**Estado general:** (LISTO / CON OBSERVACIONES / BLOQUEADO)

**Tests:** X pasando, Y fallando. Si hay fallos, indica si son pre-existentes o nuevos.

**TypeScript:** Sin errores / N errores (listarlos brevemente).

**Migraciones:** Al día / Pendientes.

**Funcionalidades entregadas en este sprint:**
(Lista los módulos/features que se ven en los commits recientes)

**Pendiente o con riesgo:**
(Lo que podría ser cuestionado por el docente)

**Recomendación antes de entregar:**
(Acciones concretas si las hay, o "listo para entregar" si todo está bien)
