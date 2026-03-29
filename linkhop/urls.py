from django.contrib import admin
from django.urls import include, path
from django.views.generic import RedirectView

from core.sse import sse_view
from core.views import (
    admin_add_device_view,
    admin_bookmarklet_view,
    admin_connected_devices_view,
    admin_send_test_message_view,
    admin_settings_view,
    connect_view,
    disconnect_view,
    healthcheck,
    home_view,
    hop_view,
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
    path("admin/connected-devices/", admin.site.admin_view(admin_connected_devices_view), name="admin_connected_devices"),
    path("admin/connected-devices/<str:device_id>/test-message", admin.site.admin_view(admin_send_test_message_view), name="admin_send_test_message"),
    path("admin/add-device/", admin.site.admin_view(admin_add_device_view), name="admin_add_device"),
    path("admin/bookmarklet/", admin.site.admin_view(admin_bookmarklet_view), name="admin_bookmarklet"),
    path("admin/settings/", admin.site.admin_view(admin_settings_view), name="admin_settings"),
    path("admin/", admin.site.urls),
    path("healthz", healthcheck, name="healthcheck"),
    path("connect", connect_view, name="connect"),
    path("disconnect", disconnect_view, name="disconnect"),
    path("pair", pair_view, name="pair"),
    path("send", send_view, name="send"),
    path("hop", hop_view, name="hop"),
    path("inbox", inbox_view, name="inbox"),
    path("messages/<str:message_id>/open", message_open_view, name="message_open"),
    path("messages/<str:message_id>", message_detail_view, name="message_detail"),
    path("api/events/stream", sse_view, name="sse_stream"),
    path("api/", include("core.api.urls")),
]
