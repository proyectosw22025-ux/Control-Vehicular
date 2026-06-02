"""
Bot interactivo de WhatsApp para el Sistema de Control Vehicular UAGRM.

Gestiona sesiones por número de teléfono usando Redis (Django cache).
Cada sesión guarda el contexto de la última interacción (5 minutos TTL).

Flujo de ejemplo:
  Sistema → "SCZ-1234 entró. Elige: 1-Parqueo 2-OK 3-Disponibilidad 4-App"
  Usuario → "1"
  Bot     → "🅿 Guía lista: [URL con vehiculoId]"
  Usuario → "ayuda" (en cualquier momento)
  Bot     → menú principal completo
"""
from django.core.cache import cache

FRONTEND_URL = "https://control-vehicular-six.vercel.app"
SESSION_TTL  = 300  # 5 minutos


# ── Gestión de sesiones con Redis ─────────────────────────────────────────────

def guardar_sesion(telefono: str, datos: dict) -> None:
    cache.set(f"wa_session_{telefono}", datos, SESSION_TTL)


def obtener_sesion(telefono: str) -> dict:
    return cache.get(f"wa_session_{telefono}") or {}


def limpiar_sesion(telefono: str) -> None:
    cache.delete(f"wa_session_{telefono}")


# ── Mensajes del sistema con menú integrado ───────────────────────────────────

def menu_entrada_campus(placa: str, punto: str, hora: str,
                         vehiculo_id: int | None = None) -> tuple[str, dict]:
    """
    Mensaje de bienvenida con menú de opciones.
    Retorna (texto, sesion_a_guardar).
    """
    texto = (
        f"🏫 *Control Vehicular UAGRM*\n\n"
        f"Tu vehículo *{placa}* ingresó al campus.\n"
        f"📍 {punto} · {hora}\n\n"
        f"¿Qué deseas hacer?\n"
        f"*1* — 🅿 Guía al parqueo\n"
        f"*2* — ✅ Ya sé dónde ir\n"
        f"*3* — 📊 Disponibilidad de zonas\n"
        f"*4* — 🌐 Abrir el sistema\n\n"
        f"_Responde con el número de la opción._"
    )
    sesion = {
        "estado":      "menu_entrada",
        "placa":       placa,
        "vehiculo_id": vehiculo_id,
        "punto":       punto,
    }
    return texto, sesion


def menu_multa(placa: str, tipo_multa: str, monto: str) -> tuple[str, dict]:
    texto = (
        f"⚠️ *Multa registrada — {placa}*\n\n"
        f"📋 {tipo_multa}\n"
        f"💰 Monto: Bs {monto}\n\n"
        f"¿Qué deseas hacer?\n"
        f"*1* — 💳 Ver mis multas en el sistema\n"
        f"*2* — ℹ Más información\n"
        f"*3* — ✅ Entendido\n\n"
        f"_Responde con el número de la opción._"
    )
    sesion = {
        "estado": "menu_multa",
        "placa":  placa,
        "monto":  monto,
    }
    return texto, sesion


def menu_principal() -> str:
    return (
        f"👋 *Asistente UAGRM · Control Vehicular*\n\n"
        f"¿En qué puedo ayudarte?\n\n"
        f"*1* — 🅿 Guía de parqueo\n"
        f"*2* — 📊 Disponibilidad de parqueo\n"
        f"*3* — ⚠ Ver mis multas\n"
        f"*4* — 🌐 Abrir el sistema\n"
        f"*5* — 📋 Mis últimos accesos\n"
        f"*0* — ❌ Cancelar\n\n"
        f"_Responde con el número._"
    )


# ── Procesador de respuestas del usuario ─────────────────────────────────────

