import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter  # type: ignore[import-untyped]
from django.urls import path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

django_asgi_app = get_asgi_application()

from apps.notificaciones.consumers import NotificacionConsumer
from apps.notificaciones.jwt_ws_middleware import JWTWebSocketAuthMiddleware

websocket_urlpatterns = [
    path("ws/notificaciones/", NotificacionConsumer.as_asgi()),
]

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": JWTWebSocketAuthMiddleware(
        URLRouter(websocket_urlpatterns)
    ),
})
