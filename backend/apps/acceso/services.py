"""
Capa de servicio para el módulo de Acceso.

Concurrencia: usa optimistic locking (UPDATE WHERE) en lugar de SELECT FOR UPDATE.
Ventajas: sin bloqueos de BD, funciona en tests, y en producción maneja
correctamente dos guardias escaneando el mismo QR al mismo microsegundo.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from django.utils import timezone


@dataclass
class ResultadoValidacion:
    vehiculo:              object
    qr_delegacion:         Optional[object]
    pase_temporal:         Optional[object]
    metodo_acceso:         str
    autorizacion_externa:  Optional[object] = None  # AutorizacionAccesoExterno


def validar_estado_vehiculo(vehiculo) -> None:
    """
    Centraliza la validación de estado para no duplicarla en cada nivel.
    Raises Exception con mensaje claro para mostrar al guardia en tablet.
    """
    MENSAJES = {
        "pendiente":  "Vehículo pendiente de aprobación. Espere confirmación del administrador.",
        "sancionado": "Vehículo sancionado. Regularice sus sanciones pendientes.",
        "inactivo":   "Vehículo inactivo. Comuníquese con la administración.",
    }
    if vehiculo.estado in MENSAJES:
        raise Exception(MENSAJES[vehiculo.estado])


def resolver_codigo(codigo: str, tipo_acceso: str = None) -> ResultadoValidacion:
    """
    Resuelve un código escaneado en 4 niveles de prioridad.
    Usa optimistic locking (UPDATE WHERE) para garantizar atomicidad
    sin bloqueos de base de datos — testeable y escalable.

    tipo_acceso ("entrada"|"salida") se usa para validar que el QR de delegación
    coincida con el tipo permitido ANTES de consumir el uso, evitando desperdiciar
    usos en accesos del tipo incorrecto.
    """
    from apps.vehiculos.models import Vehiculo, validar_qr_dinamico
    from apps.acceso.models import QrSesion, PaseTemporal
    from django.db.models import F

    codigo_limpio = codigo.strip()

    # ── Nivel 1: QR dinámico TOTP ────────────────────────────────────────
    if codigo_limpio.isdigit() and len(codigo_limpio) == 8:
        vehiculo = _resolver_totp(codigo_limpio)
        if vehiculo:
            validar_estado_vehiculo(vehiculo)
            return ResultadoValidacion(
                vehiculo=vehiculo,
                qr_delegacion=None,
                pase_temporal=None,
                metodo_acceso="qr_dinamico",
            )

    # ── Nivel 2: QR estático SHA-256 (legacy, compatibilidad) ───────────────
    vehiculo_legacy = (
        Vehiculo.objects.filter(codigo_qr=codigo_limpio).first()
    )
    if vehiculo_legacy:
        validar_estado_vehiculo(vehiculo_legacy)
        return ResultadoValidacion(
            vehiculo=vehiculo_legacy,
            qr_delegacion=None,
            pase_temporal=None,
            metodo_acceso="qr_permanente",
        )

    # ── Nivel 3: QR de delegación (optimistic locking con usos) ──────────
    qr = (
        QrSesion.objects
        .filter(codigo_hash=codigo_limpio)
        .filter(usos_actual__lt=F("usos_max"))   # tiene usos disponibles
        .select_related("vehiculo")
        .first()
    )
    if qr:
        if qr.fecha_expiracion <= timezone.now():
            raise Exception("QR de delegación expirado.")

        # Validar tipo ANTES de consumir el uso — no desperdiciar un uso
        if tipo_acceso and qr.tipo_delegacion != "ambos" and qr.tipo_delegacion != tipo_acceso:
            tipo_label = "entrada" if qr.tipo_delegacion == "entrada" else "salida"
            raise Exception(
                f"Este QR de delegación solo permite {tipo_label}. "
                f"No puede usarse para registrar {tipo_acceso}."
            )

        validar_estado_vehiculo(qr.vehiculo)

        # Optimistic locking: UPDATE WHERE usos_actual=X — si otro guardia
        # lo usó en paralelo, actualizado=0 y el guardia reintenta.
        usos_previos = qr.usos_actual
        actualizado = QrSesion.objects.filter(
            pk=qr.pk, usos_actual=usos_previos
        ).update(usos_actual=usos_previos + 1)
        if actualizado == 0:
            raise Exception("Este QR fue utilizado al mismo tiempo por otro guardia. Reintente.")

        qr.usos_actual = usos_previos + 1
        return ResultadoValidacion(
            vehiculo=qr.vehiculo,
            qr_delegacion=qr,
            pase_temporal=None,
            metodo_acceso="qr_delegacion",
        )

    # ── Nivel 3: Pase temporal (optimistic locking en usos) ───────────────
    pase = (
        PaseTemporal.objects
        .filter(codigo=codigo_limpio, activo=True)
        .select_related("vehiculo")
        .first()
    )
    if pase:
        ahora = timezone.now()
        if not (pase.valido_desde <= ahora <= pase.valido_hasta):
            raise Exception("Pase temporal fuera de la ventana horaria permitida.")
        if pase.usos_actual >= pase.usos_max:
            raise Exception("Pase temporal agotado. Se alcanzó el límite de usos.")
        if pase.vehiculo:
            validar_estado_vehiculo(pase.vehiculo)
        # UPDATE WHERE usos_actual=X — si otro guardia lo usó en paralelo, actualizado=0
        usos_previos = pase.usos_actual
        actualizado = PaseTemporal.objects.filter(
            pk=pase.pk, usos_actual=usos_previos
        ).update(usos_actual=usos_previos + 1)
        if actualizado == 0:
            raise Exception("El pase fue modificado concurrentemente. Reintente el escaneo.")
        pase.usos_actual = usos_previos + 1
        return ResultadoValidacion(
            vehiculo=pase.vehiculo,
            qr_delegacion=None,
            pase_temporal=pase,
            metodo_acceso="pase_temporal",
        )

    # ── Nivel 4: Autorización de acceso externo (proveedor/contratista) ─────
    # Código de 24 chars hexadecimal generado al crear la autorización.
    # Optimistic locking: UPDATE WHERE usado=False garantiza un solo uso atómico.
    from apps.acceso.models import AutorizacionAccesoExterno

    auth = (
        AutorizacionAccesoExterno.objects
        .filter(codigo_acceso=codigo_limpio, activo=True, usado=False)
        .select_related("dependencia", "autorizado_por")
        .first()
    )
    if auth:
        ahora = timezone.now()
        if ahora < auth.valido_desde:
            raise Exception(
                f"Autorización aún no válida. Disponible desde {auth.valido_desde.strftime('%d/%m %H:%M')}."
            )
        if ahora > auth.valido_hasta:
            raise Exception(
                f"Autorización vencida. Era válida hasta {auth.valido_hasta.strftime('%d/%m %H:%M')}."
            )
        actualizado = AutorizacionAccesoExterno.objects.filter(
            pk=auth.pk, usado=False
        ).update(usado=True)
        if actualizado == 0:
            raise Exception("Esta autorización ya fue utilizada por otro guardia.")
        auth.usado = True
        return ResultadoValidacion(
            vehiculo=None,
            qr_delegacion=None,
            pase_temporal=None,
            metodo_acceso="temporal",
            autorizacion_externa=auth,
        )

    raise Exception("Código no reconocido. Verifique el QR o el código del pase temporal.")


def _resolver_totp(codigo: str):
    """
    Busca el vehículo correspondiente al código TOTP vía caché Redis (O(1)).
    Solo busca vehículos activos — los sancionados/pendientes deben usar
    el flujo manual o presentar su placa al guardia.
    """
    from apps.vehiculos.models import Vehiculo, validar_qr_dinamico
    from django.core.cache import cache

    cache_key = f"totp_vehiculo_{codigo}"
    vehiculo_id = cache.get(cache_key)

    if vehiculo_id:
        vehiculo = Vehiculo.objects.filter(pk=vehiculo_id, estado="activo").first()
        if vehiculo:
            return vehiculo

    for v in Vehiculo.objects.filter(estado="activo", qr_secret__gt="").only(
        "id", "placa", "estado", "qr_secret", "propietario_id"
    ):
        if validar_qr_dinamico(v.qr_secret, codigo):
            cache.set(cache_key, v.pk, timeout=55)
            return v

    return None
