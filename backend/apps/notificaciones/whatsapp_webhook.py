"""
Webhook de Fonnte — recibe mensajes entrantes de WhatsApp y responde con el bot.

Fonnte envía POST a /api/whatsapp/webhook/ cuando el usuario escribe.
Payload de Fonnte:
  {
    "device":    "62521671",
    "sender":    "59172604635",
    "message":   "hola",
    "name":      "Joseph",
    "url":       "",
    "caption":   "",
    "location":  "",
    "member":    "",
    "date":      "2026-06-05 18:09:00"
  }
"""
import json
import logging

from django.http  import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from .whatsapp     import enviar_whatsapp, _normalizar_telefono_bolivia
from .whatsapp_bot import procesar_respuesta

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name="dispatch")
class WhatsAppWebhookView(View):

    def get(self, request):
        return JsonResponse({"status": "webhook activo", "sistema": "Control Vehicular UAGRM"})

    def post(self, request):
        try:
            body = json.loads(request.body)

            sender_raw = body.get("sender", "").strip()
            mensaje    = body.get("message", "").strip()
            device     = body.get("device", "").strip()

            if not sender_raw or not mensaje:
                return JsonResponse({"ok": True})

            # Ignorar mensajes del propio dispositivo Fonnte (evitar loops)
            tel_device = _normalizar_telefono_bolivia(device) or device
            tel_sender = _normalizar_telefono_bolivia(sender_raw) or sender_raw
            if tel_device == tel_sender:
                return JsonResponse({"ok": True})

            # Solo mensajes de texto — ignorar si hay URL (imagen/archivo)
            if body.get("url"):
                enviar_whatsapp(
                    sender_raw,
                    "Solo proceso mensajes de texto 😊\nEscribe *ayuda* para ver las opciones.",
                )
                return JsonResponse({"ok": True})

            logger.info("[WhatsApp BOT] Mensaje de %s (%s): %s",
                        body.get("name", ""), sender_raw, mensaje)

            respuesta = procesar_respuesta(tel_sender, mensaje)

            if respuesta:
                enviar_whatsapp(sender_raw, respuesta)
                logger.info("[WhatsApp BOT] Respuesta enviada a %s", sender_raw)

        except Exception as exc:
            logger.error("[WhatsApp WEBHOOK] Error: %s", exc)

        return JsonResponse({"ok": True})
