from django.core.management.base import BaseCommand
from apps.usuarios.models import Usuario


class Command(BaseCommand):
    help = "Crea o resetea el superusuario inicial garantizando la contraseña correcta"

    def handle(self, *args, **kwargs):
        usuario, created = Usuario.objects.get_or_create(
            ci="admin",
            defaults={
                "email": "admin@uagrm.edu.bo",
                "nombre": "Administrador",
                "apellido": "Sistema",
                "is_superuser": True,
                "is_staff": True,
                "is_active": True,
            },
        )
        # Forzar contraseña correcta siempre (por si se creó con CRLF corrupto)
        usuario.set_password("Admin1234!")
        usuario.is_superuser = True
        usuario.is_staff = True
        usuario.is_active = True
        usuario.save()
        accion = "creado" if created else "actualizado"
        self.stdout.write(self.style.SUCCESS(f"Superusuario {accion}: CI=admin / Admin1234!"))
