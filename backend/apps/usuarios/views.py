"""
Vista REST para subir foto de perfil a Cloudinary directamente.

Usamos cloudinary.uploader.upload() en lugar de ImageField.save() para evitar
el error 'Could not find config for default in settings.STORAGES' que ocurre
cuando django-cloudinary-storage está instalado pero STORAGES no está configurado.
La URL resultante se guarda en Usuario.foto_url (URLField simple, sin storage backend).
"""
from django.http import JsonResponse
from django.views import View
from rest_framework_simplejwt.authentication import JWTAuthentication


def _autenticar(request):
    """Autentica via ?token= query param o Authorization header."""
    if request.user.is_authenticated:
        return request.user
    # Probar ?token= primero (más confiable en Railway/ASGI)
    token = request.GET.get("token", "").strip()
    if not token:
        auth = request.META.get("HTTP_AUTHORIZATION", "")
        token = auth[7:] if auth.startswith("Bearer ") else ""
    if not token:
        return None
    try:
        jwt_auth = JWTAuthentication()
        validated = jwt_auth.get_validated_token(token.encode())
        return jwt_auth.get_user(validated)
    except Exception:
        return None


class SubirFotoPerfilView(View):
    MAX_BYTES = 3 * 1024 * 1024   # 3 MB
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
            return JsonResponse({"error": f"Formato no permitido. Usa: {', '.join(self.FORMATOS_OK)}"}, status=415)

        # ── Subir directamente a Cloudinary sin pasar por Django storage ──
        from django.conf import settings as dj_settings
        import cloudinary
        import cloudinary.uploader

        cloud_name = dj_settings.CLOUDINARY_STORAGE.get("CLOUD_NAME", "")
        api_key    = dj_settings.CLOUDINARY_STORAGE.get("API_KEY", "")
        api_secret = dj_settings.CLOUDINARY_STORAGE.get("API_SECRET", "")

        url = ""
        if cloud_name and api_key and api_secret:
            cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)
            result = cloudinary.uploader.upload(
                archivo,
                folder="usuarios/fotos/",
                public_id=f"perfil_{user.pk}",
                overwrite=True,
                resource_type="image",
            )
            url = result.get("secure_url", "")
        else:
            # Sin Cloudinary → guardar localmente como fallback
            import os
            from django.conf import settings as s
            fotos_dir = os.path.join(s.MEDIA_ROOT, "usuarios", "fotos")
            os.makedirs(fotos_dir, exist_ok=True)
            nombre = f"perfil_{user.pk}.{ext}"
            ruta = os.path.join(fotos_dir, nombre)
            with open(ruta, "wb") as f:
                for chunk in archivo.chunks():
                    f.write(chunk)
            url = f"{s.MEDIA_URL}usuarios/fotos/{nombre}"

        # Guardar URL en el campo URLField dedicado (sin tocar ImageField)
        from apps.usuarios.models import Usuario
        Usuario.objects.filter(pk=user.pk).update(foto_url=url)

        return JsonResponse({"url": url, "pk": user.pk})
