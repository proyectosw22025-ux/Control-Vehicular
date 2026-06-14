# Plan: Robustez del lector de placas para producción

> Estado: **PLANIFICADO** (no implementado). Documento de diseño para una iteración
> futura. La lectura de placas ya funciona (FastALPR + corrección de formato); esto
> es la capa de decisión que la vuelve *estable y precisa* para producción.

## Principio rector

El cuello de botella **no es el modelo de OCR** (FastALPR / YOLOv9 + ViT ya es bueno).
Todo el rendimiento que falta está en la **capa de decisión sobre las salidas que ya
tenemos**. La regla: _más matemática sobre las lecturas, no más IA_.

**No hacer:** entrenar un modelo propio ni buscar una red más grande. No hay dataset,
no es el cuello de botella, y es esfuerzo desperdiciado.

## El cambio de marco mental

Hoy tratamos esto como **OCR de texto libre**. Pero el conjunto de respuestas válidas
es **cerrado y conocido**: las placas registradas en la BD. Eso convierte el problema
en **estimación MAP (Maximum A Posteriori) sobre un diccionario finito**:

```
placa* = argmax  P(placa | observaciones)
         placa ∈ BD

       = argmax  P(observaciones | placa) · P(placa)
         placa ∈ BD
```

Consecuencia clave para producción: si el `argmax` se restringe a la BD, el sistema
es **matemáticamente incapaz de inventar una placa inexistente**. En el peor caso no
acierta y escala a revisión humana — pero nunca "alucina" una placa.

---

## Palancas, en orden de impacto

### 1. Fusión probabilística multi-frame (mayor impacto)

**Hoy:** `_procesar_multiframe` en [ocr_view.py](backend/apps/vehiculos/ocr_view.py)
vota la **cadena completa** más repetida (`Counter.most_common`). Desperdicia los
frames "casi correctos".

**Versión rigurosa:** votar **carácter por carácter acumulando log-probabilidades**
(fusión bayesiana, errores independientes entre frames):

```
Para cada posición i:
   score(c) = Σ  log P_frame_k(carácter_i = c)
              k
   carácter_i* = argmax_c  score(c)
```

**Por qué funciona:** los errores de OCR entre frames son ruido independiente y
descorrelacionado; la placa real es señal constante. Sumar log-probabilidades refuerza
la señal y cancela el ruido (la relación señal/ruido crece como √N). Con 5–7 frames,
un error por carácter del ~5% cae a fracciones de porcentaje.

**Dónde encaja:** reemplazar el voto por cadena de `_procesar_multiframe`. Requiere que
FastALPR exponga confianza por carácter (ya devuelve `r.ocr.confidence` como lista por
carácter — ver `_confianza_ocr`). Si solo hubiera confianza global, degradar a voto
ponderado por confianza como paso intermedio.

### 2. Distancia de edición ponderada por matriz de confusión (MAP contra el diccionario)

**Hoy:** `placas_cercanas` / `_distancia_edicion_max1` en
[utils.py](backend/apps/vehiculos/utils.py) usan distancia de edición 1 **sin pesos**
(toda sustitución cuesta igual). Lo consume la query `sugerenciasPlaca` en
[schema.py](backend/apps/vehiculos/schema.py).

**Versión rigurosa:** usar una **matriz de confusión** `C(a,b)` = P(OCR lee `b` | real es
`a`), y definir la verosimilitud:

```
P(lectura | placa_candidata) = Π  C(placa_i , lectura_i)
                               i
```

Rankear los candidatos de la BD por esa probabilidad (es el término de verosimilitud del
MAP). Distingue un error plausible (`622-RXA` → `622-RYA`, muy probable) de uno absurdo
(`622-RXA` → `911-WKM`, imposible). Confusiones típicas a incluir: `0↔O`, `8↔B`, `5↔S`,
`1↔I`, `2↔Z`, `V↔Y`.

**Estimación de la matriz:** inicializar a mano con las confusiones conocidas de fuentes de
placa; refinar empíricamente con unas decenas de lecturas reales etiquetadas.

**Prior `P(placa)`:** enriquecer con dominio — un vehículo `es_frecuente` o que registró
entrada hace minutos es a priori más probable. Es meter conocimiento del negocio en la
ecuación bayesiana.

