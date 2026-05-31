# Mejoras del Sistema de Control Vehicular — UAGRM
**Universidad Autónoma "Gabriel René Moreno" · Santa Cruz, Bolivia**
**Documento de especificación técnica y de negocio · Iteración siguiente**

---

## Contexto del sistema actual

El sistema controla el acceso vehicular al campus principal de la UAGRM. Gestiona vehículos registrados de estudiantes, docentes y personal administrativo. El flujo central es: el vehículo llega → el guardia escanea el QR → el sistema registra la entrada → el propietario recibe orientación de parqueo → el vehículo sale y el sistema cierra la sesión automáticamente.

**Stack**: Django 5.2 + Strawberry GraphQL + PostgreSQL + Celery + Redis + Django Channels · React 18 + TypeScript + Apollo Client + Leaflet + OSRM · Railway (backend) + Vercel (frontend).

**Módulos existentes**: Control de Acceso (QR/OCR/Manual), Vehículos, Guía de Parqueo, Parqueos, Multas, Visitantes, Notificaciones WebSocket, Rastreo en Vivo, Mi Pase QR, Mis Accesos, Dashboard, Auditoría.

---

## Diagnóstico — Problemas de negocio identificados

Antes de detallar las mejoras, se enumeran los problemas reales que motivan cada una:

| # | Problema | Impacto |
|---|----------|---------|
| P1 | Los cupos de parqueo ("25 libres") son valores estáticos — no reflejan sesiones activas reales | Alto: la guía envía vehículos a zonas saturadas |
| P2 | El visitante pre-registrado llega sin comprobante — el guardia lo busca manualmente por CI | Alto: no reduce el tiempo en garita, que era el objetivo |
| P3 | `AlertaAcceso` se genera en BD pero el guardia no la ve en tiempo real | Alto: un vehículo robado o sancionado puede pasar sin alerta visual/sonora |
| P4 | Proveedores, servicios y ambulancias no tienen flujo — el guardia los anota en papel | Medio: rompe la promesa de digitalización total |
| P5 | No existe página pública de disponibilidad — el estudiante descubre que no hay parqueo después de entrar | Medio: genera tráfico interno innecesario y frustración |
| P6 | El sistema no conoce el horario de operación de la universidad ni de cada portería | Bajo-Medio: accesos posibles a las 3am sin ninguna restricción |

---

## Mejora 1 — Cupos de Parqueo Dinámicos con Alertas de Saturación

### Problema de negocio
El módulo de Guía de Parqueo muestra espacios disponibles con valores hardcodeados (`libres: 25`). Estos no cambian cuando un vehículo ocupa un espacio. Un estudiante puede recibir orientación hacia la Zona B y encontrarla completamente saturada porque el sistema no consulta las sesiones de parqueo activas.

### Lógica de negocio correcta
```
Zona B tiene capacidad total = 80 espacios
  → SesionParqueo activas en Zona B = 71
  → libres reales = 80 - 71 = 9
  → estado = "limitado" (< 20% libre)
  → acción: notificar, cambiar color, sugerir alternativa
```

### Qué construir

**Backend — nuevo query GraphQL `disponibilidad_zonas`**
- Retorna por zona: `{ id, nombre, total, activas, libres, porcentaje_ocupacion, estado }`
- `estado`: `"disponible"` (> 40% libre) | `"limitado"` (10-40%) | `"saturado"` (< 10%) | `"lleno"` (0)
- Se calcula en tiempo real con `SesionParqueo.objects.filter(zona=zona, estado='activa').count()`
- Cuando `libres` cambia, hace broadcast via Django Channels al grupo `parqueo_disponibilidad`

**Backend — Celery task de alerta de saturación**
- Se ejecuta cada vez que una sesión abre o cierra (signal post_save)
- Si una zona pasa a `"saturado"` o `"lleno"`: envía notificación WebSocket a todos los usuarios en `/parqueo-demo`
- Si la zona se recupera (vehículo sale y queda disponible): envía notificación de liberación

