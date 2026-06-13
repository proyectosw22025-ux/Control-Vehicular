# Análisis de Control de Acceso — Seguridad, Agilidad y Defensa

**Auditoría enfocada: qué le falta al control de acceso vehicular de la UAGRM**
Fecha: 13 de junio de 2026 · Basado en lectura directa del código en `master`

---

## Cómo leer este documento

A diferencia del `PLAN_DESARROLLO.md` (que cubrió bugs, parqueo y rendimiento), este se concentra en **el control de acceso como sistema de seguridad**: ¿qué situaciones reales del portón aún no estamos contemplando? Cada hallazgo está escrito para resistir una pregunta dura del tribunal en la defensa final, y cada propuesta se evalúa contra dos restricciones que el proyecto ya asumió: **no generar colas en hora pico** y **agilizar la operación del guardia**.

Para cada punto: el **escenario** que lo expone, el **riesgo o fricción**, la **propuesta**, y la **pregunta de defensa** que anticipa.

**Lo que ya está resuelto** (no se repite): máquina de estados entrada/salida, coherencia acceso↔parqueo, identidad obligatoria en QR y manual, alerta de SOAT vencido, modo Auto, sugerencia OCR, formato de placa boliviano vigente, deprecación gradual del QR legacy, detección de anomalías (frecuencia, sanciones, documentos).

---

## SEVERIDAD 1 — Huecos de seguridad del portón

### 1.1 No existe lista negra / alerta de vehículo robado o buscado

**Dónde**: `Vehiculo.estado` solo tiene `activo|pendiente|sancionado|inactivo`. No hay un estado ni bandera para "reportado como robado", "vehículo en investigación" o "acceso prohibido por dirección".

**Escenario**: Seguridad de la universidad recibe el aviso de que el vehículo `1234-ABC` fue robado, o que a un ex-funcionario se le revocó el acceso. Hoy no hay forma de marcarlo: si su QR sigue activo, **entra normalmente** y nadie se entera. La única vía es ponerlo `inactivo`, lo que produce el mensaje genérico "Contacte a la administración" — sin alertar al guardia de que es un caso sensible, y sin registrar el intento como evento de seguridad.

**Propuesta**: un estado/bandera `en_alerta` (o lista negra) que, al escanearse, **no bloquee silenciosamente** sino que dispare una `AlertaAcceso` crítica con instrucción al guardia ("Retener / dar aviso a seguridad") y registre el intento con hora y punto. Es el inverso del flujo normal: aquí la información es para reaccionar, no solo para denegar.

**Pregunta de defensa**: *"¿Qué pasa si un vehículo robado intenta entrar?"* — hoy la respuesta honesta es "entra". Esto la cambia.

**Esfuerzo**: 3-4 h (campo + detección en `resolver_codigo`/`_detectar_anomalias_acceso` + UI de alerta crítica que ya existe).

### 1.2 El registro de acceso no guarda evidencia (foto del frame)

**Dónde**: `RegistroAcceso` guarda placa, hora, punto, método — pero el OCR (`ocr_view.py`) procesa el frame y lo **descarta**. No queda imagen del vehículo que entró.

**Escenario**: Hay un incidente dentro del campus a las 14:30. Se revisa el registro: "`1234-ABC` entró 14:05 por Portón Norte". Pero, ¿era ese auto, o alguien clonó la placa? ¿quién conducía? Sin la foto del momento, el registro es un dato sin respaldo verificable — débil como evidencia.

**Propuesta**: al registrar acceso por OCR/QR, archivar el frame (o un recorte de la placa) en almacenamiento (Cloudinary, que el proyecto ya usa) y enlazarlo al `RegistroAcceso`. No bloquea el flujo (se sube async). Convierte el log en evidencia auditable.

**Pregunta de defensa**: *"Su sistema dice que el auto entró, pero ¿cómo prueban que fue ese auto y no una placa clonada?"*

