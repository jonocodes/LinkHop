from django.http import HttpRequest
from django.urls import reverse


def _can_manage_settings(request: HttpRequest) -> bool:
    user = request.user
    return user.has_perm("core.view_globalsettings") or user.has_perm("core.change_globalsettings")


def build_admin_sidebar_navigation(request: HttpRequest) -> list[dict]:
    if request.path.startswith("/account/"):
        return [
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
                        "title": "Add device",
                        "icon": "add_circle",
                        "link": reverse("account_add_device"),
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
                    "title": "Messages",
                    "icon": "mail",
                    "link": reverse("admin:core_message_changelist"),
                    "permission": lambda req: req.user.has_perm("core.view_message"),
                },
                {
                    "title": "Pairing PINs",
                    "icon": "pin",
                    "link": reverse("admin:core_pairingpin_changelist"),
                    "permission": lambda req: req.user.has_perm("core.view_pairingpin"),
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