**Frontend — ParqueoDemo.tsx**
- Las zonas se cargan desde `disponibilidad_zonas` en lugar de `ZONAS_DEFAULT` hardcodeado
- El color del badge cambia según estado: verde / amarillo / rojo
- Si la zona elegida está `"lleno"`, el sistema automáticamente sugiere la siguiente zona con espacios
- Toast: _"Zona A acaba de llenarse — recomendamos Zona C con 12 espacios disponibles"_
- El número "X libres" se actualiza en tiempo real vía WebSocket sin recargar la página

**Frontend — nueva página pública `/disponibilidad`** _(ver Mejora 5)_

### Modelos afectados
- `SesionParqueo` (consulta de activas por zona)
- `EspacioParqueo` (capacidad total por zona)
- `Zona` (agregar campo calculado o cache `libres_actual`)

### Reglas de negocio
- Un espacio marcado como `"mantenimiento"` o `"reservado"` NO cuenta como libre aunque no tenga sesión activa
- La capacidad de las zonas Docente/Admin se consulta separada de General para mantener la categorización por rol
- Al llegar a 0 libres, la zona desaparece de la lista de opciones en la guía (no se puede seleccionar)

---

## Mejora 2 — QR Entregable para Visitantes (Email + Página de Confirmación)

### Problema de negocio
El sistema tiene un flujo de pre-registro para visitantes en `/register` (dos pasos: datos personales + destino/placa). Pero cuando el visitante llega a la garita, no tiene ningún documento ni código que el guardia pueda escanear rápidamente. El guardia sigue buscando por CI manualmente, lo que no reduce el tiempo de procesamiento.

### Lógica de negocio correcta
```
Visitante completa pre-registro en /register
  → Sistema genera PaseTemporal con código único
  → Sistema envía email con QR del código
  → Visitante llega a portería y muestra QR en celular
  → Guardia escanea el QR igual que un QR vehicular
  → Sistema muestra todos los datos pre-llenados
  → Guardia confirma con un clic → entrada registrada en < 10 segundos
```

### Qué construir

**Backend — al completar `pre_registrar_visitante`**
- Crear automáticamente un `PaseTemporal` vinculado al visitante (no a un vehículo)
  - `valido_desde`: fecha de la visita (del formulario o "hoy")
  - `valido_hasta`: fin del día de la visita
  - `usos_max`: 1 (un ingreso)
  - `codigo`: UUID hex de 12 caracteres en mayúsculas
- Generar QR del código usando la librería `qrcode` (ya instalada)
- Enviar email con Resend API (ya configurada) con el QR embebido como imagen inline
  - Asunto: _"Tu pase de acceso — UAGRM · [fecha]"_
  - Cuerpo: nombre del visitante, destino, fecha, QR en alta resolución, instrucción "Muestra este código al guardia"

**Backend — actualizar `validar_pase` / `registrar_acceso`**
- El guardia puede escanear el QR del visitante desde el panel de acceso
- El sistema reconoce que es un `PaseTemporal` de visitante (no de vehículo)
- Retorna datos: nombre, CI, destino, placa esperada, hora de llegada
- Guarda `RegistroAcceso` con `pase_temporal` FK y `vehiculo = null` (visitante sin vehículo propio registrado)

**Frontend — página `/visita/:codigo`**
- Página pública de confirmación del pase (accesible sin login)
- Muestra estado: "Válido para hoy · [nombre] · [destino]" o "Ya usado" o "Vencido"
- El QR en el email apunta a esta página más el QR de escaneo
- Útil para que el visitante verifique su pase antes de llegar

**Frontend — panel del guardia**
- En el tab de "Visitantes", agregar botón "Escanear pase de visitante"
- Abre el QrScanner y procesa el código del pase temporal
- Muestra modal con todos los datos del visitante antes de confirmar la entrada

### Reglas de negocio
- Si el visitante no tiene email, el guardia puede imprimir el QR desde el panel de Visitantes o mostrarlo en pantalla
- El pase vence a las 23:00 del día de la visita, no al día siguiente
- Si el visitante llega en su propio vehículo, el sistema cruza la placa con la `placa_habitual` del pre-registro para sugerir la coincidencia al guardia
- Un pase ya usado no puede ser reutilizado aunque el visitante intente entrar de nuevo (guardado en `PaseTemporal.usado = True`)

