from django.core.management.base import BaseCommand
from apps.vehiculos.tasks import alertar_documentos_por_vencer


class Command(BaseCommand):
    help = 'Envía notificaciones por documentos SOAT/Técnica próximos a vencer'

    def handle(self, *args, **options):
        self.stdout.write('Verificando documentos por vencer...')
        alertar_documentos_por_vencer()
        self.stdout.write(self.style.SUCCESS('Verificación completada.'))