**Esfuerzo**: 4-5 h (campo `imagen_url`, subida async, mostrarla en Auditoría/Historial).

### 1.3 Sin control de aforo: no se sabe cuántos vehículos hay dentro vs. el máximo

**Dónde**: el sistema cuenta sesiones de parqueo y "vehículos en campus" (parte de control que agregamos), pero no hay un **límite de aforo** ni alerta al alcanzarlo.

**Escenario**: Evento masivo en el campus. Entran vehículos hasta que físicamente no caben — el guardia no tiene una señal del sistema de "campus al X% de capacidad, considere desviar al parqueo externo". Es a la vez un tema de **seguridad** (evacuación, normas de bomberos) y de **experiencia** (evitar que la gente entre para no encontrar lugar y tener que dar la vuelta — eso *genera colas* en la salida).

**Propuesta**: capacidad total del campus configurable; el "parte en campus" ya calcula cuántos hay dentro. Mostrar un semáforo de aforo en el panel del guardia y, opcionalmente, una alerta al superar un umbral. Conecta con el semáforo de parqueo que ya existe.

**Pregunta de defensa**: *"¿El sistema ayuda a cumplir las normas de aforo y evacuación?"*

**Esfuerzo**: 3 h (reutiliza `vehiculos_en_campus` + un setting + indicador UI).

### 1.4 Sin límite de intentos (throttling) en login ni en registro de acceso

**Dónde**: `LOGIN_MUTATION` y `registrar_acceso` no tienen rate-limiting.

**Escenario**: Un atacante prueba contraseñas contra el login por fuerza bruta, o automatiza escaneos de códigos QR para adivinar uno válido. Nada lo frena. El QR dinámico TOTP mitiga el segundo caso (rota cada 30s), pero el login es vulnerable a fuerza bruta clásica.

**Propuesta**: throttling por IP/usuario en login (p.ej. 5 intentos / 15 min) y un límite razonable de escaneos fallidos por punto. Django tiene librerías maduras (`django-ratelimit`) o se puede usar el cache Redis ya presente.

**Pregunta de defensa**: *"¿Cómo protegen el login contra fuerza bruta?"* (pregunta de seguridad estándar y muy probable).

**Esfuerzo**: 2-3 h.

### 1.5 El TOTP hace un escaneo lineal de todos los vehículos en cache-miss

**Dónde**: `services.py` `_resolver_totp` — si el código no está en cache, **itera todos los vehículos activos** validando el TOTP de cada uno.

**Escenario**: Con miles de vehículos y el cache frío (reinicio de Redis, primer escaneo del día), cada validación QR recorre toda la flota — lento justo en el primer auto de la fila de las 7 AM. Es a la vez un costo de **agilidad** (cola) y un vector de **degradación** (cada código inválido fuerza el barrido completo).

**Propuesta**: indexar el TOTP de forma reversible — calcular el código esperado por vehículo y precalentar el cache (`codigo→vehiculo_id`) en un task que corre cada ~25s para los vehículos con acceso reciente, o derivar el vehículo del propio payload del QR (incluir el id firmado). Elimina el barrido O(N).

**Pregunta de defensa**: *"¿Cuánto tarda un escaneo con 5.000 vehículos registrados?"*

**Esfuerzo**: 4-6 h (requiere cuidado; medir antes/después).

---

## SEVERIDAD 2 — Coherencia e identidad

### 2.1 No se verifica que quien conduce sea el dueño (salvo en delegación)

**Dónde**: el QR dinámico/permanente identifica al **vehículo**, no al conductor. Solo el QR de delegación lleva `destinatario`.

**Escenario**: El auto de un docente lo conduce un tercero con el QR del docente (se lo prestó, o lo tomó). El sistema lo deja entrar como si fuera el docente. Para un control de acceso, "el vehículo está autorizado" y "la persona está autorizada" no son lo mismo.

