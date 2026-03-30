from django import forms
from unfold.widgets import UnfoldAdminIntegerFieldWidget, UnfoldBooleanSwitchWidget

from core.models import GlobalSettings


class GlobalSettingsForm(forms.ModelForm):
    FIELDSETS = (
        (
            "Messaging",
            {
                "fields": (
                    "message_retention_days",
                    "max_pending_messages",
                    "allow_self_send",
                )
            },
        ),
        (
            "Device Registration",
            {
                "fields": (
                    "api_registrations_per_hour",
                )
            },
        ),
        (
            "Delivery and API Limits",
            {
                "fields": (
                    "api_sends_per_minute",
                    "api_confirmations_per_minute",
                    "max_sse_streams_per_device",
                )
            },
        ),
    )

    class Meta:
        model = GlobalSettings
        fields = [
            "message_retention_days",
            "api_sends_per_minute",
            "api_confirmations_per_minute",
            "api_registrations_per_hour",
            "max_sse_streams_per_device",
            "max_pending_messages",
            "allow_self_send",
        ]
        widgets = {
            "message_retention_days": UnfoldAdminIntegerFieldWidget(),
            "api_sends_per_minute": UnfoldAdminIntegerFieldWidget(),
            "api_confirmations_per_minute": UnfoldAdminIntegerFieldWidget(),
            "api_registrations_per_hour": UnfoldAdminIntegerFieldWidget(),
            "max_sse_streams_per_device": UnfoldAdminIntegerFieldWidget(),
            "max_pending_messages": UnfoldAdminIntegerFieldWidget(),
            "allow_self_send": UnfoldBooleanSwitchWidget(),
        }
