# Diccionario de Datos — Sistema de Control Vehicular UAGRM

> Documento generado a partir del modelo de datos real del sistema (Django ORM /
> PostgreSQL). Describe las **35 tablas** organizadas en **7 módulos**. Para cada
> tabla se detallan sus campos: nombre, tipo de dato, obligatoriedad, tipo de
> llave y descripción.

**Convenciones**

- **Tipo**: tipo de dato en la base de datos (PostgreSQL).
- **Nulo**: `No` = campo obligatorio (NOT NULL); `Sí` = admite valor vacío/nulo.
- **Llave**: `PK` = llave primaria, `FK` = llave foránea, `UQ` = único.
- Toda tabla incluye una llave primaria `id` de tipo `BIGINT` autoincremental.

**Índice de módulos**

1. [Usuarios y Seguridad](#1-módulo-usuarios-y-seguridad)
2. [Vehículos](#2-módulo-vehículos)
3. [Acceso / Control de portón](#3-módulo-acceso--control-de-portón)
4. [Parqueos](#4-módulo-parqueos)
5. [Visitantes](#5-módulo-visitantes)
6. [Infracciones y Sanciones](#6-módulo-infracciones-y-sanciones)
7. [Notificaciones](#7-módulo-notificaciones)

---

## 1. Módulo Usuarios y Seguridad

### Tabla `usuarios`
Personas del sistema (estudiantes, docentes, administrativos, guardias, administradores). Modelo de autenticación principal.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador único del usuario |
| ci | VARCHAR(20) | No | UQ | Cédula de identidad (sirve de nombre de usuario para login) |
| email | VARCHAR(254) | No | UQ | Correo electrónico único |
| nombre | VARCHAR(100) | No | | Nombre(s) |
| apellido | VARCHAR(100) | No | | Apellido(s) |
| telefono | VARCHAR(20) | Sí | | Teléfono de contacto (usado para WhatsApp) |
| whatsapp_activo | BOOLEAN | No | | Si recibe notificaciones por WhatsApp |
| foto | VARCHAR(100) | Sí | | Ruta de la foto de perfil |
| foto_url | VARCHAR(200) | Sí | | URL Cloudinary de la foto de perfil |
| password | VARCHAR(128) | No | | Contraseña cifrada (hash) |
| is_active | BOOLEAN | No | | Cuenta activa |
| is_staff | BOOLEAN | No | | Acceso al panel de administración de Django |
| is_superuser | BOOLEAN | No | | Superusuario con todos los permisos |
| date_joined | TIMESTAMP | No | | Fecha de alta de la cuenta |
| totp_secret | VARCHAR(64) | Sí | | Secreto TOTP para autenticación de doble factor (2FA) |
| totp_activo | BOOLEAN | No | | Si el usuario tiene 2FA activado |

### Tabla `roles`
Catálogo de roles del sistema (Administrador, Guardia, Estudiante, Docente, etc.).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador del rol |
| nombre | VARCHAR(80) | No | UQ | Nombre del rol |
| descripcion | TEXT | Sí | | Descripción del rol |
| is_active | BOOLEAN | No | | Rol activo |
| created_at | TIMESTAMP | No | | Fecha de creación |

### Tabla `permisos`
Catálogo de permisos granulares por módulo del sistema.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador del permiso |
| codigo | VARCHAR(60) | No | UQ | Código único del permiso |
| nombre | VARCHAR(120) | No | | Nombre legible |
| descripcion | TEXT | Sí | | Descripción del permiso |
| modulo | VARCHAR(30) | No | | Módulo al que aplica (usuarios, vehiculos, parqueos, acceso, visitantes, multas, notificaciones, reportes) |

### Tabla `usuario_roles`
Relación muchos-a-muchos entre usuarios y roles (un usuario puede tener varios roles).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| usuario_id | BIGINT | No | FK → usuarios | Usuario asignado |
| rol_id | BIGINT | No | FK → roles | Rol asignado |
| asignado_por_id | BIGINT | Sí | FK → usuarios | Quién asignó el rol |
| fecha_asignacion | TIMESTAMP | No | | Fecha de asignación |

> Restricción: par único (`usuario_id`, `rol_id`) — no se puede asignar el mismo rol dos veces al mismo usuario.

### Tabla `rol_permisos`
Relación muchos-a-muchos entre roles y permisos.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| rol_id | BIGINT | No | FK → roles | Rol |
| permiso_id | BIGINT | No | FK → permisos | Permiso otorgado al rol |

> Restricción: par único (`rol_id`, `permiso_id`).

---

## 2. Módulo Vehículos

### Tabla `tipos_vehiculo`
Catálogo de tipos de vehículo (automóvil, motocicleta, camioneta, etc.).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(60) | No | UQ | Nombre del tipo |
| descripcion | TEXT | Sí | | Descripción |

### Tabla `vehiculos`
Vehículos registrados en el sistema. Entidad central del control vehicular.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador del vehículo |
| placa | VARCHAR(20) | No | UQ | Placa del vehículo |
| tipo_id | BIGINT | No | FK → tipos_vehiculo | Tipo de vehículo |
| propietario_id | BIGINT | No | FK → usuarios | Dueño del vehículo |
| marca | VARCHAR(60) | No | | Marca |
| modelo | VARCHAR(60) | No | | Modelo |
| anio | SMALLINT | No | | Año de fabricación |
| color | VARCHAR(40) | No | | Color |
| estado | VARCHAR(15) | No | | Estado: pendiente / activo / inactivo / sancionado |
| en_alerta | BOOLEAN | No | | Alerta de seguridad (lista negra: robo/acceso revocado) |
| motivo_alerta | VARCHAR(200) | Sí | | Motivo de la alerta de seguridad |
| es_frecuente | BOOLEAN | No | | Vehículo de carril express (despacho inmediato) |
| foto | VARCHAR(100) | Sí | | Ruta de foto del vehículo |
| numero_motor | VARCHAR(30) | Sí | | Número de motor |
| numero_chasis | VARCHAR(30) | Sí | | Número de chasis |
| num_puertas | SMALLINT | Sí | | Número de puertas |
| cilindrada | VARCHAR(10) | Sí | | Cilindrada |
| color_hex | VARCHAR(7) | Sí | | Color en formato hexadecimal |
| foto_vehiculo | VARCHAR(200) | Sí | | URL de foto del vehículo |
| numero_soat | VARCHAR(30) | Sí | | Número de SOAT |
| capacidad_carga | VARCHAR(20) | Sí | | Capacidad de carga |
| codigo_qr | VARCHAR(64) | Sí | UQ | Hash SHA-256 estático (QR permanente legacy) |
| qr_secret | VARCHAR(64) | Sí | | Clave secreta del QR dinámico TOTP (nunca se expone al cliente) |
| created_at | TIMESTAMP | No | | Fecha de registro |

### Tabla `documentos_vehiculo`
Documentos asociados a un vehículo (SOAT, revisión técnica, permiso de circulación) con control de vencimiento.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | No | FK → vehiculos | Vehículo dueño del documento |
| tipo_doc | VARCHAR(15) | No | | Tipo: soat / tecnica / circulacion / otro |
| numero | VARCHAR(60) | No | | Número del documento |
| fecha_vencimiento | DATE | No | | Fecha de vencimiento |
| archivo | VARCHAR(100) | Sí | | Ruta del archivo escaneado |
| created_at | TIMESTAMP | No | | Fecha de registro |

### Tabla `vehiculo_estado_historial`
Historial de cambios de estado de un vehículo, con motivo y responsable (trazabilidad).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | No | FK → vehiculos | Vehículo |
| estado_anterior | VARCHAR(15) | Sí | | Estado antes del cambio |
| estado_nuevo | VARCHAR(15) | No | | Estado después del cambio |
| motivo | TEXT | Sí | | Motivo del cambio |
| usuario_id | BIGINT | Sí | FK → usuarios | Quién realizó el cambio |
| fecha | TIMESTAMP | No | | Fecha del cambio |

### Tabla `historial_propietarios`
Registro histórico de propietarios de un vehículo (transferencias de dueño).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | No | FK → vehiculos | Vehículo |
| usuario_id | BIGINT | No | FK → usuarios | Propietario en ese período |
| fecha_inicio | DATE | No | | Inicio de la propiedad |
| fecha_fin | DATE | Sí | | Fin de la propiedad (nulo = propietario actual) |

---

## 3. Módulo Acceso / Control de portón

### Tabla `puntos_acceso`
Puntos físicos de entrada/salida del campus (porterías).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(80) | No | | Nombre del punto |
| ubicacion | VARCHAR(150) | Sí | | Ubicación descriptiva |
| tipo | VARCHAR(8) | No | | entrada / salida / ambos |
| activo | BOOLEAN | No | | Punto operativo |
| latitud | DECIMAL(12,8) | Sí | | Latitud GPS |
| longitud | DECIMAL(12,8) | Sí | | Longitud GPS |

### Tabla `qr_delegaciones`
QR de delegación: el dueño autoriza a otra persona a usar su vehículo por un período limitado.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | No | FK → vehiculos | Vehículo delegado |
| codigo_hash | VARCHAR(64) | No | UQ | Hash del código del QR |
| motivo | VARCHAR(150) | Sí | | Razón de la delegación |
| tipo_delegacion | VARCHAR(8) | No | | entrada / salida / ambos |
| usos_max | SMALLINT | No | | Usos totales permitidos |
| usos_actual | SMALLINT | No | | Usos ya consumidos |
| tipo_destinatario | VARCHAR(12) | No | | externo / registrado (miembro UAGRM) |
| destinatario_nombre | VARCHAR(150) | Sí | | Nombre de quien puede usar el QR |
| destinatario_ci | VARCHAR(20) | Sí | | CI del destinatario (verificación en portería) |
| fecha_generacion | TIMESTAMP | No | | Fecha de generación |
| fecha_expiracion | TIMESTAMP | No | | Fecha de expiración |
| generado_por_id | BIGINT | Sí | FK → usuarios | Quién generó la delegación |

### Tabla `pases_temporales`
Pase temporal con código QR para visitantes pre-registrados o accesos puntuales.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | Sí | FK → vehiculos | Vehículo asociado (opcional) |
| visitante_id | BIGINT | Sí | FK → visitantes | Visitante asociado (opcional) |
| codigo | VARCHAR(20) | No | UQ | Código del pase |
| valido_desde | TIMESTAMP | No | | Inicio de validez |
| valido_hasta | TIMESTAMP | No | | Fin de validez |
| usos_max | SMALLINT | No | | Usos permitidos |
| usos_actual | SMALLINT | No | | Usos consumidos |
| activo | BOOLEAN | No | | Pase activo |
| generado_por_id | BIGINT | Sí | FK → usuarios | Quién generó el pase |

### Tabla `vehiculos_temporales`
Vehículos externos sin registro (proveedores, mantenimiento, emergencias, visitantes espontáneos), controlados por tiempo máximo.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| placa | VARCHAR(15) | No | | Placa del vehículo externo |
| tipo | VARCHAR(15) | No | | proveedor / mantenimiento / emergencia / visitante / otro |
| destino | VARCHAR(150) | No | | Destino dentro del campus |
| responsable | VARCHAR(100) | Sí | | Persona responsable |
| hora_ingreso | TIMESTAMP | No | | Hora de ingreso |
| hora_limite | TIMESTAMP | No | | Hora límite de permanencia |
| hora_salida | TIMESTAMP | Sí | | Hora de salida (nulo = aún dentro) |
| activo | BOOLEAN | No | | Acceso temporal vigente |
| observacion | TEXT | Sí | | Observaciones |
| registrado_por_id | BIGINT | Sí | FK → usuarios | Guardia que lo registró |

### Tabla `autorizaciones_acceso_externo`
Pre-autorización emitida para que un proveedor/contratista ingrese en una ventana horaria (cubre entrada + salida).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| placa | VARCHAR(15) | No | | Placa autorizada |
| empresa | VARCHAR(150) | No | | Empresa proveedora |
| motivo | VARCHAR(250) | No | | Motivo del acceso |
| dependencia_id | BIGINT | Sí | FK → dependencias_uagrm | Dependencia destino |
| email_proveedor | VARCHAR(254) | Sí | | Email para enviar el QR |
| autorizado_por_id | BIGINT | No | FK → usuarios | Administrativo que emitió la autorización |
| valido_desde | TIMESTAMP | No | | Inicio de validez |
| valido_hasta | TIMESTAMP | No | | Fin de validez |
| codigo_acceso | VARCHAR(24) | No | UQ | Código del QR de acceso |
| activo | BOOLEAN | No | | Autorización activa |
| usos_max | SMALLINT | No | | Usos permitidos (2 = entrada + salida) |
| usos_actual | SMALLINT | No | | Usos consumidos |
| usado | BOOLEAN | No | | True cuando se consumieron todos los usos |
| email_enviado | BOOLEAN | No | | Si el QR fue enviado por email |
| fecha_creacion | TIMESTAMP | No | | Fecha de emisión |
| observacion | TEXT | Sí | | Observaciones |

### Tabla `registros_acceso`
Registro de cada entrada/salida del campus. Bitácora principal del control de acceso.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| punto_acceso_id | BIGINT | No | FK → puntos_acceso | Portería donde ocurrió |
| vehiculo_id | BIGINT | Sí | FK → vehiculos | Vehículo (nulo si es acceso externo) |
| qr_delegacion_id | BIGINT | Sí | FK → qr_delegaciones | Delegación usada (si aplica) |
| pase_temporal_id | BIGINT | Sí | FK → pases_temporales | Pase temporal usado (si aplica) |
| tipo | VARCHAR(8) | No | | entrada / salida |
| metodo_acceso | VARCHAR(15) | No | | qr_dinamico / qr_permanente / qr_delegacion / pase_temporal / temporal / manual |
| timestamp | TIMESTAMP | No | | Fecha y hora del registro |
| observacion | TEXT | Sí | | Observaciones |
| imagen_url | VARCHAR(200) | Sí | | Foto del frame capturado por el OCR (evidencia) |
| registrado_por_id | BIGINT | Sí | FK → usuarios | Guardia responsable del registro |

### Tabla `ubicaciones_vehiculo`
Última posición GPS conocida de un vehículo dentro del campus (rastreo en vivo).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | No | FK → vehiculos (1:1) | Vehículo rastreado |
| latitud | DECIMAL(12,8) | No | | Latitud actual |
| longitud | DECIMAL(12,8) | No | | Longitud actual |
| velocidad | FLOAT | No | | Velocidad estimada (km/h) |
| timestamp | TIMESTAMP | No | | Última actualización |
| activo | BOOLEAN | No | | False cuando el vehículo sale del campus |

### Tabla `alertas_acceso`
Anomalías de acceso detectadas automáticamente por análisis diario (Celery).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | Sí | FK → vehiculos | Vehículo asociado a la anomalía |
| tipo_anomalia | VARCHAR(25) | No | | frecuencia_excesiva / horario_inusual / punto_inusual / vehiculo_sancionado / placas_similares / documento_vencido / vehiculo_en_alerta |
| severidad | VARCHAR(12) | No | | info / advertencia / critica |
| descripcion | TEXT | No | | Descripción de la anomalía |
| fecha | TIMESTAMP | No | | Fecha de detección |
| fecha_analisis | DATE | No | | Día analizado |
| revisada | BOOLEAN | No | | Si un administrador ya la revisó |
| revisada_por_id | BIGINT | Sí | FK → usuarios | Quién la revisó |
| fecha_revision | TIMESTAMP | Sí | | Fecha de revisión |
| datos_extra | JSON | No | | Datos adicionales de la anomalía |

### Tabla `audit_logs`
Registro de auditoría de todas las acciones sensibles del sistema.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| accion | VARCHAR(60) | No | | Código de la acción realizada |
| descripcion | TEXT | No | | Descripción legible de la acción |
| usuario_id | BIGINT | Sí | FK → usuarios | Quién realizó la acción |
| ip | VARCHAR(39) | Sí | | Dirección IP de origen |
| created_at | TIMESTAMP | No | | Fecha y hora de la acción |

---

## 4. Módulo Parqueos

### Tabla `categorias_espacios`
Categorías de espacios de parqueo (general, discapacidad, autoridades, etc.).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(60) | No | UQ | Nombre de la categoría |
| descripcion | TEXT | Sí | | Descripción |
| es_discapacidad | BOOLEAN | No | | Si es espacio reservado para discapacidad |
| color | VARCHAR(7) | No | | Color hex para el mapa visual |

### Tabla `zonas_parqueo`
Zonas de estacionamiento del campus (por facultad, edificio, sector).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(80) | No | UQ | Nombre de la zona |
| descripcion | TEXT | Sí | | Descripción |
| ubicacion | VARCHAR(150) | Sí | | Ubicación |
| capacidad_total | INTEGER | No | | Capacidad declarada (referencia) |
| activo | BOOLEAN | No | | Zona operativa |

### Tabla `espacios_parqueo`
Espacios/plazas individuales de parqueo dentro de una zona.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| zona_id | BIGINT | No | FK → zonas_parqueo | Zona a la que pertenece |
| categoria_id | BIGINT | No | FK → categorias_espacios | Categoría del espacio |
| numero | VARCHAR(10) | No | | Número/identificador del espacio |
| estado | VARCHAR(15) | No | | disponible / ocupado / reservado / mantenimiento |
| ubicacion_referencia | VARCHAR(100) | Sí | | Referencia de ubicación |

> Restricción: par único (`zona_id`, `numero`) — no se repite el número dentro de una zona.

### Tabla `sesiones_parqueo`
Ocupación de un espacio por un vehículo (registrado o temporal) entre entrada y salida.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| espacio_id | BIGINT | No | FK → espacios_parqueo | Espacio ocupado |
| vehiculo_id | BIGINT | Sí | FK → vehiculos | Vehículo registrado (uno de los dos) |
| vehiculo_temporal_id | BIGINT | Sí | FK → vehiculos_temporales | Vehículo temporal (uno de los dos) |
| hora_entrada | TIMESTAMP | No | | Hora de inicio de la sesión |
| hora_salida | TIMESTAMP | Sí | | Hora de fin (nulo = sesión activa) |
| estado | VARCHAR(10) | No | | activa / cerrada / cancelada |

> Restricciones de integridad: un vehículo no puede tener dos sesiones activas; un espacio no puede tener dos sesiones activas simultáneas.

---

## 5. Módulo Visitantes

### Tabla `tipos_visita`
Catálogo de tipos de visita (trámite, reunión, evento, etc.).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(60) | No | UQ | Nombre del tipo de visita |
| descripcion | TEXT | Sí | | Descripción |
| requiere_vehiculo | BOOLEAN | No | | Si el tipo obliga a especificar un vehículo |
| duracion_esperada_horas | SMALLINT | No | | Umbral en horas para notificar/auto-cerrar la visita |

### Tabla `dependencias_uagrm`
Unidades, facultades u oficinas de la UAGRM como destino de visita.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(120) | No | UQ | Nombre de la dependencia |
| codigo | VARCHAR(10) | No | UQ | Código corto |
| descripcion | TEXT | Sí | | Descripción |
| ubicacion | VARCHAR(120) | Sí | | Ubicación física |
| activo | BOOLEAN | No | | Dependencia activa |

### Tabla `visitantes`
Personas externas que visitan el campus.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(100) | No | | Nombre(s) |
| apellido | VARCHAR(100) | No | | Apellido(s) |
| ci | VARCHAR(20) | No | UQ | Cédula de identidad |
| telefono | VARCHAR(20) | Sí | | Teléfono |
| email | VARCHAR(254) | Sí | | Correo electrónico |
| foto | VARCHAR(100) | Sí | | Ruta de foto |
| procedencia | VARCHAR(120) | Sí | | Ciudad, empresa o institución de procedencia |
| placa_habitual | VARCHAR(20) | Sí | | Placa con la que suele venir (pre-llenada) |
| destino_sugerido_texto | VARCHAR(120) | Sí | | Destino indicado al pre-registrarse |
| created_at | TIMESTAMP | No | | Fecha de registro |

### Tabla `visitas`
Cada visita concreta de un visitante al campus, con anfitrión/destino, entrada y salida.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| visitante_id | BIGINT | No | FK → visitantes | Visitante |
| anfitrion_id | BIGINT | Sí | FK → usuarios | Miembro UAGRM que recibe la visita |
| dependencia_id | BIGINT | Sí | FK → dependencias_uagrm | Dependencia destino (si no hay anfitrión) |
| tipo_visita_id | BIGINT | Sí | FK → tipos_visita | Tipo de visita |
| vehiculo_id | BIGINT | Sí | FK → vehiculos | Vehículo registrado (si aplica) |
| vehiculo_temporal_id | BIGINT | Sí | FK → vehiculos_temporales | Vehículo temporal del visitante |
| motivo | TEXT | No | | Motivo de la visita |
| estado | VARCHAR(12) | No | | pendiente / activa / completada / cancelada |
| fecha_entrada | TIMESTAMP | Sí | | Hora de ingreso |
| fecha_salida | TIMESTAMP | Sí | | Hora de salida |
| observaciones | TEXT | Sí | | Observaciones |
| tipo_cierre | VARCHAR(25) | Sí | | manual_guardia / confirmado_anfitrion / auto |
| notificacion_anfitrion_enviada | BOOLEAN | No | | Si se avisó al anfitrión |
| num_acompanantes | SMALLINT | No | | Personas adicionales que ingresan |
| placa_vehiculo_visitante | VARCHAR(20) | Sí | | Placa externa en texto libre (o TAXI, A PIE, etc.) |
| created_at | TIMESTAMP | No | | Fecha de registro |

---

## 6. Módulo Infracciones y Sanciones

### Tabla `tipos_infraccion`
Catálogo de tipos de infracción con su gravedad y sanción sugerida.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| nombre | VARCHAR(100) | No | UQ | Nombre del tipo de infracción |
| descripcion | TEXT | Sí | | Descripción |
| gravedad | VARCHAR(10) | No | | leve / moderada / grave |
| tipo_sancion_sugerido | VARCHAR(20) | No | | amonestacion / multa_economica / suspension_acceso / reporte_bienestar |
| monto_base | DECIMAL(8,2) | Sí | | Monto sugerido si la sanción es económica |

### Tabla `infracciones`
El hecho registrado: un vehículo cometió una infracción. Separado de su consecuencia (sanción).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| vehiculo_id | BIGINT | No | FK → vehiculos | Vehículo infractor |
| tipo_id | BIGINT | No | FK → tipos_infraccion | Tipo de infracción |
| descripcion | TEXT | No | | Detalle de la infracción |
| fecha | TIMESTAMP | No | | Fecha del registro |
| estado | VARCHAR(12) | No | | registrada / apelada / confirmada / anulada |
| registrado_por_id | BIGINT | Sí | FK → usuarios | Quién la registró |
| evidencia | VARCHAR(100) | Sí | | Ruta de imagen de evidencia |

### Tabla `sanciones`
La consecuencia derivada de una infracción (relación 1:1). Puede ser económica o no.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| infraccion_id | BIGINT | No | FK → infracciones (1:1) | Infracción que origina la sanción |
| tipo_sancion | VARCHAR(20) | No | | amonestacion / multa_economica / suspension_acceso / reporte_bienestar |
| monto | DECIMAL(8,2) | Sí | | Monto (solo si es multa económica) |
| estado | VARCHAR(12) | No | | pendiente / en_revision / cumplida / cancelada |
| fecha | TIMESTAMP | No | | Fecha de creación |

### Tabla `pagos_sancion`
Pago de una sanción económica (relación 1:1 con la sanción).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| sancion_id | BIGINT | No | FK → sanciones (1:1) | Sanción pagada |
| fecha_pago | TIMESTAMP | No | | Fecha del pago |
| monto_pagado | DECIMAL(8,2) | No | | Monto pagado |
| metodo_pago | VARCHAR(15) | No | | efectivo / transferencia / qr_pago / banca_movil |
| comprobante | VARCHAR(100) | Sí | | Referencia del comprobante |
| comprobante_url | VARCHAR(200) | Sí | | URL del comprobante digital |
| referencia_pago | VARCHAR(60) | Sí | | Número de transacción bancaria |
| registrado_por_id | BIGINT | Sí | FK → usuarios | Quién registró el pago |

### Tabla `apelaciones_infraccion`
Apelación presentada por el usuario contra una infracción (relación 1:1).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| infraccion_id | BIGINT | No | FK → infracciones (1:1) | Infracción apelada |
| usuario_id | BIGINT | No | FK → usuarios | Quién apela |
| motivo | TEXT | No | | Argumento de la apelación |
| estado | VARCHAR(10) | No | | pendiente / aprobada / rechazada |
| respuesta | TEXT | Sí | | Respuesta de la administración |
| fecha | TIMESTAMP | No | | Fecha de presentación |
| fecha_resolucion | TIMESTAMP | Sí | | Fecha de resolución |
| resuelto_por_id | BIGINT | Sí | FK → usuarios | Quién resolvió la apelación |

---

## 7. Módulo Notificaciones

### Tabla `tipos_notificacion`
Catálogo de tipos de notificación con plantillas.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| codigo | VARCHAR(50) | No | UQ | Código único del tipo |
| nombre | VARCHAR(120) | No | | Nombre legible |
| descripcion | TEXT | Sí | | Descripción |
| plantilla_titulo | VARCHAR(200) | No | | Plantilla del título |
| plantilla_cuerpo | TEXT | No | | Plantilla del cuerpo |

### Tabla `notificaciones`
Notificaciones enviadas a los usuarios (in-app, en tiempo real vía WebSocket).

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| usuario_id | BIGINT | No | FK → usuarios | Destinatario |
| tipo_id | BIGINT | Sí | FK → tipos_notificacion | Tipo de notificación |
| titulo | VARCHAR(200) | No | | Título |
| mensaje | TEXT | No | | Cuerpo del mensaje |
| leido | BOOLEAN | No | | Si fue leída |
| fecha | TIMESTAMP | No | | Fecha de envío |
| datos_extra | JSON | Sí | | Datos adicionales (payload) |

### Tabla `preferencias_notificacion`
Preferencias de cada usuario sobre qué notificaciones recibir y por qué canal.

| Campo | Tipo | Nulo | Llave | Descripción |
|---|---|:---:|:---:|---|
| id | BIGINT | No | PK | Identificador |
| usuario_id | BIGINT | No | FK → usuarios | Usuario |
| tipo_id | BIGINT | No | FK → tipos_notificacion | Tipo de notificación |
| activo | BOOLEAN | No | | Si desea recibir este tipo |
| canal | VARCHAR(12) | No | | email / push / websocket |

> Restricción: terna única (`usuario_id`, `tipo_id`, `canal`).

---

## Resumen de relaciones principales

- Un **Usuario** puede tener muchos **Roles** (vía `usuario_roles`) y muchos **Vehículos**.
- Un **Vehículo** pertenece a un **Usuario** (propietario), tiene muchos **Documentos**, **Registros de acceso**, **Infracciones** y **Sesiones de parqueo**.
- Una **Infracción** genera una **Sanción** (1:1); una sanción económica genera un **Pago** (1:1); una infracción puede tener una **Apelación** (1:1).
- Una **Zona de parqueo** contiene muchos **Espacios**; cada **Espacio** tiene muchas **Sesiones** a lo largo del tiempo.
- Un **Visitante** genera muchas **Visitas**; cada **Visita** tiene un **anfitrión** (usuario) o una **dependencia** de destino.
- Cada **Registro de acceso** ocurre en un **Punto de acceso** y puede vincularse a un **QR de delegación** o un **Pase temporal**.
