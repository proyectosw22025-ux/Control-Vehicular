from .models import Rol


def tiene_rol(user, *nombres_rol) -> bool:
    """Devuelve True si el usuario es superuser o tiene alguno de los roles indicados."""
    if not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    return Rol.objects.filter(
        usuario_roles__usuario=user,
        nombre__in=nombres_rol,
        is_active=True,
    ).exists()
