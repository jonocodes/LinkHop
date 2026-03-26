from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import Device, EnrollmentToken, Event, GlobalSettings, Message, MessageType
from core.services.messages import create_message

admin.site.unregister(User)
admin.site.unregister(Group)


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass


@admin.action(description="Send test message to selected devices")
def send_test_message(modeladmin, request, queryset):
    sent = 0
    for recipient in queryset:
        sender = (
            Device.objects.filter(is_active=True, revoked_at__isnull=True)
            .exclude(id=recipient.id)
            .first()
        ) or recipient  # fall back to self if it's the only device

        try:
            create_message(
                sender_device=sender,
                recipient_device=recipient,
                message_type=MessageType.TEXT,
                body="test message",
                _skip_self_send_check=sender.id == recipient.id,
            )
            sent += 1
        except Exception as exc:
            modeladmin.message_user(request, f"Failed to send to {recipient.name}: {exc}", level="error")

    if sent:
        modeladmin.message_user(request, f"Sent {sent} test message(s).")


@admin.register(Device)
class DeviceAdmin(ModelAdmin):
    list_display = ("name", "is_active", "last_seen_at", "created_at")
    list_filter = ("is_active", "created_at", "last_seen_at")
    search_fields = ("name", "platform_label", "app_version")
    readonly_fields = ("created_at", "updated_at", "last_seen_at", "revoked_at")
    actions = [send_test_message]


@admin.register(EnrollmentToken)
class EnrollmentTokenAdmin(ModelAdmin):
    list_display = ("label", "is_active", "used_at", "expires_at", "created_at")
    list_filter = ("is_active", "used_at", "expires_at", "created_at")
    search_fields = ("label",)
    readonly_fields = ("created_at", "updated_at", "used_at")


@admin.register(Message)
class MessageAdmin(ModelAdmin):
    list_display = ("id", "type", "status", "recipient_device", "created_at", "expires_at")
    list_filter = ("type", "status", "recipient_device", "created_at", "expires_at")
    search_fields = ("body", "recipient_device__name", "sender_device__name")
    readonly_fields = (
        "created_at",
        "updated_at",
        "received_at",
        "presented_at",
        "opened_at",
    )


@admin.register(Event)
class EventAdmin(ModelAdmin):
    list_display = ("event_type", "device", "message", "created_at")
    list_filter = ("event_type", "created_at", "device")
    search_fields = ("event_type",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(GlobalSettings)
class GlobalSettingsAdmin(ModelAdmin):
    list_display = (
        "singleton_key",
        "message_retention_days",
        "api_sends_per_minute",
        "api_confirmations_per_minute",
    )
    readonly_fields = ("created_at", "updated_at")
