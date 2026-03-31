from django.contrib import admin
from django.urls import include, path

from core.account_site import account_site

from core.sse import sse_view
from core.views import (
    debug_view,
    account_add_device_view,
    account_bookmarklet_view,
    account_change_password_view,
    account_connected_devices_view,
    account_login_view,
    account_logout_view,
    account_remove_device_view,
    account_send_test_message_view,
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
    path("admin/settings/", admin.site.admin_view(admin_settings_view), name="admin_settings"),
    path("admin/", admin.site.urls),
    path("account/login/", account_login_view, name="account_login"),
    path("account/logout/", account_logout_view, name="account_logout"),
    path("account/connected-devices/", account_connected_devices_view, name="account_connected_devices"),
    path("account/connected-devices/<str:device_id>/test-message", account_send_test_message_view, name="account_send_test_message"),
    path("account/connected-devices/<str:device_id>/remove", account_remove_device_view, name="account_remove_device"),
    path("account/add-device/", account_add_device_view, name="account_add_device"),
    path("account/bookmarklet/", account_bookmarklet_view, name="account_bookmarklet"),
    path("account/password/", account_change_password_view, name="account_change_password"),
    path("account/", account_site.urls),
    path("healthz", healthcheck, name="healthcheck"),
    path("connect", connect_view, name="connect"),
    path("disconnect", disconnect_view, name="disconnect"),
    path("pair", pair_view, name="pair"),
    path("send", send_view, name="send"),
    path("hop", hop_view, name="hop"),
    path("inbox", inbox_view, name="inbox"),
    path("messages/<str:message_id>/open", message_open_view, name="message_open"),
    path("messages/<str:message_id>", message_detail_view, name="message_detail"),
    path("debug", debug_view, name="debug"),
    path("api/events/stream", sse_view, name="sse_stream"),
    path("api/", include("core.api.urls")),
]