---

## Mejora 3 — Panel de Alertas en Tiempo Real para el Guardia

### Problema de negocio
El modelo `AlertaAcceso` registra anomalías: frecuencia excesiva de accesos, vehículos sancionados con acceso reciente, placas similares (posible clonación). Un Celery task las genera diariamente. Pero el panel del guardia no muestra estas alertas en ningún lugar visible. El guardia que opera la portería tiene cero visibilidad sobre vehículos problemáticos, lo que es un fallo de seguridad grave.

### Lógica de negocio correcta
```
Vehículo ABC-123 (sancionado) llega a portería Norte a las 9am
  → Guardia escanea QR
  → ANTES de mostrar "Entrada registrada":
     → Sistema consulta AlertaAcceso activas para ese vehículo
     → Encuentra: "Vehículo sancionado — Multa #47 sin pagar"
     → Modal de advertencia: "⚠ Este vehículo tiene infracciones activas"
     → Guardia decide: bloquear o permitir con observación
```

También:
```
Celery genera alerta: "Vehículo XYZ-789 ingresó 8 veces en 2 horas"
  → Canal WebSocket notificaciones_guardia
  → Badge rojo en panel con sonido de alerta
  → El guardia ve la placa y puede verificar en el mapa de rastreo
```

### Qué construir

**Backend — nuevo query `alertas_activas_panel`**
- Retorna alertas no revisadas de las últimas 24 horas
- Ordenadas por severidad: `critica` → `advertencia` → `info`
- Incluye `vehiculo.placa`, `tipo_anomalia`, `descripcion`, `fecha`
- Se genera el broadcast vía Django Channels al grupo `notificaciones_guardia_<id>` cuando se crea una alerta nueva

**Backend — verificación de alertas en `registrar_acceso`**
- Antes de registrar la entrada, consultar `AlertaAcceso.objects.filter(vehiculo=vehiculo, revisada=False)`
- Si hay alertas `critica`: incluir en el response un campo `alertas_activas: [...]`
- El frontend decide si bloquear o solo advertir según la severidad

**Backend — nuevo Celery task `detectar_alertas_en_tiempo_real`**
- Se ejecuta cada vez que se registra un acceso (signal post_save en RegistroAcceso)
- Verifica: ¿el vehículo ingresó más de 3 veces en las últimas 2 horas? → alerta `frecuencia_excesiva`
- Verifica: ¿el vehículo tiene multas con estado `pendiente` o `apelada`? → alerta `vehiculo_sancionado`
- Emite broadcast inmediato si detecta anomalía (no esperar al task diario)

**Frontend — GuardiaDashboard.tsx**
- Nueva sección "Alertas" con badge de conteo en rojo en el header del panel
- Lista de alertas activas con: placa, tipo, descripción corta, hace cuánto tiempo
- Botón "Marcar revisada" que llama a `marcar_alerta_revisada`
- Cuando llega alerta nueva via WebSocket: sonido usando `new Audio('/alert.mp3').play()` + banner animado
- Al registrar acceso de vehículo con alerta crítica: modal de confirmación con detalle completo antes de proceder

**Frontend — modal de advertencia en escaneo QR**
```
[⚠ ADVERTENCIA DE SEGURIDAD]

Vehículo: ABC-123 · Honda Civic 2019
Propietario: Juan Pérez Rodríguez

Este vehículo tiene infracciones activas:
  • Multa #47: Estacionamiento indebido — Sin pagar
  • Acceso frecuencia excesiva — 5 ingresos en 3 horas

[ Bloquear entrada ]   [ Permitir con observación ]
```

### Reglas de negocio
- Alerta `critica` → mostrar modal bloqueante; el guardia DEBE tomar una decisión explícita
- Alerta `advertencia` → mostrar toast no bloqueante; la entrada se registra normalmente
- Alerta `info` → solo visible en la lista de alertas, no interrumpe el flujo
- Al elegir "Permitir con observación", el sistema guarda una `observacion` automática en el `RegistroAcceso`: _"Entrada permitida con alerta activa: [descripción]"_
- El administrador puede configurar si las alertas `critica` son bloqueantes o solo avisos

