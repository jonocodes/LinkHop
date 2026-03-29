import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "dev-only-secret-key-change-me",
)

DEBUG = os.getenv("DJANGO_DEBUG", "0") == "1"

ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = [
    "unfold",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "axes",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "axes.middleware.AxesMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "linkhop.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "linkhop.wsgi.application"
ASGI_APPLICATION = "linkhop.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

UNFOLD = {
    "SITE_TITLE": "LinkHop Admin",
    "SITE_HEADER": "LinkHop",
    "SITE_SYMBOL": "link",
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": False,
}

AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

AXES_ENABLED = True
AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1
AXES_RESET_ON_SUCCESS = True
AXES_LOCKOUT_TEMPLATE = None

LINKHOP_MESSAGE_URL_MAX_LENGTH = 2048
LINKHOP_MESSAGE_TEXT_MAX_LENGTH = 8000
LINKHOP_MESSAGE_RETENTION_DAYS = 7
LINKHOP_MAX_PENDING_MESSAGES = 500
LINKHOP_API_SENDS_PER_MINUTE = 30
LINKHOP_API_CONFIRMATIONS_PER_MINUTE = 120
LINKHOP_API_REGISTRATIONS_PER_HOUR = 10
LINKHOP_MAX_SSE_STREAMS_PER_DEVICE = 5
LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY = os.getenv("LINKHOP_WEBPUSH_VAPID_PUBLIC_KEY", "")
LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY = os.getenv("LINKHOP_WEBPUSH_VAPID_PRIVATE_KEY", "")
LINKHOP_WEBPUSH_VAPID_SUBJECT = os.getenv(
    "LINKHOP_WEBPUSH_VAPID_SUBJECT",
    "mailto:admin@localhost",
)
