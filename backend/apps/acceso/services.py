"""
Capa de servicio para el módulo de Acceso.
Centraliza la lógica de validación de vehículos y resolución de códigos QR,
eliminando la duplicación entre registrar_acceso, registrar_acceso_manual y
futuras implementaciones (ej. integración con cámara LPR).

Principio SOLID aplicado: Single Responsibility — cada método tiene
exactamente una razón para cambiar.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from django.db import transaction
from django.utils import timezone


# ── Tipos de resultado ─────────────────────────────────────────────────────

@dataclass
class ResultadoValidacion:
    """Resultado de resolver un código QR o placa."""
    vehiculo: object                  # apps.vehiculos.models.Vehiculo
    qr_delegacion: Optional[object]   # apps.acceso.models.QrSesion | None
    pase_temporal: Optional[object]   # apps.acceso.models.PaseTemporal | None
    metodo_acceso: str


# ── Validación de estado de vehículo ──────────────────────────────────────

def validar_estado_vehiculo(vehiculo) -> None:
    """
    Verifica que el vehículo puede acceder al campus.
    Lanza Exception con mensaje claro si está bloqueado.
    Centraliza la lógica para no duplicarla en cada nivel de validación.
    """
    MENSAJES = {
        "pendiente":  "Vehículo pendiente de aprobación. Espere la confirmación del administrador.",
        "sancionado": "Vehículo sancionado. Regularice sus multas pendientes para poder acceder.",
        "inactivo":   "Vehículo inactivo. Comuníquese con la administración.",
    }
    if vehiculo.estado in MENSAJES:
        raise Exception(MENSAJES[vehiculo.estado])


# ── Resolución de código (TOTP → delegación → pase) ───────────────────────

def resolver_codigo(codigo: str) -> ResultadoValidacion:
    """
    Resuelve un código escaneado por el guardia en el Panel Guardia.
    Intenta en orden de prioridad:
      1. QR dinámico TOTP (8 dígitos, cambia cada 30s) — O(1) via caché Redis
      2. QR de delegación SHA-256 (single-use, con expiración)
      3. Pase temporal alfanumérico (multi-uso con ventana horaria)

    Toda operación de escritura (marcar QR como usado, incrementar usos)
    se envuelve en transaction.atomic() + select_for_update() para evitar
    race conditions en hora pico (200+ accesos/hora en la UAGRM).

    Raises:
        Exception: con mensaje legible para mostrar al guardia en la tablet.
    """
    from apps.vehiculos.models import Vehiculo, validar_qr_dinamico
    from apps.acceso.models import QrSesion, PaseTemporal

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

    # ── Nivel 2: QR de delegación (single-use, atómico) ──────────────────
    with transaction.atomic():
        qr = (
            QrSesion.objects
            .select_for_update(nowait=True)  # falla rápido si otro proceso lo tiene
            .filter(codigo_hash=codigo_limpio, usado=False)
            .select_related("vehiculo")
            .first()
        )
        if qr:
            if qr.fecha_expiracion <= timezone.now():
                raise Exception("QR de delegación expirado.")
            validar_estado_vehiculo(qr.vehiculo)
            qr.usado = True
            qr.save(update_fields=["usado"])
            return ResultadoValidacion(
                vehiculo=qr.vehiculo,
                qr_delegacion=qr,
                pase_temporal=None,
                metodo_acceso="qr_delegacion",
            )

    # ── Nivel 3: Pase temporal (multi-uso atómico) ────────────────────────
    with transaction.atomic():
        pase = (
            PaseTemporal.objects
            .select_for_update(nowait=True)
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
            pase.usos_actual += 1
            pase.save(update_fields=["usos_actual"])
            return ResultadoValidacion(
                vehiculo=pase.vehiculo,
                qr_delegacion=None,
                pase_temporal=pase,
                metodo_acceso="pase_temporal",
            )

    raise Exception("Código no reconocido. Verifique el QR o el código del pase temporal.")


# ── Resolución TOTP con caché Redis ───────────────────────────────────────

def _resolver_totp(codigo: str):
    """
    Busca el vehículo correspondiente al código TOTP.

    Estrategia de caché:
    - Intenta resolver vía Django cache (Redis en producción).
    - Si no hay entrada en caché, recorre vehículos activos con secret
      y almacena el resultado para los próximos 55 segundos.

    La caché se invalida automáticamente; si un vehículo es sancionado
    o desactivado, el próximo ciclo de 30s lo excluirá.
    """
    from apps.vehiculos.models import Vehiculo, validar_qr_dinamico
    from django.core.cache import cache

    cache_key = f"totp_vehiculo_{codigo}"
    vehiculo_id = cache.get(cache_key)

    if vehiculo_id:
        vehiculo = Vehiculo.objects.filter(pk=vehiculo_id, estado="activo").first()
        if vehiculo:
            return vehiculo

    # Fallback: buscar en BD (solo si caché no tiene la entrada)
    vehiculos = (
        Vehiculo.objects
        .filter(estado="activo", qr_secret__gt="")
        .only("id", "placa", "estado", "qr_secret", "propietario_id")
    )
    for v in vehiculos:
        if validar_qr_dinamico(v.qr_secret, codigo):
            cache.set(cache_key, v.pk, timeout=55)
            return v

    return None
