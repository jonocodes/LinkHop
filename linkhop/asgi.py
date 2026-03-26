import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "linkhop.settings.dev")

_django_app = get_asgi_application()

from django.conf import settings  # noqa: E402 — must come after get_asgi_application()

if settings.DEBUG:
    from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler
    application = ASGIStaticFilesHandler(_django_app)
else:
    application = _django_app
