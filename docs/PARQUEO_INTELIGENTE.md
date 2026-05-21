# Parqueo Inteligente UAGRM — Plan de Implementación Real

> **Estado actual:** DEMO funcional en `/parqueo-demo`
> **Este documento:** guía completa para pasar del demo a producción real

---

## Resumen de la solución

Sistema de guía de parqueo en tiempo real para el campus UAGRM que combina:
- QR fijo por zona de parqueo (3 stickers, uno por zona)
- Navegación vía Google Maps / Waze desde la entrada hasta la zona asignada
- Rastreo de sesión: entrada → zona confirmada → salida
- Liberación automática de zona al registrar salida en puerta

---

## Arquitectura de producción

```
[Vehículo entra]
       ↓
[Guardia escanea QR dinámico TOTP en puerta]
       ↓
[Backend: RegistroAcceso creado + algoritmo de asignación]
       ↓
[Notificación push al propietario: zona asignada + link de navegación]
       ↓
[Google Maps abre con coordenadas GPS de la zona]
       ↓
[Propietario llega a la zona → escanea QR fijo de zona]
       ↓
[Backend: SesionParqueo creada + zona marcada OCUPADA]
       ↓
[Propietario va a clases — temporizador activo]
       ↓
[Al acercarse la hora estimada → notificación recordatorio]
       ↓
[Guardia registra salida en puerta de salida]
       ↓
[Backend: SesionParqueo cerrada + zona liberada + duración calculada]
```

---

## Hardware requerido

### QR físicos por zona (3 unidades)

| Zona | Ubicación del QR | Coordenadas GPS |
|------|------------------|-----------------|
| Zona A | Entrada bloque administrativo | -17.7878, -63.1872 |
| Zona B | Entrada bloque facultades | -17.7901, -63.1875 |
| Zona C | Entrada biblioteca central | -17.7915, -63.1862 |

**Especificaciones del sticker:**
- Tamaño mínimo: 15x15 cm para escaneo desde celular
- Laminado resistente a agua y rayos UV
- Montaje: panel metálico a 1.5m de altura en la entrada de cada zona
- Contenido del QR: URL con identificador de zona + token de verificación
  - Ejemplo: `https://control-vehicular-production.up.railway.app/api/parqueo/zona/B/confirmar/?token=XXXX`

**Costo estimado:** 3 stickers laminados + paneles ≈ Bs 150-300

---

## Cambios en base de datos requeridos

### 1. Tabla `zonas_parqueo` — agregar coordenadas GPS

```sql
ALTER TABLE zonas_parqueo ADD COLUMN latitud DECIMAL(10, 7);
ALTER TABLE zonas_parqueo ADD COLUMN longitud DECIMAL(10, 7);
ALTER TABLE zonas_parqueo ADD COLUMN qr_token VARCHAR(64) UNIQUE;
ALTER TABLE zonas_parqueo ADD COLUMN url_navegacion_gmaps TEXT;
ALTER TABLE zonas_parqueo ADD COLUMN url_navegacion_waze TEXT;
```

### 2. Tabla `sesiones_parqueo` — vincular con acceso

```sql
ALTER TABLE sesiones_parqueo ADD COLUMN registro_acceso_entrada_id INTEGER REFERENCES registros_acceso(id);
ALTER TABLE sesiones_parqueo ADD COLUMN registro_acceso_salida_id INTEGER REFERENCES registros_acceso(id);
ALTER TABLE sesiones_parqueo ADD COLUMN tiempo_estimado_minutos INTEGER;
ALTER TABLE sesiones_parqueo ADD COLUMN confirmada_por_qr BOOLEAN DEFAULT FALSE;
ALTER TABLE sesiones_parqueo ADD COLUMN estado VARCHAR(20) DEFAULT 'en_ruta';
-- Estados: en_ruta → confirmada → finalizada | expirada
```

### 3. Tabla `alertas_zona` (nueva)

