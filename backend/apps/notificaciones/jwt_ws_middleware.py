from urllib.parse import parse_qs
from channels.middleware import BaseMiddleware  # type: ignore[import-untyped]
from channels.db import database_sync_to_async  # type: ignore[import-untyped]
from django.contrib.auth.models import AnonymousUser


class JWTWebSocketAuthMiddleware(BaseMiddleware):
    """
    Lee ?token=<access_token> de la query string del WebSocket
    y autentica al usuario vía SimpleJWT.
    """

    async def __call__(self, scope, receive, send):
        scope["user"] = await self._get_user(scope)  # type: ignore[typeddict-item]
        return await super().__call__(scope, receive, send)

    @database_sync_to_async
    def _get_user(self, scope):
        query_string = scope.get("query_string", b"").decode("utf-8")
        params = parse_qs(query_string)
        token_list = params.get("token", [])

        if not token_list:
            print("[WS Auth] ❌ No se encontró token en la query string")
            return AnonymousUser()

        token_str = token_list[0]
        print(f"[WS Auth] Token recibido (primeros 20 chars): {token_str[:20]}...")

        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from apps.usuarios.models import Usuario

            validated = AccessToken(token_str)
            user_id = validated["user_id"]
            user = Usuario.objects.get(pk=user_id)
            print(f"[WS Auth] ✅ Usuario autenticado: {user} (id={user_id})")
            return user

        except Exception as e:
            print(f"[WS Auth] ❌ Error al autenticar: {type(e).__name__}: {e}")
            return AnonymousUser()
