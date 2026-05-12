from django.core.management.base import BaseCommand
from apps.usuarios.models import Usuario


class Command(BaseCommand):
    help = "Crea el superusuario inicial si no existe"

    def handle(self, *args, **kwargs):
        if Usuario.objects.filter(ci="admin").exists():
            self.stdout.write("Superusuario ya existe, omitiendo.")
            return
        Usuario.objects.create_superuser(
            ci="admin",
            email="admin@uagrm.edu.bo",
            nombre="Administrador",
            apellido="Sistema",
            password="Admin1234!",
        )
        self.stdout.write(self.style.SUCCESS("Superusuario creado: CI=admin / Admin1234!"))
