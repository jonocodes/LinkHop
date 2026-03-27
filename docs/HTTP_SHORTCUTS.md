# HTTP Shortcuts Integration Guide

HTTP Shortcuts is an Android app that allows you to create custom shortcuts for API calls. This guide shows you how to set up LinkHop integration on your Android device.

## Installation

1. Install **HTTP Shortcuts** from Google Play Store
2. Open the app and grant necessary permissions

## Quick Setup

### Step 1: Create Enrollment Token

1. Login to LinkHop admin panel: `https://your-linkhop.com/admin/`
2. Go to "Enrollment Tokens"
3. Click "Add Enrollment Token"
4. Give it a label like "Android Phone"
5. Save and copy the token

### Step 2: Register Your Device

Create a shortcut to register your Android device:

**Shortcut Configuration:**
- **Name:** Register Device
- **Method:** POST
- **URL:** `https://your-linkhop.com/api/devices/register`
- **Content Type:** application/json

**Request Body:**
```json
{
  "enrollment_token": "YOUR_ENROLLMENT_TOKEN_HERE",
  "device_name": "My Android Phone",
  "platform_label": "Android",
  "app_version": "1.0"
}
```

**Execute the shortcut** and save the returned device token somewhere secure!

---

## Common Shortcuts

### 1. Send Current URL to Default Device

This shortcut sends the URL you're currently viewing to a predefined device.

**Shortcut Configuration:**
- **Name:** Send to Laptop
- **Icon:** Link/Share icon
- **Method:** POST
- **URL:** `https://your-linkhop.com/api/messages`

**Headers:**
```
Authorization: Bearer YOUR_DEVICE_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "recipient_device_id": "YOUR_LAPTOP_DEVICE_UUID",
  "type": "url",
  "body": "{{url}}"
}
```

**Variables:**
- `{{url}}` - Automatically populated with the current page URL

**Sharing:** Enable "Allow to receive URL/shared text from other apps"

### 2. Send URL with Device Picker

Shows a selection dialog to choose which device to send to.

**Shortcut Configuration:**
- **Name:** Send URL
- **Method:** POST
- **URL:** `https://your-linkhop.com/api/messages`

**Headers:**
```
Authorization: Bearer YOUR_DEVICE_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "recipient_device_id": "{{device_id}}",
  "type": "url",
  "body": "{{url}}"
}
```

**Variables:**
- `{{url}}` - Current page URL
- `{{device_id}}` - Device picker (see setup below)

**Device Picker Setup:**
1. Create a "Static Variable" named `device_id`
2. Type: Single Choice
3. Options:
   ```
   550e8400-e29b-41d4-a716-446655440000 | Laptop
   550e8400-e29b-41d4-a716-446655440001 | Desktop
   550e8400-e29b-41d4-a716-446655440002 | iPad
   ```
4. Set key-value pairs (UUID = key, display name = value)

### 3. Send Custom Text

Allows you to type custom text and send it.

**Shortcut Configuration:**
- **Name:** Send Text
- **Method:** POST
- **URL:** `https://your-linkhop.com/api/messages`

**Headers:**
```
Authorization: Bearer YOUR_DEVICE_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "recipient_device_id": "YOUR_DEFAULT_DEVICE_UUID",
  "type": "text",
  "body": "{{text}}"
}
```

**Variables:**
- `{{text}}` - Prompt for text input (create as "Text Input" variable)

**Variable Configuration:**
- Name: `text`
- Type: Text Input
- Title: "Message"
- Message: "Enter text to send"
- Allow Empty: No

### 4. Send Copied Text

Sends whatever is currently in your clipboard.

**Shortcut Configuration:**
- **Name:** Send Clipboard
- **Method:** POST
- **URL:** `https://your-linkhop.com/api/messages`

**Headers:**
```
Authorization: Bearer YOUR_DEVICE_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "recipient_device_id": "YOUR_DEFAULT_DEVICE_UUID",
  "type": "text",
  "body": "{{clipboard}}"
}
```

**Variables:**
- `{{clipboard}}` - System variable, automatically populated with clipboard content

### 5. Quick Send from Browser Share Menu

Appears in browser "Share" menu for instant URL sending.

**Shortcut Configuration:**
- **Name:** Quick Send to Laptop
- **Icon:** Link icon
- **Method:** POST
- **URL:** `https://your-linkhop.com/api/messages`
- **Trigger:** Share with HTTP Shortcuts

**Headers:**
```
Authorization: Bearer YOUR_DEVICE_TOKEN
Content-Type: application/json
```

**Request Body:**
```json
{
  "recipient_device_id": "LAPTOP_UUID",
  "type": "url",
  "body": "{{url}}"
}
```

**Important:** Enable "Allow to receive URL/shared text from other apps" in shortcut settings.

---

## Advanced Configurations

### Device Selection from Server

Dynamically fetch device list from server before sending:

