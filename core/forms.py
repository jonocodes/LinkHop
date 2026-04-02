from django import forms
from unfold.widgets import UnfoldAdminIntegerFieldWidget, UnfoldBooleanSwitchWidget

from core.models import GlobalSettings


class GlobalSettingsForm(forms.ModelForm):
    FIELDSETS = (
        (
            "Messaging",
            {
                "fields": (
                    "allow_self_send",
                )
            },
        ),
        (
            "Rate Limits",
            {
                "fields": (
                    "api_sends_per_minute",
                    "api_registrations_per_hour",
                )
            },
        ),
    )

    class Meta:
        model = GlobalSettings
        fields = [
            "api_sends_per_minute",
            "api_registrations_per_hour",
            "allow_self_send",
        ]
        widgets = {
            "api_sends_per_minute": UnfoldAdminIntegerFieldWidget(),
            "api_registrations_per_hour": UnfoldAdminIntegerFieldWidget(),
            "allow_self_send": UnfoldBooleanSwitchWidget(),
        }
