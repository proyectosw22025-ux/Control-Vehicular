from typing import Optional
from celery import shared_task
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer  # type: ignore[import-untyped]


def _enviar_notificacion_ws(usuario_id: int, titulo: str, mensaje: str, tipo_codigo: Optional[str] = None, datos_extra: Optional[dict] = None):
    """Crea la notificación en BD y la entrega por WebSocket si hay canal activo."""
    from .models import TipoNotificacion, Notificacion
    from django.contrib.auth import get_user_model
    Usuario = get_user_model()
    try:
        usuario = Usuario.objects.get(pk=usuario_id)
    except Usuario.DoesNotExist:
        return None
    tipo = TipoNotificacion.objects.filter(codigo=tipo_codigo).first() if tipo_codigo else None
    notif = Notificacion.objects.create(
        usuario=usuario,
        tipo=tipo,
        titulo=titulo,
        mensaje=mensaje,
        datos_extra=datos_extra or {},
    )
    channel_layer = get_channel_layer()
    if channel_layer is not None:
        try:
            async_to_sync(channel_layer.group_send)(
                f"notificaciones_usuario_{usuario_id}",
                {
                    "type": "notificacion_nueva",
                    "id": notif.pk,
                    "titulo": notif.titulo,
                    "mensaje": notif.mensaje,
                    "fecha": notif.fecha.isoformat(),
                },
            )
        except Exception:
            pass
    return notif


@shared_task(name="notificaciones.notificar_infraccion")
def notificar_infraccion(usuario_id: int, placa: str, monto: str):
    _enviar_notificacion_ws(
        usuario_id=usuario_id,
        titulo="Nueva infracción registrada",
        mensaje=f"Su vehículo {placa} tiene una sanción de Bs {monto}.",
        tipo_codigo="infraccion_nueva",
        datos_extra={"placa": placa, "monto": monto},
    )


@shared_task(name="notificaciones.notificar_qr_generado")
def notificar_qr_generado(usuario_id: int, placa: str, expiracion: str):
    _enviar_notificacion_ws(
        usuario_id=usuario_id,
        titulo="QR de acceso generado",
        mensaje=f"Se generó un QR para {placa} válido hasta {expiracion}.",
        tipo_codigo="qr_generado",
        datos_extra={"placa": placa, "expiracion": expiracion},
    )


@shared_task(name="vehiculos.alertar_documentos_por_vencer")
def alertar_documentos_por_vencer():
    """
    Tarea programada diaria (Celery Beat — 7:00 AM).
    Detecta documentos críticos (SOAT, Revisión Técnica) que vencen
    en exactamente 30, 15 o 5 días y notifica al propietario.

    Por qué umbrales exactos (no rangos):
      Si usáramos 'días <= 30', notificaríamos TODOS LOS DÍAS durante un mes.
      Con fechas exactas, el propietario recibe 3 avisos puntuales: con tiempo,
      con urgencia, y de emergencia — sin spam.
    """
    from datetime import timedelta
    from django.utils import timezone
    from apps.vehiculos.models import DocumentoVehiculo

    hoy = timezone.now().date()
    UMBRALES_DIAS = [30, 15, 5]
    DOCS_CRITICOS = {"soat", "tecnica"}
    NOMBRES = {
        "soat":        "SOAT",
        "tecnica":     "Revisión Técnica",
        "circulacion": "Permiso de Circulación",
        "otro":        "Documento",
    }

    notificados = 0
    for dias in UMBRALES_DIAS:
        fecha_objetivo = hoy + timedelta(days=dias)
        docs = (
            DocumentoVehiculo.objects
            .filter(fecha_vencimiento=fecha_objetivo)
            .select_related("vehiculo__propietario")
        )
        for doc in docs:
            propietario = doc.vehiculo.propietario
            es_critico = doc.tipo_doc in DOCS_CRITICOS
            titulo = (
                f"🚨 {NOMBRES[doc.tipo_doc]} vence en {dias} días — {doc.vehiculo.placa}"
                if es_critico else
                f"📄 {NOMBRES[doc.tipo_doc]} vence en {dias} días — {doc.vehiculo.placa}"
            )
            _enviar_notificacion_ws(
                usuario_id=propietario.pk,
                titulo=titulo,
                mensaje=(
                    f"El {NOMBRES[doc.tipo_doc]} de tu vehículo {doc.vehiculo.placa} "
                    f"vence el {doc.fecha_vencimiento.strftime('%d/%m/%Y')} "
                    f"(N° {doc.numero}). Renuévalo para seguir accediendo al campus."
                ),
                tipo_codigo="documento_por_vencer",
                datos_extra={
                    "placa": doc.vehiculo.placa,
                    "tipo_doc": doc.tipo_doc,
                    "fecha_vencimiento": doc.fecha_vencimiento.isoformat(),
                    "dias_restantes": dias,
                },
            )
            notificados += 1

    return f"alertar_documentos_por_vencer: {notificados} notificaciones enviadas"


