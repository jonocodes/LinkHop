from django.contrib import admin, messages
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from django.shortcuts import redirect
from django.urls import path, reverse
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import (
    Device,
    GlobalSettings,
    Message,
    MessageType,
    PairingPin,
    PushSubscription,
)
from core.services.auth import create_pairing_pin
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
    list_display = ("name", "is_active", "last_seen_at", "revoked_at", "created_at")
    list_filter = ("is_active", "created_at", "last_seen_at", "revoked_at")
    search_fields = ("name",)
    readonly_fields = ("created_at", "updated_at", "last_seen_at", "token_hash")
    actions = [send_test_message]

    def has_add_permission(self, request):
        return False



@admin.register(PairingPin)
class PairingPinAdmin(ModelAdmin):
    list_display = ("id", "created_by_device", "is_active", "used_at", "expires_at", "created_at")
    list_filter = ("is_active", "used_at", "expires_at", "created_at")
    search_fields = ("id", "created_by_device__name")
    readonly_fields = ("created_at", "updated_at", "used_at", "code_hash")

    def has_add_permission(self, request):
        return False

    def get_urls(self):
        custom = [
            path(
                "generate/",
                self.admin_site.admin_view(self.generate_pin_view),
                name="core_pairingpin_generate",
            ),
        ]
        return custom + super().get_urls()

    def generate_pin_view(self, request):
        _pin, raw_pin = create_pairing_pin()
        messages.success(
            request,
            format_html(
                'Pairing PIN (valid 10 minutes): <code style="user-select:all; '
                'background:#f0f0f0; padding:4px 12px; font-size:1.5rem; letter-spacing:0.2em">{}</code>'
                ' &mdash; enter this on the new device at <strong>/connect</strong>',
                raw_pin,
            ),
        )
        return redirect(reverse("admin:core_pairingpin_changelist"))

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context["generate_pin_url"] = reverse("admin:core_pairingpin_generate")
        return super().changelist_view(request, extra_context=extra_context)


@admin.register(PushSubscription)
class PushSubscriptionAdmin(ModelAdmin):
    list_display = ("device", "is_active", "last_success_at", "last_failure_at", "updated_at")
    list_filter = ("is_active", "last_success_at", "last_failure_at", "updated_at")
    search_fields = ("device__name", "endpoint")
    readonly_fields = ("created_at", "updated_at", "last_success_at", "last_failure_at")


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



@admin.register(GlobalSettings)
class GlobalSettingsAdmin(ModelAdmin):
    list_display = (
        "singleton_key",
        "message_retention_days",
        "api_sends_per_minute",
        "api_confirmations_per_minute",
    )
    readonly_fields = ("created_at", "updated_at")

    def changelist_view(self, request, extra_context=None):
        del extra_context
        return redirect(reverse("admin_settings"))

    def change_view(self, request, object_id, form_url="", extra_context=None):
        del object_id, form_url, extra_context
        return redirect(reverse("admin_settings"))

    def has_add_permission(self, request):
        del request
        return False

    def has_delete_permission(self, request, obj=None):
        del request, obj
        return False
