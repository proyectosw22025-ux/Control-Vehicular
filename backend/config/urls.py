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
from apps.acceso.rastreo_views import ActualizarUbicacionView
from apps.notificaciones.whatsapp_webhook import WhatsAppWebhookView
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
    # Rastreo GPS en tiempo real — telemetría vehicular
    path("api/rastreo/ubicacion/",
         csrf_exempt(ActualizarUbicacionView.as_view()), name="rastreo_ubicacion"),
    path("api/rastreo/ubicacion/<int:vehiculo_id>/",
         csrf_exempt(ActualizarUbicacionView.as_view()), name="rastreo_salida"),
    path("api/perfil/foto/",
         csrf_exempt(SubirFotoPerfilView.as_view()), name="subir_foto_perfil"),
    # WhatsApp webhook — Green API envía mensajes entrantes aquí
    path("api/whatsapp/webhook/",
         WhatsAppWebhookView.as_view(), name="whatsapp_webhook"),
    # WhatsApp diagnóstico — probar envío (solo admin, GET con ?tel=72604635)
    path("api/whatsapp/test/",
         csrf_exempt(__import__('apps.notificaciones.whatsapp_diagnostico',
                                fromlist=['WhatsAppTestView']).WhatsAppTestView.as_view()),
         name="whatsapp_test"),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
