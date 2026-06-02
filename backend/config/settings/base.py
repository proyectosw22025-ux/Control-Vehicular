from decouple import config
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

CELERY_APP = "celery_app"

SECRET_KEY = config("SECRET_KEY")

INSTALLED_APPS = [
    "daphne",                             # debe ser el primero para sobrescribir runserver
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Terceros
    "strawberry.django",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "channels",
    "cloudinary_storage",
    "cloudinary",
    # Apps del proyecto
    "apps.usuarios",
    "apps.vehiculos",
    "apps.parqueos",
    "apps.acceso",
    "apps.visitantes",
    "apps.multas",
    "apps.notificaciones",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "config.middleware.JWTAuthMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": config("DB_NAME"),
        "USER": config("DB_USER"),
        "PASSWORD": config("DB_PASSWORD"),
        "HOST": config("DB_HOST", default="localhost"),
        "PORT": config("DB_PORT", default="5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "es-bo"
TIME_ZONE = "America/La_Paz"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# ── Cloudinary — almacenamiento de documentos en la nube ──────────────────
# Las credenciales vienen de variables de entorno (Railway/local .env)
# Si no están configuradas, Django usa el almacenamiento local (desarrollo)
CLOUDINARY_STORAGE = {
    "CLOUD_NAME": config("CLOUDINARY_CLOUD_NAME", default=""),
    "API_KEY":    config("CLOUDINARY_API_KEY",    default=""),
    "API_SECRET": config("CLOUDINARY_API_SECRET", default=""),
}
# Activar Cloudinary solo si las credenciales están presentes
_cloudinary_configurado = all([
    CLOUDINARY_STORAGE["CLOUD_NAME"],
    CLOUDINARY_STORAGE["API_KEY"],
    CLOUDINARY_STORAGE["API_SECRET"],
])
if _cloudinary_configurado:
    DEFAULT_FILE_STORAGE = "cloudinary_storage.storage.MediaCloudinaryStorage"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Green API — WhatsApp (producción lo sobreescribe con valores reales)
GREEN_API_INSTANCE_ID = ""
GREEN_API_TOKEN       = ""

# ── Cache — local memory en desarrollo, Redis en producción ──────────────────
# production.py sobreescribe esto con RedisCache.
# El semáforo público usa cache de 30s para no golpear la BD en cada request.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "uagrm-cache",
    }
}

AUTH_USER_MODEL = "usuarios.Usuario"

# AllowAllUsersModelBackend lets authenticate() return the user even when
# is_active=False so our login mutation can raise a meaningful "Usuario inactivo"
# error instead of the generic "Credenciales inválidas".
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.AllowAllUsersModelBackend",
]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [config("REDIS_URL", default="redis://localhost:6379/0")]},
    }
}

CELERY_BROKER_URL = config("REDIS_URL", default="redis://localhost:6379/0")
CELERY_RESULT_BACKEND = config("REDIS_URL", default="redis://localhost:6379/0")
CELERY_TIMEZONE = "America/La_Paz"