---

## Mejora 4 — Acceso Temporal para Proveedores y Vehículos Externos

### Problema de negocio
La universidad recibe diariamente vehículos que no están en el sistema: camiones de mantenimiento, proveedores de cafetería, servicios de limpieza, ambulancias, visitantes en vehículo propio sin pre-registro. El guardia los anota en un cuaderno de papel, que es exactamente lo que el sistema prometió reemplazar.

### Lógica de negocio correcta
```
Llega un camión de proveedor (no registrado en el sistema)
  → Guardia abre "Acceso Temporal" en su panel
  → Ingresa: placa + tipo (proveedor / mantenimiento / emergencia / otro) + destino + tiempo máximo
  → Sistema registra el vehículo temporal con estado "temporal"
  → Genera un PaseTemporal de N horas
  → El vehículo aparece en el rastreo con icono diferenciado (camión)
  → Al vencer el tiempo: alerta automática si el vehículo no ha salido
  → Al salir: guardia registra salida manual por placa → pase se invalida
```

### Qué construir

**Backend — nuevo modelo `VehiculoTemporal`** (o reutilizar `PaseTemporal` con extensión)
```python
class VehiculoTemporal(models.Model):
    placa         = CharField(max_length=10)
    tipo          = CharField(choices=[proveedor, mantenimiento, emergencia, visitante, otro])
    destino       = CharField(max_length=150)   # edificio o departamento
    responsable   = CharField(max_length=100)   # nombre de quien autoriza
    hora_ingreso  = DateTimeField(auto_now_add=True)
    hora_limite   = DateTimeField()             # hasta cuándo puede estar
    hora_salida   = DateTimeField(null=True)    # se llena al salir
    registrado_por = FK(Usuario)
    observacion   = TextField(blank=True)
    activo        = BooleanField(default=True)
```

**Backend — mutación `registrar_acceso_temporal`**
- Solo disponible para Guardia y Administrador
- Crea `VehiculoTemporal` + `RegistroAcceso` con `metodo_acceso = "temporal"`
- Lanza Celery task `vigilar_vencimiento_temporal` con countdown hasta `hora_limite`
- Broadcast al grupo `rastreo_campus` para que aparezca en el mapa con tipo "proveedor"

**Backend — Celery task `vigilar_vencimiento_temporal`**
- Se ejecuta cuando llega la `hora_limite`
- Si `activo = True` (no ha salido): crear `AlertaAcceso` tipo `vehiculo_temporal_vencido` con severidad `advertencia`
- Notificar al guardia de turno con WebSocket
- Si pasan 30 minutos adicionales sin salida: escalar a severidad `critica`

**Backend — mutación `registrar_salida_temporal`**
- El guardia busca por placa (sin QR porque el vehículo no tiene)
- Marca `activo = False`, registra `hora_salida`
- Crea `RegistroAcceso` con `tipo = "salida"` y `metodo_acceso = "temporal"`
- Broadcast `vehiculo_salio` al canal de rastreo

**Frontend — GuardiaDashboard.tsx: nuevo tab "Temporales"**
- Formulario rápido: placa + tipo + destino + duración (1h / 4h / día)
- Lista de vehículos temporales actualmente en campus con cronómetro regresivo
- Botón "Registrar salida" por cada uno
- Badge rojo cuando el tiempo está por vencerse (< 15 min)
- Diferenciación visual en el rastreo en vivo: icono 🚛 para proveedores

### Reglas de negocio
- Solo guardias y admin pueden registrar acceso temporal (no disponible para estudiantes)
- Una placa temporal no puede tener más de un acceso activo simultáneo
- Los accesos temporales se incluyen en los reportes de acceso pero con categoría separada "temporal"
- Si el vehículo temporal coincide con una placa registrada en el sistema (mismo dígitos), el sistema advierte al guardia
- Tiempo máximo configurable por el admin (default: 8 horas)

---

## Mejora 5 — Semáforo Público de Disponibilidad de Parqueo

