# Multi-User Spec

Design spec for converting LinkHop from a single-tenant to a multi-user system.

---

## Goals

- Each user has their own isolated set of devices
- Users can only message between their own devices
- Users self-manage their devices and bookmarklet through a dedicated interface
- Superuser manages user accounts and global settings; does not need per-user device management
- No email required; no self-registration; admin creates all accounts

---

## Decisions

| Question | Decision |
|----------|----------|
| Account creation | Admin-only (superuser creates via Django admin) |
| User dashboard | Second `AdminSite` at `/account/` using Unfold theme |
| Existing data | Start fresh — no migration of existing devices needed |
| Admin virtual device | Stays ownerless (system-level, not tied to any user) |
| User auth | Separate Django session auth, independent of device cookie auth |

---

## Data Model Changes

### `Device` gets an owner

```python
owner = models.ForeignKey(
    settings.AUTH_USER_MODEL,
    null=True,        # null for system devices (Admin virtual device)
    blank=True,
    on_delete=models.CASCADE,
    related_name="devices",
)
```

- All user-created devices have `owner` set
- The system Admin virtual device has `owner=None`
- `Device.name` uniqueness: currently global. After this change it should be
  unique **per owner** (`unique_together = [("owner", "name")]`), so two users
  can each have a device named "laptop" without conflict.

### `PairingPin` gets an owner

Currently `PairingPin.created_by_device` is the only way to know who created a
PIN. When a user generates a PIN from the account dashboard (where there is no
device context yet), we need to know which user the new device should belong to.

```python
owner = models.ForeignKey(
    settings.AUTH_USER_MODEL,
    null=True,
    blank=True,
    on_delete=models.CASCADE,
    related_name="pairing_pins",
)
```

- When a device generates a PIN: `owner` is derived from `created_by_device.owner`
- When admin/account dashboard generates a PIN: `owner` is set explicitly
- `register_device_with_pairing_pin()` reads `pin.owner` to set the new device's owner

No changes needed to `Message`, `PushSubscription`, `GlobalSettings`.

---

## URL Structure

```
/admin/         Django admin — superuser only
                  - User management (create/delete/deactivate accounts)
                  - GlobalSettings
                  - Raw Device, Message, PairingPin access (all users)
                  - NO connected-devices, bookmarklet, add-device pages

/account/       User account dashboard — any authenticated Django user
                  - Login / logout (Django session auth)
                  - Connected devices (owner-scoped)
                  - Add device (generate pairing PIN, scoped to this user)
                  - Bookmarklet
                  - NO global settings

/connect        Unchanged (pairing flow, no login required)
/disconnect     Unchanged
/inbox          Unchanged (device cookie auth)
/send, /hop     Unchanged (device cookie auth)
/pair           Unchanged (device cookie auth — for device-initiated PIN generation)
/api/           Unchanged (bearer token auth)
```

---

## The Second AdminSite

Django supports multiple `AdminSite` instances. We create one at `core/account_site.py`:

```python
from django.contrib.admin import AdminSite

class AccountSite(AdminSite):
    site_header = "LinkHop"
    site_title = "LinkHop account"
    index_title = "My account"

account_site = AccountSite(name="account")
```

Mounted at `/account/` in `urls.py`.

### What's registered on `account_site`

Nothing via `ModelAdmin` — the three user-facing pages (devices, add-device,
bookmarklet) are custom views, same pattern as the current admin custom views.
`account_site.each_context(request)` provides the Unfold chrome. The site's
built-in login/logout views handle session auth.

### Access control

- `account_site.login_required` decorator wraps the three custom views
- Any active Django user can log in — no `is_staff` required
- Superusers can also log in and have their own devices there, just like any other user
- The three custom views always filter queries by `request.user`, regardless of superuser status
- `/admin/` and `/account/` are independent: being logged into one doesn't affect the other

---

## `/admin/` Changes

Remove from global admin sidebar navigation:
- Connected devices
- Bookmarklet
- Add device

Keep in global admin:
- GlobalSettings (settings page)
- Raw model access: Device, Message, PairingPin, PushSubscription
- User management (already there via Django auth)

The `admin_navigation.py` Management section shrinks to just "Settings".

---

## `/account/` Views

All three are straightforward ports of the existing admin custom views, with
`owner=request.user` filtering added.

### `account_connected_devices_view`