```sql
CREATE TABLE alertas_zona (
  id SERIAL PRIMARY KEY,
  zona_id INTEGER REFERENCES zonas_parqueo(id),
  tipo VARCHAR(30), -- 'capacidad_alta', 'vehiculo_sin_confirmar', 'sobretiempo'
  descripcion TEXT,
  fecha TIMESTAMPTZ DEFAULT NOW(),
  resuelta BOOLEAN DEFAULT FALSE
);
```

---

## Cambios en el backend Django

### Nuevo endpoint: `POST /api/parqueo/zona/<zona_id>/confirmar/`

Recibe el escaneo del QR físico de zona. Crea la `SesionParqueo` y marca la zona.

```python
# Lógica principal:
# 1. Validar token del QR (evitar escaneos falsos)
# 2. Buscar el RegistroAcceso más reciente del vehículo sin SesionParqueo asignada
# 3. Crear SesionParqueo vinculada
# 4. Marcar el espacio como ocupado vía WebSocket
# 5. Enviar notificación de confirmación al propietario
# 6. Registrar tiempo estimado si el usuario lo declaró
```

### Modificar `registrar_acceso` (salida)

Cuando el guardia registra la salida del vehículo, automáticamente:

```python
# Al registrar salida:
# 1. Buscar SesionParqueo activa del vehículo
# 2. Cerrar sesión: hora_salida = now(), duracion = calculada
# 3. Liberar zona: decrementar ocupación
# 4. Emitir WebSocket: zona actualizada en el mapa
# 5. Enviar resumen al propietario: duración, zona usada
```

### Algoritmo de asignación de zona

```python
def asignar_zona_optima(vehiculo, punto_acceso):
    """
    Asigna la mejor zona disponible considerando:
    1. Rol del propietario (docente → Zona A prioritaria)
    2. Disponibilidad actual (zonas con >80% ocupación se evitan)
    3. Proximidad al punto de acceso donde entró el vehículo
    4. Reservas previas del propietario
    """
    zonas_disponibles = ZonaParqueo.objects.filter(
        activa=True,
        ocupacion_actual__lt=F('capacidad')
    ).annotate(
        disponibilidad=ExpressionWrapper(
            1 - F('ocupacion_actual') / F('capacidad'),
            output_field=FloatField()
        )
    ).order_by('-disponibilidad')

    # Filtrar por rol
    if tiene_rol(vehiculo.propietario, 'Docente'):
        zonas_prioritarias = zonas_disponibles.filter(permite_docentes=True)
        if zonas_prioritarias.exists():
            return zonas_prioritarias.first()

    return zonas_disponibles.first()
```

### Celery task: verificar vehículos sin confirmar zona

```python
# Corre cada 5 minutos
@shared_task
def verificar_vehiculos_sin_zona():
    limite = timezone.now() - timedelta(minutes=20)
    sin_confirmar = RegistroAcceso.objects.filter(
        tipo='entrada',
        timestamp__gte=limite,
        sesionparqueo__isnull=True
    )
    for acceso in sin_confirmar:
        # Notificar al propietario
        # Alertar al guardia si pasaron más de 20 min
```

### Celery task: recordatorio de tiempo estimado

```python
@shared_task
def recordatorio_tiempo_parqueo():
    proximas = SesionParqueo.objects.filter(
        estado='confirmada',
        hora_estimada_salida__lte=timezone.now() + timedelta(minutes=15),
        recordatorio_enviado=False
    )
    for sesion in proximas:
        enviar_notificacion(
            usuario=sesion.vehiculo.propietario,
            titulo=f"⏰ Tu tiempo de parqueo termina en 15 min",
            mensaje=f"Tu vehículo {sesion.vehiculo.placa} en Zona {sesion.zona.nombre}. ¿Sales pronto?"
        )
        sesion.recordatorio_enviado = True
        sesion.save()
```

---

## Cambios en el frontend React

### Nueva pantalla en la app del propietario (post-entrada)

Cuando el propietario recibe la notificación de zona asignada, la app muestra:

