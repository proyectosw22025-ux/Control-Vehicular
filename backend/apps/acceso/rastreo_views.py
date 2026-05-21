"""
Vista REST para actualización de posición GPS en tiempo real.

POST /api/rastreo/ubicacion/
  Body: { "vehiculo_id": int, "lat": float, "lng": float, "velocidad": float }
  Auth: Bearer token (mismo que el resto de la API)

Flujo:
  1. Dispositivo del propietario envía su posición GPS cada 3 segundos
  2. Se actualiza UbicacionVehiculo (upsert) en la BD
  3. Se hace broadcast a rastreo_campus y rastreo_usuario_<id> via Django Channels
  4. Al registrar salida del campus, se desactiva la ubicación

DELETE /api/rastreo/ubicacion/<vehiculo_id>/
  Marca el vehículo como fuera del campus (desactiva rastreo)
"""
import json

from django.http import JsonResponse
from django.views import View


def _autenticar(request):
    if request.user.is_authenticated:
        return request.user
    from rest_framework_simplejwt.authentication import JWTAuthentication
    token = (
        request.GET.get("token")
        or request.META.get("HTTP_AUTHORIZATION", "").replace("Bearer ", "")
    )
    if not token:
        return None
    try:
        auth      = JWTAuthentication()
        validated = auth.get_validated_token(token.encode() if isinstance(token, str) else token)
        return auth.get_user(validated)
    except Exception:
        return None


def _broadcast_ubicacion(evento: dict):
    """Envía el evento a los grupos del canal de rastreo."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)("rastreo_campus", evento)
            async_to_sync(layer.group_send)(
                f"rastreo_usuario_{evento.get('propietario_id', 0)}", evento
            )
    except Exception:
        pass   # WebSocket no disponible — la BD ya fue actualizada


class ActualizarUbicacionView(View):
    """POST — recibe posición GPS del dispositivo móvil del propietario."""

    def post(self, request):
        user = _autenticar(request)
        if not user:
            return JsonResponse({"error": "Autenticación requerida"}, status=401)

        try:
            body       = json.loads(request.body)
            vehiculo_id = int(body["vehiculo_id"])
            lat         = float(body["lat"])
            lng         = float(body["lng"])
            velocidad   = float(body.get("velocidad", 0))
        except (KeyError, ValueError, json.JSONDecodeError):
            return JsonResponse({"error": "Campos requeridos: vehiculo_id, lat, lng"}, status=400)

        # Verificar propiedad del vehículo
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol

        vehiculo = Vehiculo.objects.select_related("propietario", "tipo").filter(pk=vehiculo_id).first()
        if not vehiculo:
            return JsonResponse({"error": "Vehículo no encontrado"}, status=404)
        if not tiene_rol(user, "Administrador") and vehiculo.propietario_id != user.pk:
            return JsonResponse({"error": "Sin permisos para este vehículo"}, status=403)

        # Upsert en UbicacionVehiculo
        from apps.acceso.models import UbicacionVehiculo
        ub, _ = UbicacionVehiculo.objects.update_or_create(
            vehiculo=vehiculo,
            defaults={"latitud": lat, "longitud": lng, "velocidad": velocidad, "activo": True},
        )

        # Broadcast a todos los observadores via WebSocket
        _broadcast_ubicacion({
            "type":          "ubicacion_actualizada",
            "vehiculo_id":   vehiculo.pk,
            "placa":         vehiculo.placa,
            "lat":           lat,
            "lng":           lng,
            "velocidad":     velocidad,
            "timestamp":     ub.timestamp.isoformat(),
            "propietario":   f"{vehiculo.propietario.nombre} {vehiculo.propietario.apellido}",
            "propietario_id": vehiculo.propietario_id,
            "tipo_vehiculo": vehiculo.tipo.nombre if vehiculo.tipo else "Automóvil",
            "en_campus":     True,
        })

        return JsonResponse({"ok": True, "timestamp": ub.timestamp.isoformat()})

    def delete(self, request, vehiculo_id: int):
        """Desactiva el rastreo cuando el vehículo sale del campus."""
        user = _autenticar(request)
        if not user:
            return JsonResponse({"error": "Autenticación requerida"}, status=401)

        from apps.acceso.models import UbicacionVehiculo
        from apps.vehiculos.models import Vehiculo
        from apps.usuarios.utils import tiene_rol

        vehiculo = Vehiculo.objects.select_related("propietario", "tipo").filter(pk=vehiculo_id).first()
        if not vehiculo:
            return JsonResponse({"error": "Vehículo no encontrado"}, status=404)
        if not tiene_rol(user, "Administrador") and vehiculo.propietario_id != user.pk:
            return JsonResponse({"error": "Sin permisos"}, status=403)

        UbicacionVehiculo.objects.filter(vehiculo=vehiculo).update(activo=False)

        _broadcast_ubicacion({
            "type":        "vehiculo_salio",
            "vehiculo_id": vehiculo.pk,
            "placa":       vehiculo.placa,
            "propietario_id": vehiculo.propietario_id,
        })

        return JsonResponse({"ok": True})