### Problema de negocio
Un estudiante o docente entra al campus sin saber si hay espacio disponible en su zona asignada. Esto genera: (a) vehículos circulando por el campus buscando parqueo, (b) ocupación de zonas no asignadas, (c) bloqueo de vías internas. La información existe en el sistema pero está detrás de un login.

### Lógica de negocio correcta
```
Estudiante viene en su vehículo camino a la universidad
  → Escanea el QR físico pegado en la entrada del campus
  → Abre /disponibilidad en su celular SIN iniciar sesión
  → Ve en tiempo real:
      🟢 Zona A — Docentes/Admin    8 libres
      🟡 Zona B — General          3 libres  ← "Limitado"
      🔴 Zona C — General          0 libres  ← "Sin espacio"
  → Decide si entrar o buscar parqueo externo antes de ingresar al campus
```

### Qué construir

**Backend — query pública `disponibilidad_parqueo_publica`**
- No requiere autenticación (resolver sin `@login_required`)
- Retorna lista de zonas con: nombre, color institucional, total, libres, estado, última actualización
- Los datos sensibles (sesiones individuales, propietarios) NO se exponen
- Responde en < 200ms (cache de 30 segundos en Redis para no golpear la BD en cada request)
- Strawberry: campo en `Query` sin verificación de usuario

**Backend — WebSocket grupo `disponibilidad_publica`**
- Cuando cambia el estado de una zona (sesión abre/cierra), hace broadcast a este grupo
- Los clientes en `/disponibilidad` se actualizan sin recargar

