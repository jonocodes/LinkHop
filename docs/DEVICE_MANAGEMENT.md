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

LinkHop uses a two-step authentication process:

1. **Enrollment Token** - Single-use token created by admin
2. **Device Token** - Permanent bearer token received after registration

```
┌─────────────┐     Enrollment Token     ┌─────────────┐
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
| Enrollment | `enroll_...` | Single-use (or until expired) | Initial registration |
| Device | `device_...` | Permanent (until revoked) | API authentication |

---

## Registering New Devices

### Step 1: Create Enrollment Token (Admin)

**Via Admin Panel:**

1. Login to `https://your-linkhop.com/admin/`
2. Navigate to "Enrollment Tokens"
3. Click "Add Enrollment Token"
4. Fill in:
   - **Label:** Descriptive name (e.g., "John's iPhone", "Work Laptop")
   - **Expires at:** (Optional) Token expiration date
5. Save
6. **Copy the token** - it's displayed only once!

**Via Django Shell:**

```bash
cd /opt/linkhop
source .venv/bin/activate
python manage.py shell
```

```python
from core.services.auth import create_enrollment_token

# Create token
token_obj, token_string = create_enrollment_token(
    label="John's iPhone",
    expires_in_hours=24  # Optional: expires in 24 hours
)

print(f"Enrollment Token: {token_string}")
# enroll_abc123xyz...
```

### Step 2: Register Device

**Via API:**

```bash
curl -X POST https://your-linkhop.com/api/devices/register \
  -H "Content-Type: application/json" \
  -d '{
    "enrollment_token": "enroll_abc123xyz...",
    "device_name": "John iPhone",
    "platform_label": "iOS",
    "app_version": "1.0"
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

**Via Web Interface:**

1. Open `https://your-linkhop.com/connect`
2. Enter the device token received from API registration
3. Click "Connect"
4. Token is stored in browser cookie

---

## Viewing Registered Devices

### Via Admin Panel

1. Go to `/admin/core/device/`
2. View all registered devices:
   - Device name
   - Platform
   - Last seen timestamp
   - Online/offline status
   - Revoked status

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
| `is_online: true` | Currently connected via SSE |

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
2. Go to "Devices"
3. Click the device name
4. Click "Revoke" button in top right
5. Confirm revocation

**Effects:**
- Device token immediately stops working
- Device cannot send or receive messages
- Device appears as "Revoked" in admin

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

### Method 3: Bulk Revoke

```python
# Revoke all devices for a user/platform
from core.models import Device
from django.utils import timezone

Device.objects.filter(
    platform_label="iOS"
).update(revoked_at=timezone.now())
```

### What Happens After Revocation

**Immediate Effects:**
```bash
# All API calls fail with 401
curl -H "Authorization: Bearer REVOKED_TOKEN" \
  https://your-linkhop.com/api/device/me

# Response:
{"detail": "Unauthorized"}
```

**Device Experience:**
- Web app: Redirected to `/connect` page
- API clients: Receive 401 errors
- SSE connections: Disconnected

**Data Preservation:**
- Message history is retained
- Device record kept for audit trail
- Events remain in logs

---

## Re-registering Devices

### Scenario 1: Token Lost (Not Revoked)

If the device token is lost but the device wasn't revoked:

**Unfortunately, tokens cannot be retrieved.** You must:

1. Revoke the old device (if you can identify it)
2. Create new enrollment token
3. Register as new device

```bash
# Admin: Revoke old device
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

```bash
# Create new enrollment token
python manage.py shell
```

```python
from core.services.auth import create_enrollment_token
_, token = create_enrollment_token(label="John iPhone (Re-registered)")
print(token)
```

```bash
# User: Register with new token
curl -X POST https://your-linkhop.com/api/devices/register \
  -H "Content-Type: application/json" \
  -d '{
    "enrollment_token": "NEW_TOKEN",
    "device_name": "John iPhone 2",
    "platform_label": "iOS"
  }'
