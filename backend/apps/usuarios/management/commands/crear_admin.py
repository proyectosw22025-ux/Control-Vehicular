from django.core.management.base import BaseCommand
from apps.usuarios.models import Usuario


class Command(BaseCommand):
    help = "Crea o resetea el superusuario inicial garantizando la contraseña correcta"

    def handle(self, *args, **kwargs):
        # Borrar y recrear garantiza hash correcto (igual que create_user en el registro)
        Usuario.objects.filter(ci="admin").delete()
        Usuario.objects.create_superuser(
            ci="admin",
            email="admin@uagrm.edu.bo",
            nombre="Administrador",
            apellido="Sistema",
            password="Admin1234!",
        )
        self.stdout.write(self.style.SUCCESS("Superusuario recreado: CI=admin / Admin1234!"))
