# Plan de Desarrollo — Análisis Profundo del Sistema de Control Vehicular UAGRM

**Auditoría de coherencia entre módulos, reglas de negocio y agilidad operativa**
Fecha del análisis: 12 de junio de 2026 · Basado en lectura directa del código en `master`

---

## Cómo se hizo este análisis

Se recorrió el código de los módulos **Acceso (QR/OCR/Manual), Vehículos, Parqueos, Visitantes, Infracciones, Notificaciones y las tareas Celery**, simulando contra el código real los escenarios de un día típico del campus: la fila de las 7:45 AM, el vehículo prestado a un familiar, el proveedor que descarga mercadería, el auto que pernocta, el QR fotografiado, la placa mal tecleada. Cada hallazgo cita el archivo y línea donde vive el problema, y el escenario concreto que lo dispara.

La vara de medida para la agilidad: **un portón en hora pico procesa un vehículo cada 10-15 segundos o se forma cola**. Toda fricción del guardia (un toque extra, un error que obliga a reintentar, una decisión que el sistema podía tomar solo) se evaluó contra ese número.

**Estado de partida** (ya resuelto en iteraciones previas, no se repite aquí): lookup de placas tolerante a guiones, motor OCR FastALPR funcional, separación Infracción/Sanción, retiro de Reservas, seguridad de queries de parqueo, constraints de concurrencia, regla acceso↔parqueo (no se estaciona quien no ingresó), identidad en acceso manual, scroll del sidebar y login sin parpadeo.

---

## SEVERIDAD 1 — Bugs reales activos (corregir de inmediato)

### 1.1 La tarea Celery `limpiar_qr_expirados` crashea cada hora en producción

**Dónde**: `backend/apps/acceso/tasks.py:6-12` vs `backend/apps/acceso/models.py:110-113`

**El problema técnico**: la tarea ejecuta `QrSesion.objects.filter(usado=False).update(usado=True)`, pero `usado` ya **no es un campo de la base de datos** — es una `@property` calculada (`usos_actual >= usos_max`) desde que el modelo migró al sistema de usos múltiples. Django lanza `FieldError` en cada ejecución horaria. Los 4 tests que fallan en `master` (`test_delegaciones`, `test_alertas_anomalias`, `test_services`) tienen la misma causa: intentan crear `QrSesion(usado=True)`.

**El escenario**: ninguno visible para el usuario — y eso es lo peligroso. La tarea muere silenciosamente cada hora (solo se ve en logs de Celery), los tests rotos se normalizaron ("esos 4 siempre fallan"), y cualquier refactor futuro que confíe en esa limpieza heredará el problema. El daño funcional hoy es bajo porque la property `vigente` valida `fecha_expiracion` en el momento del uso — pero un beat task que crashea cada hora es deuda activa.

**Solución**: eliminar la tarea (la expiración ya se valida on-read vía `vigente`) o reescribirla con la condición real (`usos_actual < usos_max, fecha_expiracion < now`) si se quiere mantener el registro histórico "cerrado". Reescribir los 4 tests para crear sesiones con `usos_actual=usos_max` en lugar de `usado=True`. **Esfuerzo: 1 hora.**

### 1.2 Se pueden registrar placas duplicadas ("ZYX123" y "ZYX-123" como dos vehículos)

**Dónde**: `backend/apps/vehiculos/schema.py:564`

**El problema técnico**: el check de unicidad al registrar es `filter(placa=input.placa.upper()).exists()` — match exacto. La placa nunca se normaliza ni se valida contra el formato boliviano. Tras el fix del lookup tolerante a guiones en acceso (`apps/acceso/schema.py:1143-1148`), el sistema **encuentra** ambas variantes... con `.first()`, es decir, una elección arbitraria.

**El escenario**: Roberto registró "ZYX123" hace un mes. Su hermano, sin saberlo, registra el mismo auto como "ZYX-123" — el sistema lo acepta como vehículo nuevo (¡con otro dueño, otro QR, estado pendiente!). Cuando el OCR del portón lee la placa física y busca con tolerancia a guiones, encuentra **dos** vehículos y opera sobre el primero que devuelva la BD. La entrada puede registrarse al vehículo del hermano, la sanción al de Roberto. El historial de accesos —la evidencia del sistema— queda repartido entre dos identidades del mismo auto físico.

