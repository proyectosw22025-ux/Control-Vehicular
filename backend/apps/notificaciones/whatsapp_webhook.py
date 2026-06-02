"""
Webhook de Green API — recibe mensajes entrantes de WhatsApp y responde.

Green API envía POST a /api/whatsapp/webhook/ cuando el usuario escribe.
Siempre retorna HTTP 200 (Green API reintenta si no recibe 200).

Payload de ejemplo:
  {
    "typeWebhook": "incomingMessageReceived",
    "senderData": {"chatId": "59172345678@c.us", "senderName": "Joseph"},
    "messageData": {"typeMessage": "textMessage",
                    "textMessageData": {"textMessage": "1"}}
  }
"""
import json
import logging

from django.http  import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from .whatsapp     import enviar_whatsapp
from .whatsapp_bot import procesar_respuesta

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name="dispatch")
class WhatsAppWebhookView(View):

    def get(self, request):
        """Green API verifica el endpoint con GET antes de activar."""
        return JsonResponse({"status": "webhook activo", "sistema": "Control Vehicular UAGRM"})

    def post(self, request):
        """Procesa mensajes entrantes y envía respuestas automáticas."""
        try:
            body  = json.loads(request.body)
            tipo  = body.get("typeWebhook", "")

            # Solo procesar mensajes entrantes de texto
            if tipo != "incomingMessageReceived":
                return JsonResponse({"ok": True})

            msg_data     = body.get("messageData", {})
            tipo_mensaje = msg_data.get("typeMessage", "")

            if tipo_mensaje != "textMessage":
                # Imagen, audio, sticker, etc. — respuesta genérica
                sender  = body.get("senderData", {})
                chat_id = sender.get("chatId", "")
                if chat_id:
                    # Extraer número limpio del chatId (59172345678@c.us → 59172345678)
                    telefono = chat_id.replace("@c.us", "")
                    enviar_whatsapp(
                        telefono,
                        "Solo proceso mensajes de texto 😊\nEscribe *ayuda* para ver las opciones.",
                    )
                return JsonResponse({"ok": True})

            texto_usuario = msg_data.get("textMessageData", {}).get("textMessage", "").strip()
            sender        = body.get("senderData", {})
            chat_id       = sender.get("chatId", "")
            nombre        = sender.get("senderName", "")

            if not chat_id or not texto_usuario:
                return JsonResponse({"ok": True})

            # El chatId tiene formato "59172345678@c.us"
            # Ignorar mensajes del propio número del sistema (evitar loops)
            from django.conf import settings
            instance_id = getattr(settings, "GREEN_API_INSTANCE_ID", "")
            instancia_phone = body.get("instanceData", {}).get("wid", "")
            if chat_id == instancia_phone:
                return JsonResponse({"ok": True})

            telefono = chat_id.replace("@c.us", "")
            logger.info("[WhatsApp BOT] Mensaje de %s (%s): %s", nombre, telefono, texto_usuario)

            # Procesar y obtener respuesta
            respuesta = procesar_respuesta(telefono, texto_usuario)

            if respuesta:
                enviar_whatsapp(telefono, respuesta)
                logger.info("[WhatsApp BOT] Respuesta enviada a %s", telefono)

        except Exception as exc:
            logger.error("[WhatsApp WEBHOOK] Error: %s", exc)

        # Siempre 200 — Green API reintenta si recibe otro código
        return JsonResponse({"ok": True})