Port of `admin_connected_devices_view`:
- `Device.objects.filter(owner=request.user).exclude(name=_SYSTEM_DEVICE_NAME)`
- Same three-state presence display
- "Add device" button links to `account_add_device`
- "Send test" button (sends from Admin virtual device to a user's device)
- "Remove" button — same as current `forget_device` (hard delete: device + its messages)

### `account_add_device_view`

Port of `admin_add_device_view`:
- Same PRG pattern, same session storage of pending PIN
- `create_pairing_pin()` is called with `owner=request.user` (needs new param)
- PIN ownership is stored on the `PairingPin` so `register_device_with_pairing_pin()`
  knows which user to assign the new device to

### `account_bookmarklet_view`

Port of `admin_bookmarklet_view`:
- Identical — no user-scoping needed, the bookmarklet URL is the same for all users

---

## Service Layer Changes

### `create_pairing_pin(device, owner)`

Add optional `owner` param. If `device` is provided, derive owner from
`device.owner`. If only `owner` is provided (account dashboard path), use it
directly.

```python
def create_pairing_pin(
    *,
    device: Device | None = None,
    owner=None,
) -> tuple[PairingPin, str]:
    resolved_owner = owner or (device.owner if device else None)
    ...
    pairing_pin = PairingPin.objects.create(
        ...,
        created_by_device=device,
        owner=resolved_owner,
    )
```

### `register_device_with_pairing_pin(raw_pin, name)`

After validating the PIN, assign owner from `pin.owner`:

```python
device, raw_token = create_device_token(name=name, owner=pin.owner)
```

### `create_device_token(name, owner)`

Add `owner` param:

```python
def create_device_token(*, name: str, owner=None) -> tuple[Device, str]:
    ...
    device = Device.objects.create(name=name, token_hash=..., owner=owner)
```

### `list_active_devices(user)`

Add required `user` param. All callers updated:

```python
def list_active_devices(user):
    return Device.objects.filter(
        owner=user,
        is_active=True,
        revoked_at__isnull=True,
    ).order_by("name")
```

Callers: `hop_view`, `send_view`, `devices_list` API endpoint.

For the API, `request.auth` is a `Device`, so `request.auth.owner` gives the user.

---

## API Changes

`GET /api/devices` currently returns all active devices. After this change it
returns only devices belonging to the same owner as the requesting device:

```python
devices = list_active_devices(user=request.auth.owner)
```

No other API changes needed. Message send already validates
`recipient.is_active` and `revoked_at` — we add one more check:
recipient must have the same owner as the sender. (Or: just rely on the device
list only showing same-user devices, and validate owner match on send.)

---

## `Device.name` Uniqueness Change

Currently: `unique=True` (globally unique).
After: `unique_together = [("owner", "name")]`.

The Admin virtual device (owner=None) keeps its own uniqueness via the DB
constraint (NULL is distinct from NULL in most DBs, so two ownerless devices
could theoretically share a name — handle with a custom validator if needed,
or just rely on the single system device convention).

---

## What Stays the Same

- Device cookie auth (`COOKIE_NAME`, `device_login_required`, `get_device_from_request`)
- Bearer token auth (`require_device_auth`)
- SSE stream
- All message views (`/inbox`, `/send`, `/hop`, `/messages/...`)
- Push notification system
- `/connect` and `/pair` flows (PIN entry and device-initiated PIN generation)
- All existing tests (plus new ones for multi-user isolation)

---

## New Tests Needed

- User A's devices not visible to User B via API
- User A cannot send to User B's device
- Pairing PIN created by User A produces a device owned by User A
- Account dashboard shows only User A's devices when logged in as User A
- Account dashboard add-device flow creates device owned by the logged-in user
- Superuser can still see all devices in `/admin/`

---

## Migration

No data migration needed (starting fresh). The schema migration will:
1. Add `owner` FK to `Device` (nullable)
2. Add `owner` FK to `PairingPin` (nullable)
3. Change `Device.name` from `unique=True` to `unique_together = [("owner", "name")]`

---

## Open Questions

- Should `allow_self_send` in GlobalSettings stay global, or become per-user?
  (Probably keep global for now — simple.)
- Should the account dashboard show a read-only message history? (Probably not
  for now — inbox is on the device, not the account.)
- Rate limits: currently per-device. Fine as-is.
- A superuser's own devices (owned by their user account) are visible in both
  `/account/` (self-managed) and `/admin/` (raw access). This is fine and expected.
