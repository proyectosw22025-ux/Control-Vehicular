"""
WebSocket Consumer — Rastreo en tiempo real de vehículos en el campus UAGRM.

Grupos de canales:
  rastreo_campus      → Admin y Guardia: ven todos los vehículos activos
  rastreo_usuario_<id> → Propietario: ve solo su propio vehículo

Flujo:
  1. Dispositivo del propietario llama POST /api/rastreo/ubicacion/ cada 3s
  2. La vista actualiza UbicacionVehiculo en BD
  3. La vista hace group_send a rastreo_campus y rastreo_usuario_<id>
  4. Este consumer recibe el evento y lo reenvía al cliente WebSocket
"""
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class RastreoConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()

        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.send(json.dumps({"tipo": "error", "mensaje": "No autenticado"}))
            await self.close(code=4001)
            return

        es_personal = await self._es_personal(user)
        self.groups_joined = []

        if es_personal:
            # Admin/Guardia: se une al grupo global del campus
            await self.channel_layer.group_add("rastreo_campus", self.channel_name)
            self.groups_joined.append("rastreo_campus")
        else:
            # Propietario: se une solo a su grupo personal
            grupo = f"rastreo_usuario_{user.pk}"
            await self.channel_layer.group_add(grupo, self.channel_name)
            self.groups_joined.append(grupo)

        # Enviar ubicaciones actuales al conectar
        ubicaciones = await self._ubicaciones_activas(es_personal, user)
        await self.send(json.dumps({
            "tipo": "conectado",
            "rol":  "personal" if es_personal else "propietario",
            "ubicaciones_actuales": ubicaciones,
        }))

    async def disconnect(self, code: int):
        for grupo in getattr(self, "groups_joined", []):
            await self.channel_layer.group_discard(grupo, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        """El cliente puede pedir el estado actual."""
        if not text_data:
            return
        try:
            data = json.loads(text_data)
            if data.get("accion") == "solicitar_estado":
                user = self.scope.get("user")
                es_personal = await self._es_personal(user)
                ubicaciones = await self._ubicaciones_activas(es_personal, user)
                await self.send(json.dumps({
                    "tipo": "estado_actual",
                    "ubicaciones": ubicaciones,
                }))
        except Exception:
            pass

    # ── Handler de evento broadcast ───────────────────────────────────────
    async def ubicacion_actualizada(self, event):
        """Recibe el broadcast de la vista REST y lo manda al cliente WS."""
        await self.send(json.dumps({
            "tipo":              "ubicacion",
            "vehiculo_id":       event["vehiculo_id"],
            "placa":             event["placa"],
            "lat":               event["lat"],
            "lng":               event["lng"],
            "velocidad":         event["velocidad"],
            "timestamp":         event["timestamp"],
            "propietario":       event["propietario"],
            "tipo_vehiculo":     event["tipo_vehiculo"],
            "en_campus":         event.get("en_campus", True),
        }))

    async def vehiculo_salio(self, event):
        """Notifica cuando un vehículo sale del campus."""
        await self.send(json.dumps({
            "tipo":        "vehiculo_salio",
            "vehiculo_id": event["vehiculo_id"],
            "placa":       event["placa"],
        }))

    async def evento_acceso(self, event):
        """
        Notifica entrada o salida registrada por QR en una portería.
        Para entradas: incluye coordenadas de la portería para mostrar
        el vehículo en el mapa aunque el propietario no tenga GPS activo.
        """
        await self.send(json.dumps({
            "tipo":           "evento_acceso",
            "vehiculo_id":    event["vehiculo_id"],
            "placa":          event["placa"],
            "evento":         event["evento"],          # "entrada" | "salida"
            "punto_acceso":   event.get("punto_acceso", ""),
            "lat":            event.get("lat"),
            "lng":            event.get("lng"),
            "timestamp":      event.get("timestamp", ""),
            "propietario":    event.get("propietario", ""),
            "tipo_vehiculo":  event.get("tipo_vehiculo", "Automóvil"),
            "fuente":         event.get("fuente", "qr"),
        }))

    # ── Helpers DB ────────────────────────────────────────────────────────
    @database_sync_to_async
    def _es_personal(self, user):
        from apps.usuarios.utils import tiene_rol
        return tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")

    @database_sync_to_async
    def _ubicaciones_activas(self, es_personal: bool, user):
        from apps.acceso.models import UbicacionVehiculo
        from django.utils import timezone
        from datetime import timedelta

        # Solo ubicaciones actualizadas en los últimos 5 minutos
        umbral = timezone.now() - timedelta(minutes=5)
        qs = UbicacionVehiculo.objects.filter(activo=True, timestamp__gte=umbral).select_related(
            "vehiculo", "vehiculo__propietario", "vehiculo__tipo"
        )
        if not es_personal:
            qs = qs.filter(vehiculo__propietario=user)

        return [
            {
                "vehiculo_id":   u.vehiculo.pk,
                "placa":         u.vehiculo.placa,
                "lat":           float(u.latitud),
                "lng":           float(u.longitud),
                "velocidad":     u.velocidad,
                "timestamp":     u.timestamp.isoformat(),
                "propietario":   f"{u.vehiculo.propietario.nombre} {u.vehiculo.propietario.apellido}",
                "tipo_vehiculo": u.vehiculo.tipo.nombre if u.vehiculo.tipo else "Automóvil",
                "en_campus":     u.activo,
            }
            for u in qs
        ]
