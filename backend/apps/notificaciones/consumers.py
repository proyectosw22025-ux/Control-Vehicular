import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class NotificacionConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if not self.user.is_authenticated:
            await self.close()
            return
        self.group_name = f"notificaciones_usuario_{self.user.pk}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        no_leidas = await self.conteo_no_leidas()
        await self.send(json.dumps({"tipo": "conectado", "no_leidas": no_leidas}))

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        if data.get("accion") == "marcar_leidas":
            await self.marcar_todas_leidas()
            await self.send(json.dumps({"tipo": "leidas_marcadas"}))

    async def notificacion_nueva(self, event):
        await self.send(json.dumps({
            "tipo": "nueva_notificacion",
            "id": event["id"],
            "titulo": event["titulo"],
            "mensaje": event["mensaje"],
            "fecha": event["fecha"],
        }))

    @database_sync_to_async
    def conteo_no_leidas(self):
        from .models import Notificacion
        return Notificacion.objects.filter(usuario=self.user, leido=False).count()

    @database_sync_to_async
    def marcar_todas_leidas(self):
        from .models import Notificacion
        Notificacion.objects.filter(usuario=self.user, leido=False).update(leido=True)
