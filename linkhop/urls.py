from django.contrib import admin
from django.urls import path

from core.api import api
from core.views import healthcheck

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthcheck, name="healthcheck"),
    path("", api.urls),
]
