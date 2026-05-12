from django.core.management.base import BaseCommand
from apps.usuarios.models import Usuario


class Command(BaseCommand):
    help = "Crea o resetea el superusuario inicial garantizando la contraseña correcta"

    def handle(self, *args, **kwargs):
        usuario = Usuario.objects.filter(ci="admin").first()
        if usuario:
            # NUNCA borrar — borrar genera nuevo ID e invalida todos los JWT existentes
            usuario.set_password("Admin1234!")
            usuario.is_superuser = True
            usuario.is_staff = True
            usuario.is_active = True
            usuario.save(update_fields=["password", "is_superuser", "is_staff", "is_active"])
            self.stdout.write(self.style.SUCCESS(f"Superusuario verificado: CI=admin (id={usuario.pk}) / Admin1234!"))
        else:
            usuario = Usuario.objects.create_superuser(
                ci="admin",
                email="admin@uagrm.edu.bo",
                nombre="Administrador",
                apellido="Sistema",
                password="Admin1234!",
            )
            self.stdout.write(self.style.SUCCESS(f"Superusuario creado: CI=admin (id={usuario.pk}) / Admin1234!"))
