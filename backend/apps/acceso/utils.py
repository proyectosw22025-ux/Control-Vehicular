from .models import AuditLog


def log_audit(usuario, accion: str, descripcion: str, request=None):
    ip = None
    if request:
        x_fwd = request.META.get("HTTP_X_FORWARDED_FOR")
        ip = x_fwd.split(",")[0].strip() if x_fwd else request.META.get("REMOTE_ADDR")
    AuditLog.objects.create(
        accion=accion,
        descripcion=descripcion,
        usuario=usuario if getattr(usuario, "is_authenticated", False) else None,
        ip=ip,
    )