@shared_task(name="acceso.detectar_anomalias_acceso")
def detectar_anomalias_acceso():
    """
    Tarea diaria a las 6:00 AM — detecta 5 tipos de anomalías en accesos del día anterior.
    Por cada anomalía detectada crea un AlertaAcceso y notifica a todos los admins vía WS.
    """
    from datetime import timedelta, date
    from django.utils import timezone
    from django.db.models import Count, Avg, StdDev, Q
    from django.db.models.functions import ExtractHour
    from apps.acceso.models import RegistroAcceso, AlertaAcceso
    from apps.usuarios.models import Usuario, UsuarioRol

    ayer = (timezone.now() - timedelta(days=1)).date()
    creadas = 0

    def _crear_alerta(vehiculo, tipo, severidad, descripcion, extra=None):
        nonlocal creadas
        existe = AlertaAcceso.objects.filter(
            vehiculo=vehiculo, tipo_anomalia=tipo, fecha_analisis=ayer
        ).exists()
        if not existe:
            AlertaAcceso.objects.create(
                vehiculo=vehiculo,
                tipo_anomalia=tipo,
                severidad=severidad,
                descripcion=descripcion,
                fecha_analisis=ayer,
                datos_extra=extra or {},
            )
            creadas += 1

    def _notificar_admins(titulo, mensaje):
        admins = (
            UsuarioRol.objects
            .filter(rol__nombre="Administrador")
            .select_related("usuario")
            .distinct()
        )
        for ur in admins:
            _enviar_notificacion_ws(
                usuario_id=ur.usuario_id,
                titulo=titulo,
                mensaje=mensaje,
                tipo_codigo="alerta_anomalia",
            )

    # ── 1. Frecuencia excesiva (> 6 registros en un día) ─────────────────
    UMBRAL_FRECUENCIA = 6
    excesivos = (
        RegistroAcceso.objects
        .filter(timestamp__date=ayer, vehiculo__isnull=False)
        .values("vehiculo_id", "vehiculo__placa")
        .annotate(total=Count("id"))
        .filter(total__gt=UMBRAL_FRECUENCIA)
    )
    for r in excesivos:
        from apps.vehiculos.models import Vehiculo
        v = Vehiculo.objects.filter(pk=r["vehiculo_id"]).first()
        if v:
            desc = (
                f"Vehículo {r['vehiculo__placa']} registró {r['total']} accesos en un día "
                f"(umbral: {UMBRAL_FRECUENCIA}). Posible compartición de QR."
            )
            _crear_alerta(v, "frecuencia_excesiva", "advertencia", desc,
                          {"total_accesos": r["total"], "fecha": str(ayer)})

    # ── 2. Horario inusual (>3 desviaciones estándar del horario habitual) ─
    hace_30 = ayer - timedelta(days=30)
    estadisticas_horario = (
        RegistroAcceso.objects
        .filter(
            timestamp__date__gte=hace_30, timestamp__date__lt=ayer,
            tipo="entrada", vehiculo__isnull=False,
        )
        .annotate(hora=ExtractHour("timestamp"))
        .values("vehiculo_id")
        .annotate(hora_media=Avg("hora"), hora_std=StdDev("hora"))
        .filter(hora_std__gt=0)
    )
    stats_map = {s["vehiculo_id"]: s for s in estadisticas_horario}

    accesos_ayer = (
        RegistroAcceso.objects
        .filter(timestamp__date=ayer, tipo="entrada", vehiculo__isnull=False)
        .annotate(hora=ExtractHour("timestamp"))
        .values("vehiculo_id", "vehiculo__placa", "hora")
    )
    for acc in accesos_ayer:
        s = stats_map.get(acc["vehiculo_id"])
        if s and s["hora_std"] and abs(acc["hora"] - s["hora_media"]) > 3 * s["hora_std"]:
            from apps.vehiculos.models import Vehiculo
            v = Vehiculo.objects.filter(pk=acc["vehiculo_id"]).first()
            if v:
                desc = (
                    f"Vehículo {acc['vehiculo__placa']} accedió a las {acc['hora']}:00h, "
                    f"fuera de su horario habitual ({s['hora_media']:.0f}:00 ±{s['hora_std']:.1f}h)."
                )
                _crear_alerta(v, "horario_inusual", "advertencia", desc,
                              {"hora_acceso": acc["hora"], "hora_media": round(s["hora_media"], 1)})

    # ── 3. Punto de acceso inusual ────────────────────────────────────────
    habitual_punto = (
        RegistroAcceso.objects
        .filter(timestamp__date__gte=hace_30, timestamp__date__lt=ayer, vehiculo__isnull=False)
        .values("vehiculo_id", "punto_acceso_id")
        .annotate(usos=Count("id"))
        .order_by("vehiculo_id", "-usos")
    )
    punto_habitual_map: dict = {}
    for h in habitual_punto:
        vid = h["vehiculo_id"]
        if vid not in punto_habitual_map:
            punto_habitual_map[vid] = h["punto_acceso_id"]

    accesos_ayer_punto = (
        RegistroAcceso.objects
        .filter(timestamp__date=ayer, vehiculo__isnull=False)
        .select_related("vehiculo", "punto_acceso")
        .values("vehiculo_id", "vehiculo__placa", "punto_acceso_id", "punto_acceso__nombre")
        .distinct()
    )
    for acc in accesos_ayer_punto:
        vid = acc["vehiculo_id"]
        if vid in punto_habitual_map and punto_habitual_map[vid] != acc["punto_acceso_id"]:
            from apps.vehiculos.models import Vehiculo
            v = Vehiculo.objects.filter(pk=vid).first()
            if v:
                desc = (
                    f"Vehículo {acc['vehiculo__placa']} usó '{acc['punto_acceso__nombre']}', "
                    f"diferente a su punto de acceso habitual."
                )
                _crear_alerta(v, "punto_inusual", "info", desc,
                              {"punto_usado": acc["punto_acceso__nombre"]})

    # ── 4. Vehículo sancionado con acceso reciente ────────────────────────
    from apps.vehiculos.models import Vehiculo as Veh
    sancionados_con_acceso = (
        RegistroAcceso.objects
        .filter(timestamp__date=ayer, vehiculo__estado="sancionado", vehiculo__isnull=False)
        .select_related("vehiculo")
        .values("vehiculo_id", "vehiculo__placa")
        .distinct()
    )
    for r in sancionados_con_acceso:
        v = Veh.objects.filter(pk=r["vehiculo_id"]).first()
        if v:
            desc = (
                f"Vehículo sancionado {r['vehiculo__placa']} registró acceso. "
                f"Revisar si el guardia lo permitió manualmente."
            )
            _crear_alerta(v, "vehiculo_sancionado", "critica", desc, {"fecha": str(ayer)})

    # ── 5. Placas similares (distancia de edición = 1) ───────────────────
    from difflib import SequenceMatcher
    placas_ayer_list = list(
        RegistroAcceso.objects
        .filter(timestamp__date=ayer, vehiculo__isnull=False)
        .values_list("vehiculo__placa", "vehiculo_id")
        .distinct()
    )
    placas_norm = [(p.replace("-", "").upper(), pid) for p, pid in placas_ayer_list]
    vistas: set = set()
    for i, (p1, vid1) in enumerate(placas_norm):
        for p2, vid2 in placas_norm[i + 1:]:
            if vid1 == vid2:
                continue
            par = frozenset([vid1, vid2])
            if par in vistas:
                continue
            ratio = SequenceMatcher(None, p1, p2).ratio()
            if ratio >= 0.85 and p1 != p2:
                vistas.add(par)
                v1 = Veh.objects.filter(pk=vid1).first()
                if v1:
                    placa1 = placas_ayer_list[i][0]
                    placa2 = next((p for p, pid in placas_ayer_list if pid == vid2), p2)
                    desc = (
                        f"Placas similares accedieron el mismo día: {placa1} y {placa2} "
                        f"(similitud {ratio:.0%}). Posible clonación."
                    )
                    _crear_alerta(v1, "placas_similares", "critica", desc,
                                  {"placa_similar": placa2, "similitud": round(ratio, 2)})

    # ── Notificar a admins si hubo anomalías ──────────────────────────────
    if creadas > 0:
        _notificar_admins(
            titulo=f"⚠️ {creadas} anomalía{'s' if creadas > 1 else ''} de acceso detectada{'s' if creadas > 1 else ''}",
            mensaje=f"El análisis de accesos del {ayer.strftime('%d/%m/%Y')} detectó {creadas} patrón(es) inusuales. Revisa el Dashboard.",
        )

    return f"detectar_anomalias_acceso: {creadas} alertas creadas para {ayer}"
