from django.shortcuts import redirect
from unfold.sites import UnfoldAdminSite

from core.admin_navigation import build_admin_sidebar_navigation


class AccountAdminSite(UnfoldAdminSite):
    settings_name = "UNFOLD_ACCOUNT"
    site_header = "LinkHop Account"
    site_title = "LinkHop"
    index_title = "My account"

    def has_permission(self, request):
        # Account site has its own auth via account_login_required on each view.
        return True

    def each_context(self, request):
        from core.account_auth import get_account_user
        context = super().each_context(request)
        account_user = get_account_user(request)
        context["account_user"] = account_user
        context["available_apps"] = []
        # Give Unfold's templates (avatar, account links) a real user object.
        if account_user is not None:
            context["user"] = account_user
        return context

    def index(self, request, extra_context=None):
        return redirect("account_connected_devices")


account_site = AccountAdminSite(name="account")
