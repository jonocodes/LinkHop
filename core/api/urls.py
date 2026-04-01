from django.urls import path

from core.api import router


urlpatterns = [
    path("session/link", router.session_link),
    path("pairings/pin", router.pairing_pin_create),
    path("pairings/pin/register", router.register_device_with_pin),
    path("device/me", router.device_me),
    path("devices", router.devices_list),
    path("push/config", router.push_config),
    path("push/subscriptions", router.push_subscriptions),
    path("push/test", router.push_test),
    path("messages", router.messages_create),
]