```
┌─────────────────────────────────────────┐
│  Tu vehículo fue admitido               │
│  SCZ-3456 · 08:23 AM                    │
│                                         │
│  Te recomendamos:                       │
│  ┌─────────────────────────────┐        │
│  │ 🅿 ZONA B — Facultades      │        │
│  │ 23 espacios disponibles    │        │
│  │ 5 min caminando            │        │
│  └─────────────────────────────┘        │
│                                         │
│  [🗺 Llevarme hasta allá]               │
│  (Abre Google Maps / Waze / Yango)      │
└─────────────────────────────────────────┘
```

### Deep links de navegación por zona

```typescript
// Al tocar "Llevarme hasta allá":
function abrirNavegacion(zona: Zona, app: 'gmaps' | 'waze' | 'yango') {
  const coords = `${zona.latitud},${zona.longitud}`
  const urls = {
    gmaps: `https://www.google.com/maps/dir/?api=1&destination=${coords}&travelmode=driving`,
    waze:  `https://waze.com/ul?ll=${coords}&navigate=yes`,
    yango: `https://yandex.com/maps/?rtext=~${coords}&rtt=auto`,
  }
  window.open(urls[app], '_blank')
}
```

### Mapa de parqueo en tiempo real (admin)

Panel administrativo mostrando todas las zonas con ocupación en tiempo real, 
actualizado vía WebSocket cada vez que un vehículo confirma o sale.

---

## Plan de instalación física en el campus

### Paso 1: Levantamiento de coordenadas GPS (1 día)
- Visitar cada zona con un celular y registrar coordenadas exactas
- Fotografiar la ubicación donde irá el panel QR
- Actualizar la base de datos con las coordenadas reales

### Paso 2: Generar QR únicos por zona (1 hora)
- Generar desde el panel admin de la app
- Cada QR contiene el ID de zona + token de seguridad rotatorio mensual
- Imprimir en formato A4 mínimo, plastificar con laminado UV

### Paso 3: Instalación de paneles (1 día con personal de mantenimiento)
- Montar panel metálico de 30x30 cm en la entrada de cada zona
- Altura: 1.4-1.6 m para escaneo cómodo desde el celular
- Protección: cubierta acrílica anti-rayadura, resistente a lluvia

### Paso 4: Capacitación de guardias (2 horas)
- El flujo del guardia no cambia en la entrada (mismo QR del vehículo)
- Solo aprenden: qué significa "vehículo sin confirmar zona" en su panel
- Cómo hacer verificación manual cuando el sistema alerta

### Paso 5: Comunicación a usuarios (1 semana antes del lanzamiento)
- Cartel en la entrada: "Nuevo sistema de parqueo inteligente"
- Tutorial en la app mostrando el flujo de 3 pasos
- Email/notificación a todos los propietarios registrados

---

## Métricas de éxito para evaluar la implementación

| Métrica | Meta a 30 días |
|---------|---------------|
| % de vehículos que confirman zona | > 70% |
| Tiempo promedio desde entrada hasta confirmación QR zona | < 8 minutos |
| Reducción de conflictos por espacios doble-ocupados | > 60% |
| Satisfacción del propietario (encuesta) | > 4/5 |
| Alertas de "vehículo sin confirmar" por día | < 10% del total |

---

## Costos estimados de implementación

| Item | Costo estimado |
|------|---------------|
| 3 stickers QR laminados grandes | Bs 60-90 |
| 3 paneles metálicos + instalación | Bs 150-300 |
| Capacitación de guardias (2h) | Bs 0 (interno) |
| Desarrollo backend/frontend | Ya implementado en demo |
| **Total** | **Bs 210-390** |

---

## Cronograma sugerido

| Semana | Actividad |
|--------|-----------|
| 1 | Levantamiento GPS + generación de QR |
| 2 | Instalación física de paneles |
| 3 | Prueba piloto con 10 vehículos voluntarios |
| 4 | Lanzamiento oficial + monitoreo |

---

*Documento creado: 2026-05-21*
*Demo funcional en: `/parqueo-demo`*
*Stack: Django + Strawberry GraphQL + Celery + React + Leaflet + Google Maps deep links*