**Solución** (tres piezas, juntas):
1. **Normalizar al registrar**: convertir toda placa entrante al formato canónico (sin separadores internos para comparar; almacenar con el formato canónico boliviano `ABC-1234`).
2. **Unicidad insensible a separadores**: el check de duplicados compara `REPLACE(placa,'-','')` igual que ya hace el lookup de acceso.
3. **Validador de formato Bolivia**: regex que acepte los patrones reales (`[A-Z]{2,3}-?\d{3,4}[A-Z]?`), con mensaje claro al usuario ("Formato esperado: ABC-1234"). Esto además responde la observación de la predefensa ("¿sigue el formato de placas de Bolivia?").
4. **Migración de datos**: canonicalizar las placas existentes (detectando colisiones antes — si ya hay duplicados reales en producción, reportarlos para resolución manual, no fusión automática).

**Esfuerzo: 3-4 horas** (la migración con detección de colisiones es lo delicado).

### 1.3 `registrar_acceso` (QR) acepta llamadas sin identidad — el mismo hueco que ya se cerró en el manual

**Dónde**: `backend/apps/acceso/schema.py:951-992` (nótese `registrado_por = user if authenticated else None` en la línea 974)

**El problema técnico**: la mutación QR no exige autenticación ni rol. El QR es en sí una credencial (TOTP que rota cada 30s), pero el **QR permanente legacy** es estático: una foto basta.

**El escenario**: un estudiante fotografía el QR permanente impreso que un docente dejó visible en su parabrisas. Esa noche, desde su casa, llama a `registrarAcceso` con el código y registra una "salida" del vehículo del docente — sin ser guardia, sin estar en el portón, sin quedar identificado (`registrado_por=None`). Consecuencias idénticas al caso manual ya corregido: máquina de estados rota para la víctima, registro contaminado, parqueo desincronizado.

**Solución**: exigir rol Guardia/Administrador en `registrar_acceso` — el frontend solo la invoca desde el panel del guardia (`useAccesoGuardia.ts`, `Acceso.tsx`), así que no rompe ningún flujo legítimo. Mismo patrón aplicado en commit `181bf4a2` al acceso manual. **Esfuerzo: 1 hora con tests.**

---

## SEVERIDAD 2 — Reglas de negocio incompletas (coherencia entre módulos)

### 2.1 El SOAT vencido es invisible en el portón

**Dónde**: `backend/apps/acceso/schema.py:397-408` (el detector de anomalías solo conoce 2 tipos) + tarea diaria `vehiculos.alertar_documentos_por_vencer` (solo notifica al dueño)

**El escenario**: el SOAT del vehículo CBB-123 venció hace 20 días. El dueño ignoró las notificaciones. El vehículo entra y sale del campus a diario y **ningún guardia se entera jamás** — el sistema de alertas en garita (`_detectar_anomalias_acceso`) solo detecta frecuencia excesiva y sanciones pendientes. La universidad, al permitir circular dentro del campus un vehículo sin seguro obligatorio, asume un riesgo legal real si hay un accidente interno.

**Solución**: agregar la anomalía `documento_vencido` al detector — al registrar una **entrada**, si el vehículo tiene `DocumentoVehiculo` con `fecha_vencimiento < hoy`, crear `AlertaAcceso` (severidad `advertencia` para < 30 días, `critica` para más). El guardia la ve en la misma tarjeta de confirmación que ya muestra alertas; **no bloquea** el ingreso (decisión de negocio: la universidad alerta, no fiscaliza tránsito), pero queda registrada y el dashboard la acumula. **Esfuerzo: 2 horas.** *Decisión pendiente del producto: ¿la 3.ª entrada con SOAT vencido crítica debería escalar a bloqueo? Dejarlo configurable.*

### 2.2 El QR permanente legacy es una credencial estática en un sistema que ya tiene TOTP

**Dónde**: `RegistroAcceso.METODOS` incluye `qr_permanente` (legacy); `resolver_codigo` lo sigue aceptando.

**El escenario**: cualquier QR permanente fotografiado funciona para siempre (hasta invalidarlo a mano). El sistema ya tiene QR dinámico TOTP que rota cada 30 segundos — la coexistencia significa que la seguridad real del portón es la del eslabón más débil: el QR estático.

**Solución (deprecación por etapas, no romper a los usuarios)**:
1. Medir: ¿cuántos accesos del último mes usaron `qr_permanente`? (query de 1 minuto sobre `RegistroAcceso`).
2. Si es marginal: desactivar la resolución de QR permanente y comunicar en la app ("Tu pase QR ahora es dinámico — ábrelo en Mi Pase QR").
3. Si es significativo: banner de transición 2 semanas + luego corte.
**Esfuerzo: 2 horas + decisión de fechas.**

### 2.3 Vehículos temporales ocupan espacios físicos que el mapa muestra libres