def procesar_respuesta(telefono: str, texto_usuario: str) -> str | None:
    """
    Procesa lo que el usuario escribió y retorna el mensaje de respuesta.
    Retorna None si no hay respuesta que enviar.
    """
    texto = texto_usuario.strip().lower()
    sesion = obtener_sesion(telefono)
    estado = sesion.get("estado")

    # ── Keywords globales (funcionan en cualquier estado) ─────────────────────
    if texto in ("ayuda", "hola", "help", "menu", "menú", "inicio", "start"):
        limpiar_sesion(telefono)
        return menu_principal()

    if texto in ("0", "cancelar", "cancel", "salir", "exit"):
        limpiar_sesion(telefono)
        return "✅ Operación cancelada. Escribe *ayuda* cuando necesites algo."

    # ── Menú de entrada al campus ─────────────────────────────────────────────
    if estado == "menu_entrada":
        vehiculo_id = sesion.get("vehiculo_id")
        placa       = sesion.get("placa", "")
        limpiar_sesion(telefono)

        if texto in ("1", "guia", "guía", "parqueo", "si", "sí", "yes"):
            disp = _obtener_disponibilidad_texto()
            if vehiculo_id:
                url = f"{FRONTEND_URL}/parqueo-demo?vehiculoId={vehiculo_id}"
                return (
                    f"🅿 *Disponibilidad ahora*\n\n"
                    f"{disp}\n\n"
                    f"📱 Ver guía interactiva:\n{url}"
                )
            else:
                return (
                    f"🅿 *Disponibilidad de parqueo*\n\n"
                    f"{disp}\n\n"
                    f"📱 Ver mapa: {FRONTEND_URL}/disponibilidad"
                )

        if texto in ("2", "ok", "no", "gracias"):
            return "✅ Perfecto. ¡Buen día en el campus! Escribe *ayuda* si necesitas algo."

        if texto in ("3", "disponibilidad"):
            return (
                f"📊 *Disponibilidad actual*\n\n"
                f"{_obtener_disponibilidad_texto()}\n\n"
                f"Actualización en tiempo real:\n{FRONTEND_URL}/disponibilidad"
            )

        if texto in ("4", "app", "sistema", "web"):
            return (
                f"🌐 *Sistema Control Vehicular UAGRM*\n\n"
                f"{FRONTEND_URL}/login\n\n"
                f"Inicia sesión para ver tus accesos, multas y vehículos."
            )

        # Respuesta no reconocida en contexto de entrada
        return (
            f"No entendí esa opción. Responde *1*, *2*, *3* o *4*.\n\n"
            f"*1* — 🅿 Guía al parqueo\n"
            f"*2* — ✅ Ya sé dónde ir\n"
            f"*3* — 📊 Disponibilidad\n"
            f"*4* — 🌐 App del sistema"
        )

    # ── Menú de multa ─────────────────────────────────────────────────────────
    if estado == "menu_multa":
        limpiar_sesion(telefono)

        if texto in ("1", "ver", "multas"):
            return (
                f"💳 *Gestiona tu multa en el sistema:*\n\n"
                f"{FRONTEND_URL}/multas\n\n"
                f"_Inicia sesión para ver el detalle y pagar._"
            )

        if texto in ("2", "info", "información"):
            return (
                f"ℹ *Proceso de pago de multas:*\n\n"
                f"1. Ingresa al sistema: {FRONTEND_URL}/multas\n"
                f"2. Sube tu comprobante de pago\n"
                f"3. El admin confirma y tu vehículo queda activo\n\n"
                f"Plazo: regulariza antes de tu próximo ingreso al campus."
            )

        if texto in ("3", "ok", "entendido"):
            return "✅ Recibido. Recuerda regularizar tu multa para mantener el acceso."

        return f"Responde *1*, *2* o *3* para ver las opciones."

    # ── Sin contexto — menú principal ─────────────────────────────────────────
    if not estado:

        if texto in ("1", "guia", "guía", "parqueo"):
            return (
                f"🅿 *Disponibilidad de parqueo ahora:*\n\n"
                f"{_obtener_disponibilidad_texto()}\n\n"
                f"📱 Ver mapa completo:\n{FRONTEND_URL}/disponibilidad"
            )

        if texto in ("2", "disponibilidad"):
            return (
                f"📊 *Zonas de parqueo — Campus UAGRM:*\n\n"
                f"{_obtener_disponibilidad_texto()}\n\n"
                f"{FRONTEND_URL}/disponibilidad"
            )

        if texto in ("3", "multas"):
            return (
                f"⚠ *Ver mis multas:*\n\n"
                f"{FRONTEND_URL}/multas\n\n"
                f"_Inicia sesión con tu cuenta del sistema._"
            )

        if texto in ("4", "sistema", "app", "web"):
            return (
                f"🌐 *Sistema Control Vehicular UAGRM:*\n\n"
                f"{FRONTEND_URL}/login"
            )

        if texto in ("5", "accesos", "historial"):
            return (
                f"📋 *Ver mis accesos recientes:*\n\n"
                f"{FRONTEND_URL}/mis-accesos\n\n"
                f"_Inicia sesión para ver tu historial completo._"
            )

        # Cualquier mensaje no reconocido → menú principal
        return menu_principal()

    return None


# ── Helper: disponibilidad real desde BD ─────────────────────────────────────

def _obtener_disponibilidad_texto() -> str:
    """Consulta la BD y retorna un resumen de texto de las zonas."""
    try:
        from apps.parqueos.schema import _calcular_estado, _color_estado
        from apps.parqueos.models import ZonaParqueo, EspacioParqueo, SesionParqueo
        from django.db.models import Count, Q

        emojis = {"disponible": "🟢", "limitado": "🟡", "saturado": "🟠",
                  "lleno": "🔴", "sin_datos": "⚪"}
        zonas = ZonaParqueo.objects.filter(activo=True).annotate(
            _libres=Count("espacios", filter=Q(espacios__estado="disponible")),
            _mant=Count("espacios", filter=Q(espacios__estado="mantenimiento")),
            _res=Count("espacios", filter=Q(espacios__estado="reservado")),
        ).order_by("nombre")

        lineas = []
        for z in zonas:
            total_util = max(z.capacidad_total - z._mant - z._res, 0)
            estado = _calcular_estado(z._libres, total_util)
            emoji  = emojis.get(estado, "⚪")
            lineas.append(f"{emoji} {z.nombre}: *{z._libres}* libres")

        return "\n".join(lineas) if lineas else "Sin datos disponibles."
    except Exception:
        return "Ver disponibilidad en: https://control-vehicular-six.vercel.app/disponibilidad"
