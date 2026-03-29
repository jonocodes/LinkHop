from django.urls import path

from core.api import router


urlpatterns = [
    path("pairings/pin", router.pairing_pin_create),
    path("pairings/pin/register", router.register_device_with_pin),
    path("device/me", router.device_me),
    path("devices", router.devices_list),
    path("push/config", router.push_config),
    path("push/subscriptions", router.push_subscriptions),
    path("messages", router.messages_create),
    path("messages/incoming", router.messages_incoming),
    path("messages/<str:message_id>", router.message_get),
    path("messages/<str:message_id>/received", router.message_received),
    path("messages/<str:message_id>/presented", router.message_presented),
    path("messages/<str:message_id>/opened", router.message_opened),
]