**Dónde**: `SesionParqueo.vehiculo` exige FK a `Vehiculo` registrado; `VehiculoTemporal` no participa del parqueo.

**El escenario**: el camión de la distribuidora entra con acceso temporal de 4 horas, se estaciona en Zona B y descarga 2 horas. El semáforo público dice "Zona B: 12 libres" cuando físicamente hay 11. En hora pico, la guía de parqueo dirige vehículos a espacios prometidos que no existen — exactamente el problema P1 que motivó los cupos dinámicos, reintroducido por la puerta de los temporales.

**Solución mínima viable**: botón "Ocupar espacio" en la pestaña Temporales del panel del guardia, que marque `EspacioParqueo.estado='ocupado'` vinculado al `VehiculoTemporal` (campo nullable `vehiculo_temporal` en la sesión, o un estado transitorio en el espacio); la salida del temporal lo libera automáticamente (el flujo `registrar_salida_temporal` ya existe como gancho). **Esfuerzo: 3-4 horas.**

### 2.4 No existe forma de sacar un espacio de servicio desde la aplicación

**Dónde**: no hay mutación para cambiar `EspacioParqueo.estado` a `mantenimiento`; solo el admin de Django (que los operadores no usan).

**El escenario**: se rompe el pavimento del A-03 un viernes. Nadie con acceso operativo puede marcarlo fuera de servicio; el mapa lo sigue ofreciendo, el guardia asigna, el conductor llega y encuentra un hueco. Además nada impide poner en mantenimiento un espacio con un vehículo dentro (drift de estado).

**Solución**: mutación `cambiar_estado_espacio` (solo Admin) con dos validaciones — no tocar espacios con sesión activa, auditar el cambio — y botón en la vista de Espacios. **Esfuerzo: 2 horas.**

### 2.5 Nadie cierra el día: vehículos que pernoctan sin reporte

**Dónde**: existe `parqueos.alertar_sesiones_largas` (10h, al admin) pero ningún corte de jornada para el guardia.

**El escenario**: 10:30 PM, el guardia del turno noche recibe el campus. ¿Cuántos vehículos quedan dentro? ¿Cuáles? Hoy: tendría que cruzar mentalmente "Últimos accesos" con el mapa de parqueo. La información existe (máquina de estados + sesiones activas) pero no hay vista ni reporte que la consolide.

**Solución**: tarea Celery diaria (hora de cierre configurable) que genera el "parte nocturno": vehículos con último acceso = entrada, su espacio si tienen sesión, hora de ingreso, datos del propietario — notificación a guardias/admins + sección "Aún en campus" en el panel del guardia (query reutilizable, los datos ya están). **Esfuerzo: 3 horas.**

---

## SEVERIDAD 3 — Agilidad en el portón (anti-colas)

> El análisis de throughput: con QR dinámico y todo correcto, el flujo actual es excelente (~0 toques por vehículo: la cámara escanea continuo). Las colas nacen de los **casos imperfectos**, que en un campus real son el 20-30% del tráfico.

### 3.1 El toggle Entrada/Salida es una decisión que el sistema ya sabe tomar — y cuando el guardia se equivoca, cuesta 10-15 segundos por vehículo

**Dónde**: `GuardiaDashboard.tsx` (toggle manual) + `_validar_transicion_acceso` en `apps/acceso/schema.py:14-50` (el backend ya conoce la dirección esperada)

**El escenario medido**: 7:45 AM, fila de entrada. El guardia tiene el toggle en "Entrada" y fluye. Un vehículo sale a contramano (dejó a alguien y se va): el guardia escanea → error "ya está dentro" (7 segundos en pantalla) → cambia el toggle → re-escanea → registra → **debe acordarse de devolver el toggle** o el siguiente de la fila también falla. Un solo vehículo a contraflujo cuesta 2-3 posiciones de cola. En el cambio de turno del mediodía (flujo mixto real), el toggle es fricción constante.

**La ironía**: la máquina de estados del backend rechaza el tipo incorrecto porque **ya sabe** cuál es el correcto. El sistema conoce la respuesta y aún así le pregunta al guardia.

**Solución — modo "Auto" (la mejora de mayor impacto operativo del plan)**:
- Backend: `tipo: "auto"` en `ValidarAccesoInput`/`AccesoManualInput` → si el último registro del vehículo es `entrada`, esto es una `salida`, y viceversa (sin registros → `entrada`). La validación de transición se vuelve trivialmente consistente.
- Frontend: el panel arranca en "Auto" (botón único "Escanear"); los botones Entrada/Salida quedan como override manual para casos especiales. La tarjeta de resultado ya dice "Entrada registrada"/"Salida registrada", así que el guardia confirma visualmente sin decidir nada.
- **Efecto**: cero errores de dirección, cero toques de toggle, flujo mixto sin fricción. **Esfuerzo: 3-4 horas con tests de la máquina de estados.**