**Propuesta** (pragmática, sin fricción): no exigir identificación del conductor en el caso normal (generaría colas), pero sí **mostrar al guardia la foto del propietario registrado** junto al resultado del escaneo, para una verificación visual de un vistazo cuando el guardia lo juzgue necesario. La foto ya existe en el perfil. Cero toques extra, control disponible.

**Pregunta de defensa**: *"¿Cómo saben que quien entra con ese QR es el dueño?"*

**Esfuerzo**: 2 h (mostrar `foto_url` del propietario en la tarjeta de resultado).

### 2.2 El visitante con vehículo: dos registros desconectados (auditoría declarada pendiente)

**Dónde**: `Visitante`/`Visita` y `VehiculoTemporal` parecen flujos paralelos. Un visitante que llega en auto, ¿genera un `VehiculoTemporal`, una `Visita`, o ambos sin vínculo?

**Escenario**: Llega un visitante en su auto a una reunión. El guardia, ¿lo registra como visita (para el anfitrión) o como vehículo temporal (para el parqueo)? Si son dos registros sin relación, la salida de uno no cierra el otro — el mismo problema de descoordinación que ya resolvimos entre acceso y parqueo, reaparecido aquí.

**Propuesta**: auditar el flujo y, si están desconectados, vincular `Visita.vehiculo_temporal` para que el registro sea uno solo de cara al guardia y la salida coordine ambos.

**Esfuerzo**: requiere auditoría primero (2 h) + implementación (3-4 h).

### 2.3 Permisos de los reportes PDF (auditoría declarada pendiente)

**Dónde**: `apps/reportes/views.py` — endpoints REST que generan PDF, fuera del esquema GraphQL donde aplicamos el scoping de permisos.

**Escenario**: Un usuario normal arma la URL del PDF de accesos o de sesiones. Si el endpoint REST no repite la verificación de rol que sí hacen las queries GraphQL, **descarga datos que en la app no podría ver**. Es el patrón clásico de "la puerta de atrás no tiene la misma cerradura que la de adelante".

**Propuesta**: auditar cada vista PDF y aplicar el mismo decorador de rol. Verificación rápida y de alto valor para la defensa (es exactamente el tipo de hueco que un evaluador de seguridad busca).

**Esfuerzo**: 2 h.

---

## SEVERIDAD 3 — Agilidad y experiencia (anti-colas)

### 3.1 Sin modo offline: la caída de internet detiene el portón

**Dónde**: `useAccesoGuardia.ts` — sin conexión, el acceso no se registra (ya documentado como backlog en el plan anterior).

**Escenario**: Se cae el internet 10 minutos en hora pico. Hoy: o se detiene la fila, o los guardias dejan pasar sin registrar (huecos en la evidencia). Es el peor escenario de cola posible: el sistema, pensado para agilizar, se vuelve el cuello de botella.

**Propuesta**: cola local (IndexedDB) de accesos pendientes que se sincroniza al reconectar, con resolución de la máquina de estados tolerante. El guardia sigue operando; los registros se confirman después. (Alto esfuerzo, ~2-3 días — es el ítem más grande del backlog, pero el de mayor impacto en continuidad operativa.)

**Pregunta de defensa**: *"¿Qué hacen si se cae el internet en hora pico?"* — pregunta casi segura para un sistema de portón.

### 3.2 Carril express para vehículos frecuentes pre-aprobados

**Escenario**: Docentes y administrativos de planta entran y salen a diario. Pasan por el mismo flujo que un visitante esporádico. Un carril/cola lógica "frecuentes" (QR pre-validado, sin verificación adicional) los despacharía más rápido y descongestionaría el carril general.

**Propuesta**: marcar vehículos como "frecuentes/abonados" y, en el panel, un indicador visual que confirme el paso con feedback instantáneo. Más una mejora de flujo que de código.

**Esfuerzo**: 2-3 h.

### 3.3 Feedback sonoro diferenciado para el guardia

