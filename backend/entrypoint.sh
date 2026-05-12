#!/bin/sh
set -e

echo "==> Aplicando migraciones..."
python manage.py migrate --noinput

echo "==> Recopilando archivos estáticos..."
python manage.py collectstatic --noinput

echo "==> Creando superusuario inicial si no existe..."
python manage.py shell -c "
from apps.usuarios.models import Usuario
if not Usuario.objects.filter(ci='admin').exists():
    Usuario.objects.create_superuser(
        ci='admin',
        email='admin@uagrm.edu.bo',
        nombre='Administrador',
        apellido='Sistema',
        password='Admin1234!'
    )
    print('Superusuario creado.')
else:
    print('Superusuario ya existe.')
"

echo "==> Iniciando Daphne (ASGI) en puerto ${PORT:-8000}..."
exec daphne -b 0.0.0.0 -p "${PORT:-8000}" config.asgi:application
