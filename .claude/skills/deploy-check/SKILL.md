---
name: deploy-check
description: Verifica que el proyecto está listo para hacer push/deploy a Railway (backend) y Vercel (frontend). Detecta errores de TypeScript, migraciones no aplicadas, tests fallando, y archivos sensibles antes de pushear.
allowed-tools: Bash(git *) Bash(python *) Bash(npx *) Read Glob
---

# Deploy Check — Control Vehicular UAGRM

Eres un DevOps senior. Verifica que el proyecto está listo para deploy antes de pushear.

## 1. Commits pendientes de push
```
!`git log --oneline origin/master..HEAD 2>/dev/null || echo "Sin remote configurado"`
```

## 2. Archivos sin commitear (no deben haber al deployar)
```
!`git status --short`
```

## 3. TypeScript — errores de build en Vercel
```
!`cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | head -15`
```

## 4. Migraciones — ¿hay alguna sin aplicar en Railway?
```
!`cd backend && venv/Scripts/python.exe manage.py showmigrations --list 2>&1 | grep "\[ \]"`
```

## 5. Tests del backend
```
!`cd backend && venv/Scripts/python.exe -m pytest -q --tb=no 2>&1 | tail -5`
```

## 6. Variables de entorno críticas referenciadas en código
```
!`grep -r "VITE_" frontend/src --include="*.ts" --include="*.tsx" -h | grep -oP "VITE_\w+" | sort -u`
```

## 7. Archivos sensibles que NO deben ir al repo
```
!`git diff --name-only HEAD | grep -E "\.env|secret|credentials|private" || echo "Ninguno detectado"`
```

## 8. DEPLOY.md — instrucciones del proyecto
```
!`head -50 DEPLOY.md 2>/dev/null || echo "DEPLOY.md no encontrado"`
```

---

Con toda esta información, genera el reporte:

### DEPLOY CHECK — Control Vehicular UAGRM

**Estado:** ✅ LISTO PARA DEPLOY / ⚠️ CON ADVERTENCIAS / ❌ BLOQUEADO

---

**TypeScript (Vercel):**
- Sin errores → ✅
- Con errores → ❌ Lista cada error con su archivo y línea

**Migraciones (Railway):**
- Al día → ✅
- Pendientes → ⚠️ Lista las migraciones que se aplicarán en el próximo deploy

**Tests:**
- Todos pasan → ✅
- Fallos nuevos → ❌ Indica cuáles son regresiones vs pre-existentes

**Archivos sin commitear:**
- Ninguno → ✅
- Hay cambios → ⚠️ Lista qué archivos quedan fuera del deploy

**Seguridad:**
- Sin archivos sensibles → ✅
- Detectó algo → ❌ Alerta inmediata

---

**Pasos antes de hacer push:**
(Lista numerada de acciones concretas, o "Ninguno — listo para `git push origin master`")

**Variables de entorno necesarias en Railway/Vercel:**
(Lista las VITE_* y Django settings críticos que deben estar configurados)
