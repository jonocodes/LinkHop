from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import Device, EnrollmentToken, Event, GlobalSettings, Message

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


@admin.register(Device)
class DeviceAdmin(ModelAdmin):
    list_display = ("name", "is_active", "last_seen_at", "created_at")
    list_filter = ("is_active", "created_at", "last_seen_at")
    search_fields = ("name", "platform_label", "app_version")
    readonly_fields = ("created_at", "updated_at", "last_seen_at", "revoked_at")


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