**Frontend — nueva página `/disponibilidad`**
- Sin layout de la app (no requiere login, no muestra sidebar)
- Logo UAGRM + título "Disponibilidad de Parqueo — Campus"
- Tarjetas grandes por zona con:
  - Color de fondo dinámico: verde (#22c55e) / amarillo (#f59e0b) / rojo (#ef4444)
  - Número grande de espacios libres
  - Barra de progreso de ocupación
  - Estado: "DISPONIBLE" / "LIMITADO" / "SATURADO" / "SIN ESPACIO"
  - Última actualización: "Hace 12 segundos"
- Botón "Abrir mapa de parqueo" → redirige al mapa completo (requiere login)
- QR de la página `/disponibilidad` en la misma página (para que el admin lo imprima y ponga en entrada)
- Mobile-first: diseñado para funcionar en celular en 3 segundos o menos

**Frontend — integración con ParqueoDemo**
- La guía de parqueo usa los mismos datos de `disponibilidad_zonas`
- Cuando una zona cambia de estado, la guía lo refleja en tiempo real sin recargar

### Reglas de negocio
- Solo se muestran zonas activas (`activa = True` en el modelo Zona)
- No se muestran zonas exclusivas que el usuario no puede usar (para eso necesita login)
- La página tiene meta tags correctos para compartir en WhatsApp (`og:title`, `og:description`, `og:image`)
- El cache de Redis expira cada 30 segundos para balancear frecuencia y carga de BD
- Si el backend no responde, mostrar última lectura conocida con badge "Datos desactualizados"

---

## Mejora 6 — Horarios de Acceso por Portería (Secundaria)

### Problema de negocio
La UAGRM opera oficialmente de lunes a sábado, 06:30 a 23:00. Las porterías no están activas las 24 horas. El sistema actualmente permite registrar un acceso a las 3am del domingo sin ninguna restricción, lo que no refleja la realidad operativa.

### Qué construir

**Backend — campos en `PuntoAcceso`**
```python
hora_apertura    = TimeField(default=time(6, 30))
hora_cierre      = TimeField(default=time(23, 0))
dias_operacion   = CharField(max_length=20, default="L,M,X,J,V,S")  # comma-separated
activo_forzado   = BooleanField(default=False)  # override para emergencias
```

**Backend — validación en `registrar_acceso`**
- Antes de registrar, verificar que el `PuntoAcceso` está en horario
- Si está fuera de horario y `activo_forzado = False`: raise Exception con mensaje claro
- Si el admin activó `activo_forzado`: registrar con `observacion = "Acceso fuera de horario autorizado"`

**Backend — mutación `forzar_acceso_porteria`**
- Solo admin puede activar `activo_forzado = True` con duración máxima (N horas)
- Celery task desactiva `activo_forzado` al vencer el tiempo

**Frontend — panel del guardia**
- Indicador visual de estado de la portería seleccionada: 🟢 Abierta / 🔴 Cerrada
- Mostrar horario de la portería actual debajo del selector
- Si la portería está cerrada, el botón de escanear muestra advertencia (no bloquea, solo avisa)

### Reglas de negocio
- La validación de horario es una advertencia para el guardia, no un bloqueo duro — el guardia puede igualmente registrar con confirmación
- Feriados no están implementados en esta iteración (alcance reducido)
- La portería "Control Central" tiene acceso especial 24/7 para emergencias por defecto

---

## Resumen de implementación y orden sugerido

```
┌─────────────────────────────────────────────────────────────────────┐
│  PRIORIDAD 1 — Corrige errores de negocio graves                    │
├─────────────────────────────────────────────────────────────────────┤
│  Mejora 1: Cupos dinámicos reales              ~3-4 horas           │
│  Mejora 3: Alertas en tiempo real al guardia   ~3-4 horas           │
├─────────────────────────────────────────────────────────────────────┤
│  PRIORIDAD 2 — Completa flujos incompletos                          │
├─────────────────────────────────────────────────────────────────────┤
│  Mejora 2: QR entregable para visitantes       ~4-5 horas           │
│  Mejora 4: Acceso temporal de proveedores      ~4-5 horas           │
├─────────────────────────────────────────────────────────────────────┤
│  PRIORIDAD 3 — Agrega valor diferencial                             │
├─────────────────────────────────────────────────────────────────────┤
│  Mejora 5: Semáforo público de parqueo         ~2-3 horas           │
│  Mejora 6: Horarios de acceso por portería     ~2-3 horas           │
└─────────────────────────────────────────────────────────────────────┘
```

### Archivos que cada mejora toca

| Mejora | Backend | Frontend |
|--------|---------|----------|
| 1 — Cupos dinámicos | `parqueos/schema.py`, `parqueos/models.py`, Celery task | `ParqueoDemo.tsx`, `Parqueos.tsx`, nuevo `useDisponibilidad.ts` |
| 2 — QR visitante | `visitantes/schema.py`, `notificaciones/utils.py`, `acceso/schema.py` | `Visitantes.tsx`, `Register.tsx`, nuevo `/visita/:codigo` |
| 3 — Alertas guardia | `acceso/schema.py`, `acceso/tasks.py`, Channels | `GuardiaDashboard.tsx`, nuevo `useAlertasGuardia.ts` |
| 4 — Proveedores | nuevo `acceso/models.py VehiculoTemporal`, schema, Celery | `GuardiaDashboard.tsx` (nuevo tab), `RastreoEnVivo.tsx` |
| 5 — Semáforo público | `parqueos/schema.py` (query pública), Redis cache | nuevo `src/pages/Disponibilidad.tsx`, `App.tsx` |
| 6 — Horarios | `acceso/models.py`, migration, `acceso/schema.py` | `GuardiaDashboard.tsx`, `Acceso.tsx` |

### Principios que deben respetarse en la implementación

1. **Nunca romper el flujo del guardia** — el guardia en portería es el usuario más crítico. Cualquier mejora que agregue pasos sin valor al guardia es incorrecta.

2. **Los errores de negocio son bloqueantes, los de sistema son tolerables** — si una zona está llena, BLOQUEAR. Si el WebSocket falla, DEGRADAR GRACIOSAMENTE (mostrar último valor conocido).

3. **Mobile-first para todo lo público** — el semáforo de parqueo y el QR del visitante se usan en celular, no en escritorio.

4. **Los datos falsos son peores que no tener datos** — el "25 libres" hardcodeado es activamente dañino. Si no se puede calcular en tiempo real, mostrar "Datos no disponibles" es más honesto.

5. **La auditoría es no-negociable** — toda acción de negocio (acceso temporal, alerta revisada, pase generado) debe quedar en `AuditLog` con usuario, timestamp e IP.

---

*Documento generado para el Sistema de Control Vehicular UAGRM · Iteración de mejoras · 2026*
