from functools import wraps

from django.contrib import admin, messages
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User
from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor
from django.shortcuts import redirect
from django.urls import reverse
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm

from core.models import (
    Device,
    GlobalSettings,
    PushSubscription,
)

admin.site.unregister(User)
admin.site.unregister(Group)


def _admin_has_unapplied_migrations() -> bool:
    connection = connections[DEFAULT_DB_ALIAS]
    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    return bool(plan)


_original_each_context = admin.site.each_context


@wraps(_original_each_context)
def _linkhop_admin_each_context(request):
    context = _original_each_context(request)
    try:
        has_unapplied_migrations = _admin_has_unapplied_migrations()
    except Exception:
        has_unapplied_migrations = False

    if has_unapplied_migrations and not getattr(request, "_linkhop_migration_warning_added", False):
        messages.warning(
            request,
            format_html(
                'Database migrations are pending. Run <code style="user-select:all; '
                'background:#f0f0f0; padding:4px 10px; border-radius:999px; font-weight:600">{}</code>.',
                "manage.py migrate",
            ),
        )
        request._linkhop_migration_warning_added = True

    context["linkhop_has_unapplied_migrations"] = has_unapplied_migrations
    return context


admin.site.each_context = _linkhop_admin_each_context


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
    list_display = ("name", "is_active", "last_seen_at", "revoked_at", "created_at")
    list_filter = ("is_active", "created_at", "last_seen_at", "revoked_at")
    search_fields = ("name",)
    readonly_fields = ("created_at", "updated_at", "last_seen_at", "token_hash")

    def has_add_permission(self, request):
        return False



@admin.register(PushSubscription)
class PushSubscriptionAdmin(ModelAdmin):
    list_display = ("device", "is_active", "last_success_at", "last_failure_at", "updated_at")
    list_filter = ("is_active", "last_success_at", "last_failure_at", "updated_at")
    search_fields = ("device__name", "endpoint")
    readonly_fields = ("created_at", "updated_at", "last_success_at", "last_failure_at")


@admin.register(GlobalSettings)
class GlobalSettingsAdmin(ModelAdmin):
    list_display = (
        "singleton_key",
        "api_sends_per_minute",
        "api_registrations_per_hour",
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
