"""
Vista REST para subir foto de perfil de usuario a Cloudinary.
Almacena la URL en Usuario.foto (ImageField con Cloudinary storage cuando está configurado).
"""
from django.http import JsonResponse
from django.views import View
from rest_framework_simplejwt.authentication import JWTAuthentication


def _autenticar(request):
    token = request.GET.get("token") or request.META.get("HTTP_AUTHORIZATION", "").replace("Bearer ", "")
    if request.user.is_authenticated:
        return request.user
    if not token:
        return None
    try:
        auth = JWTAuthentication()
        validated = auth.get_validated_token(token.encode() if isinstance(token, str) else token)
        return auth.get_user(validated)
    except Exception:
        return None


class SubirFotoPerfilView(View):
    """
    POST /api/perfil/foto/
    Sube la foto de perfil del usuario autenticado a Cloudinary.
    Retorna: { "url": "https://res.cloudinary.com/..." }
    """
    MAX_BYTES = 3 * 1024 * 1024   # 3 MB para fotos de perfil
    FORMATOS_OK = {"jpg", "jpeg", "png", "webp"}

    def post(self, request):
        user = _autenticar(request)
        if not user:
            return JsonResponse({"error": "Autenticación requerida"}, status=401)

        archivo = request.FILES.get("foto")
        if not archivo:
            return JsonResponse({"error": "Se requiere el campo 'foto'"}, status=400)

        if archivo.size > self.MAX_BYTES:
            return JsonResponse({"error": "La foto supera el límite de 3 MB"}, status=413)

        ext = archivo.name.rsplit(".", 1)[-1].lower()
        if ext not in self.FORMATOS_OK:
            return JsonResponse(
                {"error": f"Formato no permitido. Usa: {', '.join(self.FORMATOS_OK)}"},
                status=415,
            )

        # Guardar vía Django (si Cloudinary está configurado → sube a la nube)
        from apps.usuarios.models import Usuario
        usuario = Usuario.objects.get(pk=user.pk)
        usuario.foto.save(f"perfil_{user.pk}.{ext}", archivo, save=True)

        url = usuario.foto.url if usuario.foto else ""
        return JsonResponse({"url": url, "pk": user.pk})
