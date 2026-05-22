---
name: tests-rapidos
description: Corre los tests del backend relevantes a los cambios recientes y reporta resultados. Ideal para verificar que nada se rompió después de un cambio. Más rápido que correr toda la suite.
allowed-tools: Bash(git *) Bash(python *) Read
---

# Tests Rápidos — Control Vehicular UAGRM

## Archivos modificados recientemente
```
!`git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only`
```

## Estado actual de los tests (solo fallos y resumen)
```
!`cd backend && venv/Scripts/python.exe -m pytest -q --tb=short 2>&1 | tail -30`
```

---

Analiza los resultados y responde:

### Tests — Resultado

**Resumen:** X pasando / Y fallando / Z errores

**Si hay fallos:**
Para cada test fallido, indica:
1. **Nombre del test** — qué verifica
2. **Error exacto** — la línea del mensaje de error
3. **Causa probable** — ¿es un cambio reciente que lo rompió o era pre-existente?
4. **Acción recomendada** — corregir el código, corregir el test, o ignorar si es pre-existente conocido

**Tests pre-existentes conocidos con fallo:**
- `test_alertas_anomalias.py` — falla por ordering de BD, no es una regresión

**Si todos pasan:**
"✅ Todos los tests pasan. El cambio es seguro."

**¿Hay tests faltantes?**
Si los cambios recientes modifican lógica de negocio importante que no tiene test, sugiere qué debería testearse.
