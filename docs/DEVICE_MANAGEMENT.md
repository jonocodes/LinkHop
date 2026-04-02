# Device Management Guide

Guide for managing devices, including registration, revocation, and re-registration.

## Table of Contents

1. [Understanding Device Authentication](#understanding-device-authentication)
2. [Registering New Devices](#registering-new-devices)
3. [Viewing Registered Devices](#viewing-registered-devices)
4. [Revoking Device Access](#revoking-device-access)
5. [Re-registering Devices](#re-registering-devices)
6. [Device Security Best Practices](#device-security-best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Understanding Device Authentication

### How It Works

LinkHop uses two authentication layers:

1. **Account session** — password-based login at `/account/login/` (Django session cookie, 2 weeks)
2. **Device token** — long-lived cookie set when you register a browser as a device (1 year)

```
┌─────────────┐     Password login       ┌─────────────┐
│   User      │ ──────────────────────→  │  Account    │
│  (Browser)  │                          │  Session    │
└─────────────┘                          └──────┬──────┘
                                                │
                                                │ Register device
                                                ↓
                                         ┌─────────────┐
                                         │   Device    │
                                         │   Token     │
                                         │  (Cookie)   │
                                         └─────────────┘
```

### Token Types

| Token Type | Format | Lifetime | Usage |
|------------|--------|----------|-------|
| Account session | Django session cookie | 2 weeks | Account access |
| Device token | `linkhop_device_token` cookie | 1 year | Device identity, push subscriptions |

---

## Registering New Devices

### Via Web Interface (recommended)

1. Visit `/account/login/` and sign in with your account credentials
2. If the browser doesn't have a device cookie, you'll be redirected to `/account/activate-device/`
3. Choose a device name (e.g. "Work Laptop", "Phone Firefox")
4. Click "Register this device"
5. Browser/OS info is automatically detected from the User-Agent header

If the browser is already registered, visiting `/account/activate-device/` will redirect to the connected devices page with a message showing the existing device name.

### Via API

Devices can also register via the API using a bearer token from an existing device:

```bash
curl -X POST https://your-linkhop.com/api/messages \
  -H "Authorization: Bearer device_..." \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

---

## Viewing Registered Devices

### Via Account Dashboard

1. Sign in at `/account/login/`
2. Go to Connected Devices in the sidebar
3. View all registered devices:
   - Device name (editable via rename)
   - Online/recently seen/offline status
   - Browser / OS info
   - Last active timestamp
   - Send test / Remove actions

### Via Admin Panel

1. Login to `/admin/`
2. Go to LinkHop → Devices
3. View all devices across all accounts

### Via API

```bash
curl -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \
  https://your-linkhop.com/api/devices
```

### Device States

| State | Description |
|-------|-------------|
| `is_active: true` | Device is enabled and can send/receive |
| `is_active: false` | Device disabled by admin |
| `revoked_at: null` | Token is valid |
| `revoked_at: timestamp` | Token revoked, cannot authenticate |
| Online (green) | Push delivered recently |
| Recently seen (orange) | Seen within 25 seconds |
| Offline (grey) | Not seen within threshold |

---

## Revoking Device Access

### When to Revoke

Revoke a device when:
- Device is lost or stolen
- Token is compromised
- User no longer needs access
- Suspicious activity detected

### Method 1: Account Dashboard

1. Sign in at `/account/login/`
2. Go to Connected Devices
3. Click "Remove" next to the device

### Method 2: Admin Panel

1. Login to `/admin/`
2. Go to LinkHop → Devices
3. Click on the device
4. Set `revoked_at` to the current timestamp and save

### Method 3: Django Shell

```bash
python manage.py shell
```

```python
from core.models import Device
from django.utils import timezone

device = Device.objects.get(name="John iPhone")
device.revoked_at = timezone.now()
device.save()
```

### What Happens After Revocation

- API calls from the device fail with 401
- Web pages redirect to the login page
- Push subscriptions are no longer used for delivery

---

## Re-registering Devices

### Scenario 1: Device Cookie Lost

If the browser's device cookie was cleared:

1. Sign in at `/account/login/`
2. You'll be prompted to register the device again
3. The old device record remains in the database — remove it via Connected Devices if desired

### Scenario 2: Device Replaced

When replacing a device (e.g. new phone):

1. Sign in on the new device at `/account/login/`
2. Register it with a new name
3. Remove the old device from Connected Devices

### Scenario 3: Device Compromised

If a token is suspected compromised:

1. Immediately remove the device from Connected Devices or revoke in admin
2. Sign in on a fresh browser and register a new device
3. Review the message log at `/admin/message-log/` for suspicious activity

---

## Device Security Best Practices

### For Admins

**1. Use Descriptive Names**
```
Good:  "John iPhone - Personal"
Good:  "Work Laptop - Engineering"
Bad:   "Device 1"
Bad:   "Phone"
```

**2. Regular Audit**

Review devices monthly via the Connected Devices page or:

```python
from core.models import Device
from django.utils import timezone
from datetime import timedelta

inactive = Device.objects.filter(
    last_seen_at__lt=timezone.now() - timedelta(days=30),
    revoked_at__isnull=True
)
for d in inactive:
    print(f"Review: {d.name} - Last seen: {d.last_seen_at}")
```

### For Users

**1. Use Different Devices Per Browser**

Don't share device tokens between browsers. Each browser should have its own registration.

**2. Log Out on Shared Computers**

The account session expires after 2 weeks. Use `/account/logout/` on shared machines.

---

## Troubleshooting

### "401 Unauthorized" API Error

**Causes:**
1. Token is revoked
2. Token is incorrect
3. Device is inactive

**Diagnosis:**
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-linkhop.com/api/device/me
```

### Messages Not Arriving

1. Check push notification permission in the browser
2. Visit `/account/debug/` for push diagnostics
3. Verify VAPID keys are configured (check `.env`)
4. Check the message log at `/admin/message-log/`

### Device Shows "Offline"

**Normal if:**
- Browser tab closed
- No recent API activity

**Check push:**
- Visit `/account/debug/` on the device
- Verify push subscription is active
- Try "Send test push" to verify delivery

---

## Quick Reference

### API Quick Reference

| Action | Endpoint | Auth |
|--------|----------|------|
| List devices | `GET /api/devices` | Bearer |
| My device | `GET /api/device/me` | Bearer |
| Send message | `POST /api/messages` | Bearer |
| Push config | `GET /api/push/config` | Bearer |
| Test push | `POST /api/push/test` | Bearer |

---

## See Also

- [API.md](API.md) - Complete API documentation
- [DEPLOYMENT.md](DEPLOYMENT.md) - Installation guide
- [HTTP_SHORTCUTS.md](HTTP_SHORTCUTS.md) - Mobile integration