### 3.2 El OCR confunde caracteres parecidos y el "no registrado" es un callejón sin salida

**Dónde**: logs de producción reales — el motor leyó `ZVX123` (conf. 0.93-0.96) cuando la placa era `ZYX123`: la V y la Y se confunden ópticamente. Resultado: "Vehículo con placa ZVX-123 no registrado" y el guardia debe pasar a tipeo manual completo.

**El escenario**: portón con OCR activo, placa sucia o con reflejo. 3 de cada 10 lecturas confunden un carácter. Cada confusión = error en pantalla + tipeo manual de 7 caracteres = 20-30 segundos. La cola crece justamente en el método que prometía eliminarla.

**Solución — sugerencia por placa cercana**: cuando el lookup falla, buscar placas registradas a **distancia de edición 1** (un carácter de diferencia, mismo largo). Si hay exactamente una y el vehículo está activo, responder con sugerencia: la UI muestra "*¿Quisiste decir ZYX-123 — Toyota Corolla blanco de Roberto Suárez?*" con botón de confirmación de un toque (la confirmación visual del guardia contra el vehículo físico es el control). Si hay varias candidatas o ninguna, error normal. **Nunca auto-registrar la sugerencia** — siempre un toque humano. **Esfuerzo: 3 horas** (la búsqueda a distancia 1 sobre placas normalizadas es barata: se genera el conjunto de variantes o se compara en memoria sobre las ~centenas/miles de placas activas).

### 3.3 Después de la entrada, asignar espacio exige navegar a otro módulo (y por eso no se hace)

**Dónde**: flujo `GuardiaDashboard` → módulo Parqueos → pestaña Espacios → zona → buscar → Asignar (≥5 toques + navegación)

**El escenario**: ya documentado en la iteración anterior y agravado por la regla nueva acceso↔parqueo (la entrada ya está garantizada cuando se asigna). En la práctica los guardias no completan el segundo flujo y la ocupación del mapa deriva a ficción.

**Solución**: en la tarjeta de confirmación de entrada (la verde que ya existe), botón **"Asignar espacio: B-07 (Zona B)"** con el primer espacio libre compatible ya resuelto por el backend (zona más cercana al punto de acceso, categoría compatible con el rol del propietario — todos los datos ya están en memoria del request). Un toque, cero navegación. Si el guardia lo ignora, nada cambia (el dueño puede recibir la guía de parqueo como hoy). **Esfuerzo: 4-5 horas** (resolver "espacio sugerido" en el response de `registrar_acceso` + botón en la tarjeta).

### 3.4 Sin internet, el portón queda ciego (registrado, no resuelto en este plan)

**Dónde**: `useAccesoGuardia.ts:133-140` — si `navigator.onLine` es false, el acceso simplemente **no se registra**.

**El escenario**: se cae el internet del portón 10 minutos en hora pico. Hoy: o se detiene la fila o los guardias dejan pasar sin registro (huecos en la evidencia + máquina de estados desincronizada para todos esos vehículos).

**Solución futura (fase 3, esfuerzo alto)**: cola local de accesos pendientes (IndexedDB) con sincronización al reconectar y resolución de conflictos de la máquina de estados con tolerancia (aceptar la secuencia local como verdad). Se documenta aquí como riesgo conocido; no entra en las fases inmediatas por complejidad (~2-3 días) frente a la frecuencia del escenario.

---

## SEVERIDAD 4 — Rendimiento y pulido frontend

| # | Hallazgo | Escenario | Solución | Esfuerzo |
|---|----------|-----------|----------|----------|
| 4.1 | Bundle >500 KB: `ParqueoDemo` y `RastreoEnVivo` importan Leaflet estáticamente en `App.tsx` — todo usuario lo descarga aunque nunca abra mapas | Estudiante con datos móviles abre la app para ver su QR: descarga el motor de mapas completo antes de ver nada | `React.lazy()` por ruta + `Suspense` (patrón ya usado en `BusquedaGlobalModal`) | 2 h |
| 4.2 | El WebSocket de disponibilidad existe en backend y nadie lo escucha: el semáforo y el mapa hacen polling de 15 s | 5 pantallas de guardia + pantalla pública = requests constantes por datos que el servidor ya empuja | Suscribir `useDisponibilidadZonas` al evento `disponibilidad_actualizada` (el consumer ya agrega al grupo), polling como fallback | 3 h |
| 4.3 | "Buscar vehículo por placa..." es un `<select>` con 200 opciones | Flota real de miles: el modal de asignación se vuelve inusable | Typeahead server-side (reutilizar la búsqueda global con prefijo `v:`) | 3 h |
| 4.4 | Sidebar colapsado usa resaltado gris `slate` vs. borde dorado institucional del expandido | Inconsistencia visual al alternar | Unificar clases activas | 30 min |

