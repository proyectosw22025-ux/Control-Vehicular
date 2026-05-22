"""
Tarea Celery: control automático de salida de visitantes.

Arquitectura de 3 capas:
  Capa 1 — Al alcanzar el umbral (duracion_esperada_horas): notifica al anfitrión
           "¿Tu visitante ya salió?" → el anfitrión confirma o ignora.
  Capa 2 — Si 90 minutos después el anfitrión no respondió: auto-cierra con
           tipo_cierre='auto', siendo EXPLÍCITO en el historial que no fue verificado.
  Capa 3 — El historial distingue 3 tipos de cierre para no mezclar datos ciertos
           con datos inciertos.

Ejecutada cada 30 minutos por Celery Beat.
"""
from celery import shared_task
from django.utils import timezone
from datetime import timedelta

GRACIA_ANTES_NOTIFICAR_MIN  = 0    # notificar exactamente al llegar al umbral
GRACIA_ANTES_AUTO_CERRAR_MIN = 90  # 90 min después de notificar → auto-cierre


@shared_task(name="visitantes.auto_cerrar_visitas")
def auto_cerrar_visitas():
    """
    Corre cada 30 minutos. Gestiona visitas activas que superaron su umbral de tiempo.
    """
    from .models import Visita
    ahora = timezone.now()

    visitas_activas = (
        Visita.objects
        .filter(estado="activa", fecha_entrada__isnull=False)
        .select_related("visitante", "anfitrion", "tipo_visita")
    )

    notificadas = 0
    cerradas    = 0

    for visita in visitas_activas:
        duracion_horas = visita.tipo_visita.duracion_esperada_horas if visita.tipo_visita else 4
        umbral         = visita.fecha_entrada + timedelta(hours=duracion_horas)
        auto_cierre_t  = umbral + timedelta(minutes=GRACIA_ANTES_AUTO_CERRAR_MIN)

        if ahora < umbral:
            continue  # Dentro del tiempo esperado — no hacer nada

        # ── Capa 2: auto-cerrar si ya pasó la gracia ──────────────────────
        if ahora >= auto_cierre_t and visita.notificacion_anfitrion_enviada:
            visita.estado      = "completada"
            visita.fecha_salida = ahora
            visita.tipo_cierre  = "auto"
            visita.observaciones = (
                f"[Sistema] Auto-cerrada tras {duracion_horas}h + 90 min sin confirmación del anfitrión. "
                "La salida del visitante NO fue verificada manualmente."
            )
            visita.save(update_fields=["estado", "fecha_salida", "tipo_cierre", "observaciones"])
            cerradas += 1
            continue

        # ── Capa 1: notificar al anfitrión si aún no se notificó ──────────
        if not visita.notificacion_anfitrion_enviada:
            _notificar_verificacion(visita, duracion_horas)
            visita.notificacion_anfitrion_enviada = True
            visita.save(update_fields=["notificacion_anfitrion_enviada"])
            notificadas += 1

    return {"notificadas": notificadas, "auto_cerradas": cerradas}


def _notificar_verificacion(visita, duracion_horas: int) -> None:
    """Envía notificación al anfitrión para que confirme la salida del visitante."""
    try:
        from apps.notificaciones.utils import enviar_notificacion
        nombre_visitante = f"{visita.visitante.nombre} {visita.visitante.apellido}"
        enviar_notificacion(
            usuario=visita.anfitrion,
            titulo=f"¿Ya salió tu visitante? — {nombre_visitante}",
            mensaje=(
                f"{nombre_visitante} (CI: {visita.visitante.ci}) lleva más de {duracion_horas}h "
                f"registrado en el campus. Si ya se retiró, confirma la salida desde "
                f"Notificaciones para mantener el registro actualizado."
            ),
            tipo_codigo="verificar_salida_visitante",
            datos_extra={
                "visita_id":        visita.id,
                "visitante_nombre": nombre_visitante,
                "visitante_ci":     visita.visitante.ci,
            },
        )
    except Exception:
        pass
