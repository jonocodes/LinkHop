from django.contrib import admin
from django.urls import path
from django.views.generic import RedirectView

from core.api import api
from core.sse import sse_view
from core.views import (
    admin_settings_view,
    connect_view,
    disconnect_view,
    healthcheck,
    home_view,
    inbox_view,
    manifest_view,
    message_detail_view,
    message_open_view,
    pair_view,
    service_worker_view,
    send_view,
)

urlpatterns = [
    path("", home_view, name="home"),
    path("manifest.json", manifest_view, name="manifest"),
    path("service-worker.js", service_worker_view, name="service_worker"),
    path("admin/settings/", admin.site.admin_view(admin_settings_view), name="admin_settings"),
    path("admin/", admin.site.urls),
    path("healthz", healthcheck, name="healthcheck"),
    path("connect", connect_view, name="connect"),
    path("disconnect", disconnect_view, name="disconnect"),
    path("pair", pair_view, name="pair"),
    path("send", send_view, name="send"),
    path("hop", RedirectView.as_view(pattern_name="send", query_string=True), name="hop"),
    path("inbox", inbox_view, name="inbox"),
    path("messages/<str:message_id>/open", message_open_view, name="message_open"),
    path("messages/<str:message_id>", message_detail_view, name="message_detail"),
    path("api/events/stream", sse_view, name="sse_stream"),
    path("", api.urls),
]
