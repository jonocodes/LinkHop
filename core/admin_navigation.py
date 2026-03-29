from django.http import HttpRequest
from django.urls import reverse


def _can_manage_settings(request: HttpRequest) -> bool:
    user = request.user
    return user.has_perm("core.view_globalsettings") or user.has_perm("core.change_globalsettings")


def _can_access_management_tools(request: HttpRequest) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff)


def build_admin_sidebar_navigation(request: HttpRequest) -> list[dict]:
    return [
        {
            "title": "Management",
            "items": [
                {
                    "title": "Connected devices",
                    "icon": "device_hub",
                    "link": reverse("admin_connected_devices"),
                    "permission": _can_access_management_tools,
                },
                {
                    "title": "Global settings",
                    "icon": "settings",
                    "link": reverse("admin_settings"),
                    "permission": _can_manage_settings,
                },
                {
                    "title": "Bookmarklet",
                    "icon": "bookmarks",
                    "link": reverse("admin_bookmarklet"),
                    "permission": _can_access_management_tools,
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
                {
                    "title": "Groups",
                    "icon": "groups",
                    "link": reverse("admin:auth_group_changelist"),
                    "permission": lambda req: req.user.has_perm("auth.view_group"),
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
