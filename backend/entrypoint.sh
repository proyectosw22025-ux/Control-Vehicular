#!/bin/sh
set -e

echo "==> Aplicando migraciones..."
python manage.py migrate --noinput

echo "==> Recopilando archivos estáticos..."
python manage.py collectstatic --noinput

echo "==> Iniciando Daphne (ASGI) en puerto ${PORT:-8000}..."
exec daphne -b 0.0.0.0 -p "${PORT:-8000}" config.asgi:application
