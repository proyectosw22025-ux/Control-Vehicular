"""
Vista REST para subir archivos de documentos vehiculares a Cloudinary.

Por qué REST y no GraphQL:
  Apollo Client requiere 'apollo-upload-client' para multipart/form-data.
  Un endpoint REST es más simple, seguro y compatible con cualquier cliente HTTP.
  El frontend sube el archivo aquí y usa GraphQL solo para los datos.
"""
from django.http import JsonResponse
from django.views import View
from rest_framework_simplejwt.authentication import JWTAuthentication


def _autenticar(request):
    """Autentica via Bearer token del header o ?token= en query string."""
    if request.user.is_authenticated:
        return request.user
    token = request.GET.get("token") or request.META.get("HTTP_AUTHORIZATION", "").replace("Bearer ", "")
    if not token:
        return None
    try:
        auth = JWTAuthentication()
        validated = auth.get_validated_token(token.encode() if isinstance(token, str) else token)
        return auth.get_user(validated)
    except Exception:
        return None


class SubirArchivoDocumentoView(View):
    """
    POST /api/documentos/<documento_id>/subir/
    Recibe: multipart/form-data con campo 'archivo' (imagen o PDF)
    Retorna: { "url": "https://res.cloudinary.com/...", "formato": "pdf" }
    """

    MAX_BYTES = 5 * 1024 * 1024   # 5 MB
    FORMATOS_OK = {"jpg", "jpeg", "png", "webp", "pdf"}

    def post(self, request, documento_id: int):
        user = _autenticar(request)
        if not user:
            return JsonResponse({"error": "Autenticación requerida"}, status=401)

        archivo = request.FILES.get("archivo")
        if not archivo:
            return JsonResponse({"error": "Se requiere el campo 'archivo'"}, status=400)

        if archivo.size > self.MAX_BYTES:
            return JsonResponse({"error": "El archivo supera el límite de 5 MB"}, status=413)

        ext = archivo.name.rsplit(".", 1)[-1].lower()
        if ext not in self.FORMATOS_OK:
            return JsonResponse(
                {"error": f"Formato no permitido. Usa: {', '.join(self.FORMATOS_OK)}"},
                status=415,
            )

        from apps.vehiculos.models import DocumentoVehiculo
        from apps.usuarios.utils import tiene_rol

        # Solo el propietario del vehículo o personal autorizado puede subir
        doc = (
            DocumentoVehiculo.objects
            .select_related("vehiculo__propietario")
            .filter(pk=documento_id)
            .first()
        )
        if not doc:
            return JsonResponse({"error": "Documento no encontrado"}, status=404)

        es_propietario = doc.vehiculo.propietario_id == user.pk
        es_personal = tiene_rol(user, "Administrador") or tiene_rol(user, "Guardia")
        if not es_propietario and not es_personal:
            return JsonResponse({"error": "Sin permisos para este documento"}, status=403)

        # Guardar el archivo (Cloudinary si está configurado, local si no)
        doc.archivo.save(archivo.name, archivo, save=True)

        url = doc.archivo.url if doc.archivo else ""
        return JsonResponse({
            "url": url,
            "formato": ext,
            "nombre": archivo.name,
        })