```

### Scenario 2: Device Replaced

When replacing a device (e.g., new phone):

**Option A: Transfer (if you have old device)**
1. Note the device token from old device
2. Setup new device with same token
3. Revoke old device when ready

**Option B: Fresh Registration (recommended)**
1. Create new enrollment token
2. Register new device with new name (e.g., "John iPhone 14")
3. Update any shortcuts/automation to use new token
4. Revoke old device after verification

### Scenario 3: Device Compromised

If token is suspected compromised:

1. **Immediately revoke** the device via admin panel
2. **Create new enrollment token** 
3. **Register new device** with new token
4. **Update all clients** with new token
5. **Review message logs** for unauthorized access

```bash
# Emergency revocation
python manage.py shell
```

```python
from core.models import Device
from django.utils import timezone

# Immediate revocation
device = Device.objects.get(name="Compromised Device")
device.revoked_at = timezone.now()
device.is_active = False  # Also disable
device.save()

print(f"🚨 Device {device.name} EMERGENCY REVOKED")
```

---

## Device Security Best Practices

### For Admins

**1. Use Descriptive Labels**
```
Good:  "John iPhone - Personal"
Good:  "Work Laptop - Engineering"
Bad:   "Device 1"
Bad:   "Phone"
```

**2. Set Expiration on Enrollment Tokens**

```python
# Tokens expire in 24 hours
create_enrollment_token(
    label="Temporary Device",
    expires_in_hours=24
)
```

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
inactice = Device.objects.filter(
    last_seen_at__lt=timezone.now() - timedelta(days=30),
    revoked_at__isnull=True
)

for d in inactive:
    print(f"Review: {d.name} - Last seen: {d.last_seen_at}")
```

**4. Principle of Least Privilege**
- Only create enrollment tokens when needed
- Revoke immediately after registration if token shared insecurely
- Don't reuse enrollment tokens

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
1. Register new device token
2. Update all integrations
3. Revoke old token

**4. Monitor for Unauthorized Use**

Check inbox for messages you didn't send:
```bash
# List recent messages sent from your device
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-linkhop.com/api/messages/incoming | jq '.[] | select(.sender_device_id == "YOUR_ID")'
```

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

# Check device status in admin
python manage.py shell
```

```python
from core.models import Device

# Find device by token hash (admin only)
device = Device.objects.get(token_hash="hash_of_your_token")
print(f"Active: {device.is_active}")
print(f"Revoked: {device.revoked_at}")
print(f"Last seen: {device.last_seen_at}")
```

**Solutions:**
- If revoked: Re-register device
- If inactive: Admin must reactivate
- If wrong token: Find correct token or re-register

### "Device name already exists" Error

**Cause:** Device names must be unique

**Solutions:**
```bash
# Option 1: Use different name
curl -X POST /api/devices/register \
  -d '{"device_name": "John iPhone 2", ...}'

# Option 2: Admin deletes old device
python manage.py shell
Device.objects.get(name="John iPhone").delete()
```

### "Invalid enrollment token" Error

**Causes:**
1. Token already used
2. Token expired
3. Token typo

**Solutions:**
- Create new enrollment token
- Check expiration date in admin
- Verify token string is correct

### Lost Device Token

**No recovery option.** You must:
1. Revoke old device (if identifiable)
2. Create new enrollment token
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
python manage.py shell -c "from core.models import Device; print('\n'.join([f'{d.name}: Active={d.is_active}, Revoked={d.revoked_at}') for d in Device.objects.all()]))"

# Revoke device by name
python manage.py shell -c "from core.models import Device; from django.utils import timezone; Device.objects.filter(name='DEVICE_NAME').update(revoked_at=timezone.now())"

# Create enrollment token
python manage.py shell -c "from core.services.auth import create_enrollment_token; print(create_enrollment_token(label='New Device')[1])"
```

### API Quick Reference

| Action | Endpoint | Auth |
|--------|----------|------|
| Register | `POST /api/devices/register` | None (needs enroll token) |
| List devices | `GET /api/devices` | Bearer |
| My device | `GET /api/device/me` | Bearer |
| Revoke | Admin only | N/A |

---

## See Also

- [API.md](API.md) - Complete API documentation
- [DEPLOYMENT.md](DEPLOYMENT.md) - Installation guide
- [HTTP_SHORTCUTS.md](HTTP_SHORTCUTS.md) - Mobile integration
