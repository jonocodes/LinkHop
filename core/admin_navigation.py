from django.http import HttpRequest
from django.urls import reverse


def _can_manage_settings(request: HttpRequest) -> bool:
    user = request.user
    return user.has_perm("core.view_globalsettings") or user.has_perm("core.change_globalsettings")


def build_admin_sidebar_navigation(request: HttpRequest) -> list[dict]:
    if request.path.startswith("/account/"):
        return [
            {
                "title": "Messages",
                "items": [
                    {
                        "title": "Inbox",
                        "icon": "inbox",
                        "link": reverse("account_inbox"),
                        "permission": lambda req: True,
                    },
                    {
                        "title": "Send",
                        "icon": "send",
                        "link": reverse("account_send"),
                        "permission": lambda req: True,
                    },
                ],
            },
            {
                "title": "Devices",
                "items": [
                    {
                        "title": "Connected devices",
                        "icon": "device_hub",
                        "link": reverse("account_connected_devices"),
                        "permission": lambda req: True,
                    },
                    {
                        "title": "Register device",
                        "icon": "add_circle",
                        "link": reverse("account_activate_device"),
                        "permission": lambda req: True,
                    },
                    {
                        "title": "Bookmarklet",
                        "icon": "bookmarks",
                        "link": reverse("account_bookmarklet"),
                        "permission": lambda req: True,
                    },
                ],
            },
            {
                "title": "Account",
                "items": [
                    {
                        "title": "Change password",
                        "icon": "lock",
                        "link": reverse("account_change_password"),
                        "permission": lambda req: True,
                    },
                    {
                        "title": "System info",
                        "icon": "info",
                        "link": reverse("account_system"),
                        "permission": lambda req: True,
                    },
                    {
                        "title": "Debug",
                        "icon": "bug_report",
                        "link": reverse("account_debug"),
                        "permission": lambda req: True,
                    },
                ],
            },
        ]

    return [
        {
            "title": "Management",
            "items": [
                {
                    "title": "Global settings",
                    "icon": "settings",
                    "link": reverse("admin_settings"),
                    "permission": _can_manage_settings,
                },
            ],
        },
        {
            "title": "Accounts",
            "items": [
                {
                    "title": "Users",
                    "icon": "person",
                    "link": reverse("admin:auth_user_changelist"),
                    "permission": lambda req: req.user.has_perm("auth.view_user"),
                },
            ],
        },
        {
            "title": "LinkHop",
            "items": [
                {
                    "title": "Devices",
                    "icon": "devices",
                    "link": reverse("admin:core_device_changelist"),
                    "permission": lambda req: req.user.has_perm("core.view_device"),
                },
                {
                    "title": "Push subscriptions",
                    "icon": "notifications",
                    "link": reverse("admin:core_pushsubscription_changelist"),
                    "permission": lambda req: req.user.has_perm("core.view_pushsubscription"),
                },
            ],
        },
    ]