**Escenario**: En un portón ruidoso y soleado, el guardia no siempre mira la pantalla. Un **sonido distinto para aceptado vs. denegado** le permite operar sin mirar — más rápido y con menos errores. La tarjeta visual grande ya existe; falta el audio.

**Propuesta**: dos tonos cortos (ok / alerta) en el panel. Trivial y de alto impacto operativo.

**Esfuerzo**: 1 h.

### 3.4 Métrica de tiempo de despacho (para sustentar la defensa con datos)

**Escenario**: El tribunal pregunta *"¿cuánto agilizaron realmente el acceso?"*. Hoy la respuesta es cualitativa. Si el sistema **midiera** el tiempo entre escaneos consecutivos por punto, podrías mostrar un número: "mediana de X segundos por vehículo, Y vehículos/hora en pico".

**Propuesta**: registrar el delta entre accesos y exponer un mini-dashboard de throughput por punto/hora. Convierte el objetivo "no generar colas" en algo demostrable.

**Pregunta de defensa**: *"¿Cómo miden que no generan colas?"*

**Esfuerzo**: 3 h.

---

## Plan de ejecución propuesto

### Fase A — Seguridad demostrable (lo que el tribunal preguntará) · ~1.5 días
| # | Ítem | Por qué primero |
|---|---|---|
| 1 | Lista negra / alerta de vehículo robado (1.1) | Pregunta de defensa casi segura, hoy sin respuesta |
| 2 | Permisos de PDFs (2.3) | Hueco de seguridad real, verificación rápida |
| 3 | Throttling de login (1.4) | Seguridad estándar esperada |
| 4 | Foto del propietario en el escaneo (2.1) | Identidad con cero fricción |

### Fase B — Agilidad y evidencia · ~2 días
| # | Ítem | |
|---|---|---|
| 5 | Feedback sonoro (3.3) | Trivial, alto impacto |
| 6 | Métrica de despacho (3.4) | Sustenta "no colas" con datos |
| 7 | Evidencia fotográfica en el acceso (1.2) | Log auditable |
| 8 | Control de aforo (1.3) | Seguridad + flujo de salida |

### Fase C — Profundidad (post-defensa o si hay tiempo) · esfuerzo alto
| # | Ítem | |
|---|---|---|
| 9 | Modo offline del portón (3.1) | El más grande; continuidad operativa |
| 10 | Índice TOTP sin barrido O(N) (1.5) | Escalabilidad real |
| 11 | Auditoría visitante↔vehículo (2.2) | Coherencia de dominio |
| 12 | Carril express frecuentes (3.2) | Optimización de flujo |

---

## Argumentario para la defensa (síntesis)

Cuando el tribunal pregunte por el control de acceso, la narrativa fuerte es:

1. **"El sistema no confía en un solo factor"**: QR dinámico TOTP (rota cada 30s) como principal, con QR de delegación para préstamos, pase temporal para visitas, y acceso manual auditado como respaldo — cada uno con su validación atómica y su responsable identificado.
2. **"Cada acceso deja rastro y tiene dueño"**: ningún registro es anónimo (lo cerramos en QR y manual), y la auditoría conserva quién, qué, cuándo y desde dónde.
3. **"El parqueo y el acceso son un solo sistema coherente"**: no se estaciona quien no entró, la salida del campus libera el espacio, los temporales ocupan espacios reales.
4. **"Está pensado para no generar colas"**: modo Auto sin decisiones del guardia, sugerencia OCR de un toque, asignación de espacio post-entrada, disponibilidad en vivo por WebSocket.

Y la honestidad que da credibilidad: **este documento es la lista de lo que aún falta** — lista negra, evidencia fotográfica, aforo, offline. Presentar un plan priorizado de lo pendiente demuestra criterio de ingeniería, no debilidad.

---

*Documento de análisis. Cada hallazgo es verificable en el código (archivo:línea citada donde aplica). Estimaciones bajo el patrón de trabajo del repo: mutación/lógica + tests + UI + deploy.*
