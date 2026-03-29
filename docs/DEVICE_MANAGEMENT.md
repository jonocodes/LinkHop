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

LinkHop uses a two-step pairing flow:

1. **Pairing PIN** - Single-use 6-digit PIN created by admin or an existing device
2. **Device Token** - Permanent bearer token received after registration

```
┌─────────────┐     6-digit PIN          ┌─────────────┐
│   Admin     │ ───────────────────────→ │ New Device  │
│  (Creates)  │                          │ (Registers) │
└─────────────┘                          └──────┬──────┘
                                                │
                                                │ Device Token
                                                ↓
                                         ┌─────────────┐
                                         │   Device    │
                                         │  (Stores    │
                                         │   Token)    │
                                         └─────────────┘
```

### Token Types

| Token Type | Format | Lifetime | Usage |
|------------|--------|----------|-------|
| Pairing PIN | 6-digit number | 10 minutes, single-use | Initial registration |
| Device Token | `device_...` | Permanent (until revoked) | API authentication |

---

## Registering New Devices

### Step 1: Create Pairing PIN

**Via Admin Panel:**

1. Login to `https://your-linkhop.com/admin/`
2. Navigate to "Connected devices" in the Management section
3. Click "Add device"
4. Click "Generate PIN"
5. Share the 6-digit PIN with the new device (expires in 10 minutes)

**Via Existing Device (web UI):**

1. Login to the app on an existing device
2. Go to the Pair page (`/pair`)
3. Click "Generate PIN"
4. Share the PIN (expires in 10 minutes)

**Via API (from an authenticated device):**

```bash
curl -X POST https://your-linkhop.com/api/pairings/pin \
  -H "Authorization: Bearer EXISTING_DEVICE_TOKEN"
```

**Response:**
```json
{
  "pin": "123456",
  "expires_at": "2026-03-29T12:10:00Z"
}
```

### Step 2: Register Device

**Via Web Interface (recommended):**

1. Open `https://your-linkhop.com/connect`
2. Enter the 6-digit PIN and a device name
3. Click "Connect"
4. Token is stored in browser cookie

**Via API:**

```bash
curl -X POST https://your-linkhop.com/api/pairings/pin/register \
  -H "Content-Type: application/json" \
  -d '{
    "pin": "123456",
    "device_name": "John iPhone"
  }'
```

**Response:**
```json
{
  "device": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "John iPhone",
    "is_active": true,
    "last_seen_at": null
  },
  "token": "device_xyz789..."
}
```

**⚠️ CRITICAL:** Save the `token` value immediately! It cannot be retrieved later.

---

## Viewing Registered Devices

### Via Admin Panel

1. Go to Management → Connected devices
2. View all registered devices:
   - Device name
   - Online/offline/recently-seen status
   - Last seen timestamp
   - Active/revoked status
   - Send test message button

### Via API

**List all devices:**

```bash
curl -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \
  https://your-linkhop.com/api/devices
```

**Get current device info:**

```bash
curl -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \
  https://your-linkhop.com/api/device/me
```

### Device States

| State | Description |
|-------|-------------|
| `is_active: true` | Device is enabled and can send/receive |
| `is_active: false` | Device disabled by admin |
| `revoked_at: null` | Token is valid |
| `revoked_at: timestamp` | Token revoked, cannot authenticate |
| `last_seen_at: timestamp` | Last API activity |
| Online (green) | Currently connected via SSE |
| Recently seen (orange) | No active SSE stream but seen within 25 seconds |
| Offline (grey) | Not seen within threshold |

---

## Revoking Device Access

### When to Revoke

Revoke a device when:
- Device is lost or stolen
- Token is compromised
- User no longer needs access
- Suspicious activity detected

### Method 1: Admin Panel (Recommended)

1. Login to `/admin/`
2. Go to Management → Connected devices
3. Click "View" next to the device
4. Set `revoked_at` to the current timestamp and save

**Effects:**
- Device token immediately stops working
- Device cannot send or receive messages
- Device appears as inactive in admin

### Method 2: Django Shell

```bash
python manage.py shell
```

```python
from core.models import Device
from django.utils import timezone

# Find device
device = Device.objects.get(name="John iPhone")

# Revoke
device.revoked_at = timezone.now()
device.save()

print(f"Device {device.name} revoked at {device.revoked_at}")
```

### What Happens After Revocation

**Immediate Effects:**
```bash
# All API calls fail with 401
curl -H "Authorization: Bearer REVOKED_TOKEN" \
  https://your-linkhop.com/api/device/me

# Response: 401 Unauthorized
```

**Device Experience:**
- Web app: Redirected to `/connect` page
- API clients: Receive 401 errors
- SSE connections: Disconnected

---

## Re-registering Devices

### Scenario 1: Token Lost (Not Revoked)

If the device token is lost but the device wasn't revoked:

**Unfortunately, tokens cannot be retrieved.** You must:

1. Revoke the old device (if you can identify it)
2. Generate a new pairing PIN from admin
3. Register as new device

```bash
python manage.py shell
```

```python
from core.models import Device
from django.utils import timezone

# Find and revoke
device = Device.objects.get(name="John iPhone")
device.revoked_at = timezone.now()
device.save()
```

Then generate a new PIN from admin and re-register.

### Scenario 2: Device Replaced

When replacing a device (e.g., new phone):

**Option A: Fresh Registration (recommended)**
1. Generate a new pairing PIN from admin
2. Register new device with new name (e.g., "John iPhone 14")
3. Update any shortcuts/automation to use new token
4. Revoke old device after verification

### Scenario 3: Device Compromised

If token is suspected compromised:

1. **Immediately revoke** the device via admin panel
2. **Generate a new pairing PIN**
3. **Register new device** with new token
4. **Update all clients** with new token
5. **Review message logs** for unauthorized access

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

**2. Pairing PINs Expire Quickly**

PINs expire after 10 minutes and are single-use. Only share them immediately before registering a device.

**3. Regular Audit**

Review devices monthly:
```bash
python manage.py shell
```

```python
from core.models import Device
from django.utils import timezone
from datetime import timedelta

# Find inactive devices (no activity in 30 days)
inactive = Device.objects.filter(
    last_seen_at__lt=timezone.now() - timedelta(days=30),
    revoked_at__isnull=True
)

for d in inactive:
    print(f"Review: {d.name} - Last seen: {d.last_seen_at}")
```

**4. Principle of Least Privilege**
- Only generate pairing PINs when needed
- PINs are single-use; generating a new one invalidates the previous one for the same device

### For Users

**1. Store Tokens Securely**

```bash
# Good: Environment variable
export LINKHOP_TOKEN="device_abc123..."

# Good: Password manager
# Store in 1Password, Bitwarden, etc.

# Bad: Plain text file
# echo "token" > token.txt  # DON'T DO THIS
```

**2. Use Different Tokens Per Device**

Don't share tokens between devices. Each should have its own registration.

**3. Rotate Tokens Periodically**

Every 6-12 months:
1. Register new device token (generate PIN + re-register)
2. Update all integrations
3. Revoke old token

---

## Troubleshooting

### "401 Unauthorized" Error

**Causes:**
1. Token is revoked
2. Token is incorrect
3. Device is inactive

**Diagnosis:**
```bash
# Check if token works
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-linkhop.com/api/device/me
```

**Solutions:**
- If revoked: Re-register device using a new pairing PIN
- If inactive: Admin must reactivate
- If wrong token: Find correct token or re-register

### "device_name_conflict" Error

**Cause:** Device names must be unique

**Solutions:**
```bash
# Option 1: Use different name
# Register with "John iPhone 2" instead

# Option 2: Admin deletes old device
python manage.py shell
Device.objects.get(name="John iPhone").delete()
```

### "invalid_pairing_pin" Error

**Causes:**
1. PIN already used
2. PIN expired (10 minute window)
3. PIN typo

**Solutions:**
- Generate a fresh PIN from admin or an existing device
- Register promptly before it expires

### Lost Device Token

**No recovery option.** You must:
1. Revoke old device (if identifiable)
2. Generate a new pairing PIN
3. Register as new device
4. Update all integrations

### Device Shows "Offline"

**Normal if:**
- Web browser tab closed
- Mobile app in background
- No recent activity

**Not normal if:**
- Active browser tab shows offline
- Recently sent messages not appearing

**Check:**
```bash
# Verify SSE connection
# Open browser dev tools → Network → Look for /api/events/stream
# Should show status 200 and streaming data
```

---

## Quick Reference

### Admin Commands

```bash
# List all devices
python manage.py shell -c "from core.models import Device; [print(f'{d.name}: Active={d.is_active}, Revoked={d.revoked_at}') for d in Device.objects.all()]"

# Revoke device by name
python manage.py shell -c "from core.models import Device; from django.utils import timezone; Device.objects.filter(name='DEVICE_NAME').update(revoked_at=timezone.now())"
```

### API Quick Reference

| Action | Endpoint | Auth |
|--------|----------|------|
| Create pairing PIN | `POST /api/pairings/pin` | Bearer |
| Register | `POST /api/pairings/pin/register` | None (needs PIN) |
| List devices | `GET /api/devices` | Bearer |
| My device | `GET /api/device/me` | Bearer |
| Revoke | Admin only | N/A |

---

## See Also

- [API.md](API.md) - Complete API documentation
- [DEPLOYMENT.md](DEPLOYMENT.md) - Installation guide
- [HTTP_SHORTCUTS.md](HTTP_SHORTCUTS.md) - Mobile integration
