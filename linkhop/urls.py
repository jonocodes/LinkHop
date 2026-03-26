from django.contrib import admin
from django.urls import path
from django.views.generic import RedirectView

from core.api import api
from core.sse import sse_view
from core.views import (
    connect_view,
    disconnect_view,
    healthcheck,
    inbox_view,
    message_detail_view,
    message_open_view,
    send_view,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", healthcheck, name="healthcheck"),
    path("connect", connect_view, name="connect"),
    path("disconnect", disconnect_view, name="disconnect"),
    path("send", send_view, name="send"),
    path("hop", RedirectView.as_view(pattern_name="send", query_string=True), name="hop"),
    path("inbox", inbox_view, name="inbox"),
    path("messages/<str:message_id>/open", message_open_view, name="message_open"),
    path("messages/<str:message_id>", message_detail_view, name="message_detail"),
    path("api/events/stream", sse_view, name="sse_stream"),
    path("", api.urls),
]
