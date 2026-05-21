from django.contrib import admin
from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from django.views.decorators.csrf import csrf_exempt
from strawberry.django.views import GraphQLView
from schema import schema
from apps.reportes.views import (
    VehiculosPDFView, SesionesPDFView, VisitasPDFView, MultasPDFView,
)
from apps.vehiculos.views import SubirArchivoDocumentoView, SubirFotoVehiculoView
from apps.vehiculos.ocr_view import OcrPlacaView, OcrDiagnosticoView
from apps.usuarios.views import SubirFotoPerfilView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("graphql/", csrf_exempt(GraphQLView.as_view(schema=schema))),
    path("api/pdf/vehiculos/", csrf_exempt(VehiculosPDFView.as_view()), name="pdf_vehiculos"),
    path("api/pdf/sesiones/", csrf_exempt(SesionesPDFView.as_view()), name="pdf_sesiones"),
    path("api/pdf/visitas/",  csrf_exempt(VisitasPDFView.as_view()),  name="pdf_visitas"),
    path("api/pdf/multas/",   csrf_exempt(MultasPDFView.as_view()),   name="pdf_multas"),
    # Upload de documentos vehiculares → Cloudinary si está configurado, local si no
    path("api/documentos/<int:documento_id>/subir/",
         csrf_exempt(SubirArchivoDocumentoView.as_view()), name="subir_documento"),
    path("api/vehiculos/<int:vehiculo_id>/foto/",
         csrf_exempt(SubirFotoVehiculoView.as_view()), name="subir_foto_vehiculo"),
    path("api/ocr/placa/",
         csrf_exempt(OcrPlacaView.as_view()), name="ocr_placa"),
    path("api/ocr/diagnostico/",
         csrf_exempt(OcrDiagnosticoView.as_view()), name="ocr_diagnostico"),
    path("api/perfil/foto/",
         csrf_exempt(SubirFotoPerfilView.as_view()), name="subir_foto_perfil"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