---

## Áreas revisadas superficialmente (auditoría pendiente declarada)

Por honestidad del análisis, estos módulos se revisaron solo en estructura, no flujo por flujo:

- **Visitantes**: el flujo pre-registro → pase por email → verificación en garita existe y está modelado; falta auditar la expiración del pase, el caso "visitante con vehículo" (¿se conecta con `VehiculoTemporal` o son dos registros desconectados?) y la coherencia del cierre de visitas vs. salida del vehículo.
- **Bot de WhatsApp** (`notificaciones/whatsapp_bot.py`): superficie grande sin tests visibles; auditar inyección de comandos y manejo de números no registrados.
- **Reportes PDF**: verificar que respetan los mismos permisos que las queries (un endpoint REST puede saltarse el scoping GraphQL).
- **Rastreo en Vivo**: no auditado; verificar permisos de quién puede ver posiciones en tiempo real (misma lógica de privacidad que `sesiones_activas`).

---

## Plan de ejecución propuesto

### Fase 1 — Esta semana (bugs activos + seguridad) · ~1 día de trabajo
| Orden | Ítem | Ref. |
|---|---|---|
| 1 | Arreglar/eliminar task `limpiar_qr_expirados` + 4 tests rotos | 1.1 |
| 2 | Rol Guardia/Admin en `registrar_acceso` (QR) | 1.3 |
| 3 | Normalización + unicidad + validador de placas + migración | 1.2 |

### Fase 2 — Próxima semana (reglas de negocio + anti-colas core) · ~2 días
| Orden | Ítem | Ref. |
|---|---|---|
| 4 | Modo "Auto" entrada/salida en el portón | 3.1 |
| 5 | Sugerencia OCR por placa cercana (distancia 1) | 3.2 |
| 6 | Alerta de SOAT/documentos vencidos al ingresar | 2.1 |
| 7 | Botón "Asignar espacio" post-entrada | 3.3 |

### Fase 3 — Siguiente iteración (coherencia restante + pulido) · ~2 días
| Orden | Ítem | Ref. |
|---|---|---|
| 8 | Espacios en mantenimiento desde la UI | 2.4 |
| 9 | Parte nocturno "Aún en campus" | 2.5 |
| 10 | Temporales ocupando espacios | 2.3 |
| 11 | Deprecación del QR permanente (medir → cortar) | 2.2 |
| 12 | Lazy routes + WS disponibilidad + typeahead + sidebar | 4.1-4.4 |

### Backlog declarado (alto esfuerzo, decidir si entra al alcance académico)
- Cola offline del portón (3.4)
- Auditorías pendientes: visitantes a fondo, WhatsApp bot, permisos de PDFs y rastreo
- Analítica de ocupación (horas pico, duración promedio por zona, espacios muertos)

---

## Métricas de éxito (cómo saber que funcionó)

| Métrica | Hoy (estimado) | Meta post-Fase 2 |
|---|---|---|
| Tiempo por vehículo en portón, caso feliz QR | ~5-8 s | igual (ya es bueno) |
| Tiempo por vehículo a contraflujo (toggle equivocado) | ~25-35 s | ~8 s (modo Auto) |
| Tiempo por lectura OCR con 1 carácter confundido | ~25-30 s (tipeo manual) | ~6 s (sugerencia + 1 toque) |
| Accesos manuales/QR sin responsable identificado | posible (`registrado_por=None` en QR) | 0 — todo acceso firmado |
| Placas duplicadas registrables | sí | imposible por construcción |
| Tasks Celery crasheando | 1 (horaria) | 0 |
| Ocupación del mapa vs. realidad física | deriva (asignación manual + temporales invisibles) | fiel (1 toque post-entrada + temporales visibles) |

---

*Documento generado a partir de auditoría de código directa. Cada hallazgo es verificable en la referencia archivo:línea citada. Las estimaciones de esfuerzo asumen el patrón de trabajo ya establecido en el repo (mutación + tests + UI + deploy automático).*