### 3. Regla de parada secuencial (SPRT) en vez de "2 lecturas iguales"

**Hoy:** [PlacaScanner.tsx](frontend/src/components/PlacaScanner.tsx) confirma con "misma
placa 2 veces seguidas" (`CONF_2X`) — heurístico sin garantía de error.

**Versión rigurosa:** Test de Razón de Probabilidad Secuencial (SPRT de Wald), o
equivalente, umbral sobre la probabilidad posterior acumulada:

```
Capturar frames hasta que:
   P(placa* | frames vistos) ≥ τ      (p.ej. τ = 0.999)  → ACEPTAR
   o agotar N frames                                     → RECHAZAR (manual)
```

`τ` fija **explícitamente la tasa de falsos positivos**. Convierte un umbral arbitrario en
una garantía estadística: "no acepto hasta estar 99.9% seguro; si no llego, escalo a humano".

### 4. Normalización geométrica previa (homografía)

Las placas llegan **en perspectiva/ángulo** (cámara de celular). Antes del OCR, rectificar la
placa a un rectángulo frontal con una **homografía** (transformación proyectiva 3×3):

```
[x']   [h11 h12 h13] [x]
[y'] = [h21 h22 h23] [y]
[w ]   [h31 h32  1 ] [1]
```

YOLOv9 ya da la región; con un detector de 4 puntos o detección de contornos se obtiene el
cuadrilátero y se resuelve la homografía con 4 correspondencias (`cv2.getPerspectiveTransform`
+ `cv2.warpPerspective`). Sube la precisión del OCR en placas inclinadas sin tocar el modelo.

### 5. Calibración de confianza

La "confianza" del modelo OCR **no es una probabilidad real** (suele estar mal calibrada:
un 0.9 no significa 90% de acierto). Antes de usar `τ` como umbral, calibrar con
**temperature scaling** o **Platt scaling** (ajuste de 1 parámetro sobre un set de
validación). Sin esto, cualquier umbral es ciego.

---

## El criterio de producción (decisión, no perfección)

"Que no falle" **no significa 100% de acierto** — ningún ANPR del mundo lo logra. Significa
**acotar la tasa de falsos aceptados** (dejar entrar al vehículo equivocado = el error caro)
y **enrutar lo incierto a un humano**. Teoría de la decisión:

| Acción | Cuándo | Garantía |
|---|---|---|
| ACEPTAR | posterior ≥ τ_alto | falsos positivos acotados por (1 − τ_alto) |
| SUGERIR (confirma guardia) | τ_bajo ≤ posterior < τ_alto | el humano valida |
| RECHAZAR (manual) | posterior < τ_bajo | nunca acepta a ciegas |

El punto de operación se elige sobre la curva ROC / precisión-recall según el costo de cada
error. Sistema defendible: no porque nunca se equivoque, sino porque **sus errores están
acotados y los inciertos los atrapa una persona**.

---

## Orden recomendado de implementación

1. **Palanca 1** (fusión por log-probabilidad por carácter en `_procesar_multiframe`) — mayor
   impacto, encaja en la arquitectura actual.
2. **Palanca 2** (ranking MAP con matriz de confusión sobre `sugerenciasPlaca`) — segundo mayor
   impacto.
3. **Palanca 5** (calibración) — barata, habilita umbrales con sentido.
4. **Palanca 3** (SPRT en el scanner) — convierte el heurístico "2x" en garantía.
5. **Palanca 4** (homografía) — la más costosa; dejar para el final salvo que las placas
   inclinadas sean el modo de fallo dominante en pruebas reales.

## Archivos involucrados (referencia)

- [backend/apps/vehiculos/ocr_view.py](backend/apps/vehiculos/ocr_view.py) — `_procesar_multiframe`, `_reconocer_fast_alpr`, `_confianza_ocr`
- [backend/apps/vehiculos/utils.py](backend/apps/vehiculos/utils.py) — `placas_cercanas`, `_distancia_edicion_max1`, `normalizar_placa`
- [backend/apps/vehiculos/schema.py](backend/apps/vehiculos/schema.py) — query `sugerenciasPlaca`
- [frontend/src/components/PlacaScanner.tsx](frontend/src/components/PlacaScanner.tsx) — lógica de confirmación (`CONF_AUTO`, `CONF_2X`)
