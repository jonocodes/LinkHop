from django.contrib.admin import AdminSite
from django.shortcuts import redirect

from core.admin_navigation import build_admin_sidebar_navigation


class AccountAdminSite(AdminSite):
    site_header = "LinkHop"
    site_title = "LinkHop"
    index_title = "My account"

    def has_permission(self, request):
        # Account site has its own auth via account_login_required on each view.
        return True

    def each_context(self, request):
        from core.account_auth import get_account_user

        def _with_permissions(groups):
            for group in groups:
                items = group.get("items", [])
                for item in items:
                    perm = item.get("permission")
                    item["has_permission"] = perm(request) if callable(perm) else True
                    if "items" in item:
                        item["items"] = _with_permissions([{"items": item["items"]}])[0]["items"]
            return groups

        context = super().each_context(request)
        context["account_user"] = get_account_user(request)
        context["available_apps"] = []
        # Account dashboard uses session auth separate from Django admin user perms.
        # Build sidebar items explicitly and attach has_permission for Unfold template.
        context["sidebar_navigation"] = _with_permissions(build_admin_sidebar_navigation(request))
        return context

    def index(self, request, extra_context=None):
        return redirect("account_connected_devices")


account_site = AccountAdminSite(name="account")
