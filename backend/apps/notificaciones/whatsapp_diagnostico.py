"""
Endpoint de diagnóstico WhatsApp — solo para debugging en Railway.
GET /api/whatsapp/test/?tel=72604635

Prueba el envío completo y retorna el estado detallado.
Requiere autenticación de admin o token Bearer.
"""
import json
import logging
from django.http import JsonResponse
from django.views import View

logger = logging.getLogger(__name__)


class WhatsAppTestView(View):
    def get(self, request):
        from django.conf import settings
        from .whatsapp import _normalizar_telefono_bolivia, _enviar_green_api

        tel = request.GET.get("tel", "").strip()
        if not tel:
            return JsonResponse({"error": "Parámetro ?tel=72604635 requerido"}, status=400)

        # Diagnóstico de configuración
        instance_id = getattr(settings, "GREEN_API_INSTANCE_ID", "")
        token       = getattr(settings, "GREEN_API_TOKEN", "")
        config_ok   = bool(instance_id and token)

        # Normalización del número
        chat_id = _normalizar_telefono_bolivia(tel)

        resultado = {
            "configuracion": {
                "GREEN_API_INSTANCE_ID": instance_id[:6] + "..." if instance_id else "NO CONFIGURADO",
                "GREEN_API_TOKEN":       token[:8] + "..." if token else "NO CONFIGURADO",
                "config_completa":       config_ok,
            },
            "normalizacion": {
                "telefono_ingresado": tel,
                "chat_id":           chat_id,
                "valido":            chat_id is not None,
            },
            "envio": None,
        }

        if not config_ok:
            resultado["error"] = "Faltan GREEN_API_INSTANCE_ID o GREEN_API_TOKEN en Railway"
            return JsonResponse(resultado, status=503)

        if not chat_id:
            resultado["error"] = f"Número '{tel}' no es un número boliviano válido"
            return JsonResponse(resultado, status=400)

        # Intento de envío real
        mensaje = (
            f"🔧 *Diagnóstico WhatsApp — UAGRM*\n\n"
            f"✅ El sistema puede enviarte mensajes en:\n"
            f"• Entrada/salida de tu vehículo\n"
            f"• Multas registradas\n"
            f"• Aprobación de vehículos\n"
            f"• Visitas en el campus\n\n"
            f"Este es un mensaje de prueba del sistema de Control Vehicular UAGRM."
        )

        try:
            ok = _enviar_green_api(chat_id, mensaje)
            resultado["envio"] = {
                "intentado":    True,
                "chat_id":      chat_id,
                "exitoso":      ok,
                "mensaje":      "Mensaje enviado — revisa tu WhatsApp" if ok
                                else "Green API no confirmó el envío — revisa los logs de Railway",
            }
            if ok:
                logger.info("[WA TEST] Mensaje de prueba enviado a %s", chat_id)
            else:
                logger.warning("[WA TEST] Fallo enviando a %s", chat_id)
        except Exception as exc:
            resultado["envio"] = {
                "intentado": True,
                "chat_id":   chat_id,
                "exitoso":   False,
                "error":     str(exc),
            }
            logger.error("[WA TEST] Excepción enviando a %s: %s", chat_id, exc)

        return JsonResponse(resultado)
