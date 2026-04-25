from django.contrib import admin
from django.urls import path
from django.conf import settings
from django.conf.urls.static import static
from django.views.decorators.csrf import csrf_exempt
from strawberry.django.views import GraphQLView
from schema import schema

urlpatterns = [
    path("admin/", admin.site.urls),
    path("graphql/", csrf_exempt(GraphQLView.as_view(schema=schema))),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