**Shortcut 1: Refresh Device List**
- **Name:** Refresh Devices
- **Method:** GET
- **URL:** `https://your-linkhop.com/api/devices`
- **Headers:** `Authorization: Bearer YOUR_DEVICE_TOKEN`
- **Response Handling:**
  - Store response in variable `devices`
  - Parse JSON and extract device names/IDs

**Shortcut 2: Send with Dynamic Selection**
- Use the `devices` variable to populate choice options

### Quick Actions (Home Screen)

Add shortcuts to your home screen for instant access:

1. Long-press shortcut in HTTP Shortcuts
2. Select "Place on Home Screen"
3. Or use Android widgets: Add Widget → HTTP Shortcuts

### Quick Settings Tile (Android 7+)

Add shortcuts to Quick Settings panel:

1. Open HTTP Shortcuts Settings
2. Enable "Quick Settings Tiles"
3. Select shortcuts to add
4. Pull down notification shade and edit Quick Settings

### Voice Activation

Use with Google Assistant via Tasker:

1. Install Tasker
2. Create task: HTTP Request → HTTP Shortcuts trigger
3. Add voice command in Google Assistant routines
4. Say "Hey Google, send this to my laptop"

---

## Security Tips

1. **Protect your device token**
   - Don't share shortcuts containing your token
   - Use HTTP Shortcuts' built-in variable encryption
   - Set shortcut execution confirmation for sensitive actions

2. **Enable confirmation dialogs**
   - Settings → Shortcut → "Confirm before execution"
   - Prevents accidental sends

3. **Use HTTPS only**
   - Never use HTTP in production
   - Verify SSL certificate is valid

4. **Store tokens securely**
   - Use HTTP Shortcuts' password-protected variables
   - Don't store tokens in plain text in shortcut descriptions

---

## Troubleshooting

### "401 Unauthorized" Error

**Cause:** Invalid or expired device token
**Fix:** 
- Re-register device to get new token
- Check token is correctly copied (no extra spaces)

### "Connection Failed" Error

**Cause:** Network issues or wrong URL
**Fix:**
- Verify server URL is correct
- Check you're using HTTPS not HTTP
- Test connection with browser first

### URL Not Being Captured

**Cause:** Variable not set up correctly
**Fix:**
- Use `{{url}}` variable (built-in)
- Enable "Receive from Share Menu" in shortcut settings
- Test by sharing from Chrome

### Messages Not Appearing on Target Device

**Cause:** 
- Device offline
- Wrong recipient UUID
- Message expired

**Fix:**
- Check device is connected and online
- Verify UUID is correct
- Check admin panel for message status

---

## Example: Complete "Share to Laptop" Setup

### Prerequisites
- Device token from registration
- Laptop/device UUID from device list

### Step-by-Step

1. **Create Shortcut**
   - Open HTTP Shortcuts
   - Tap "+" → "Regular Shortcut"

2. **Configure Basics**
   - Name: "Send to Laptop"
   - Icon: Link icon (or custom)
   - Description: "Send current URL to my laptop"

3. **Set Request Method**
   - Method: POST
   - URL: `https://your-linkhop.com/api/messages`

4. **Add Headers**
   - Tap "Add Header"
   - Header 1: `Authorization` = `Bearer YOUR_DEVICE_TOKEN`
   - Header 2: `Content-Type` = `application/json`

5. **Set Request Body**
   - Body Type: Custom Text
   - Content-Type: application/json
   - Body:
     ```json
     {
       "recipient_device_id": "YOUR_LAPTOP_UUID",
       "type": "url",
       "body": "{{url}}"
     }
     ```

6. **Configure Response**
   - Response Type: Toast (brief popup)
   - Success Message: "Sent to laptop!"
   - Failure Message: "Failed to send"

7. **Enable Sharing**
   - Scroll to "Trigger"
   - Enable "Allow to receive URL/shared text from other apps"

8. **Test**
   - Open Chrome
   - Go to any website
   - Tap Share → "Send to Laptop"
   - Check your laptop!

---

## Tips & Tricks

1. **Use descriptive names** for shortcuts (e.g., "To Laptop" not "Send")
2. **Group shortcuts** by category (Send URLs, Send Text, etc.)
3. **Add vibration** on success for tactile feedback
4. **Use different icons** for different target devices
5. **Test offline behavior** - shortcuts queue and retry automatically
6. **Use variables** for dynamic content (URLs, clipboard, input)
7. **Backup your shortcuts** - HTTP Shortcuts has export/import

---

## Alternative: Share via Web Interface

If you don't want to use HTTP Shortcuts, you can:

1. Open browser share menu
2. Select "LinkHop" app (if installed as PWA)
3. Or manually open `https://your-linkhop.com/send?type=url&body=URL`

---

## See Also

- [API.md](API.md) - Complete API reference
- [DEPLOYMENT.md](DEPLOYMENT.md) - Self-hosting LinkHop
- HTTP Shortcuts documentation: https://http-shortcuts.rmy.ch/
