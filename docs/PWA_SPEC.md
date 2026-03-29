# LinkHop PWA / Mobile Web Specification

## Version 1.1.0 - Draft

This document defines the push-first PWA strategy for LinkHop on mobile devices.
The purpose of the PWA is device notifications when the web app is not actively open.
Installability, manifest support, and service workers matter because they enable push,
not because a standalone shell is valuable on its own.

---

## 1. Product Goal and Scope

### 1.1 Primary Goal: Device Notifications

**Primary Goal:**
- deliver notifications to the user's device even when LinkHop is not open in a tab
- make those notifications work reliably enough on mobile to replace ad hoc browser-tab usage

**Non-Goal for the first PWA phase:**
- polished standalone app chrome
- offline-first message composition
- gesture-heavy mobile UX
- install-prompt optimization

### 1.2 Required Building Blocks

To achieve the goal above, the first PWA implementation needs:

- an installable PWA shell
- a service worker
- Web Push subscription management
- server-side push delivery
- notification click handling into LinkHop routes

Installation is therefore a prerequisite for push on some platforms, especially iOS.

### 1.3 Install Strategy

**Recommendation:**
- PWA installation is optional in product messaging
- PWA installation is operationally required for mobile push on iOS
- the app should explain this plainly instead of overselling "app-like" behavior

**Install prompt strategy for the first push-focused phase:**
- keep prompting minimal
- rely on native browser install affordances first
- add custom install education only where platform support requires it

**Rule:**
- do not build sophisticated install-prompt heuristics before push exists
- installation UX should support notification setup, not become a parallel product track

### 1.4 Install Experience by Platform

**iOS (Safari):**
```
1. Tap Share button
2. Scroll to "Add to Home Screen"
3. Tap "Add"
4. Icon appears on home screen
```

**Android (Chrome):**
```
1. Menu → "Add to Home Screen" OR
2. Bottom sheet appears automatically
3. Tap "Add"
4. Icon appears on home screen
```

**Desktop (Chrome/Edge):**
```
1. Address bar install icon OR
2. Menu → "Install LinkHop"
3. App opens in standalone window
```

### 1.5 Manifest Configuration

```json
{
  "name": "LinkHop",
  "short_name": "LinkHop",
  "description": "Send links and text between your devices",
  "start_url": "/inbox",
  "display": "standalone",
  "background_color": "#f5f5f5",
  "theme_color": "#0066cc",
  "orientation": "portrait-primary",
  "icons": [
    { "src": "/static/icons/icon-72.png", "sizes": "72x72" },
    { "src": "/static/icons/icon-96.png", "sizes": "96x96" },
    { "src": "/static/icons/icon-128.png", "sizes": "128x128" },
    { "src": "/static/icons/icon-144.png", "sizes": "144x144" },
    { "src": "/static/icons/icon-152.png", "sizes": "152x152" },
    { "src": "/static/icons/icon-192.png", "sizes": "192x192" },
    { "src": "/static/icons/icon-384.png", "sizes": "384x384" },
    { "src": "/static/icons/icon-512.png", "sizes": "512x512" }
  ],
  "categories": ["productivity", "utilities"],
  "screenshots": [
    {
      "src": "/static/screenshots/inbox-mobile.png",
      "sizes": "750x1334",
      "type": "image/png",
      "form_factor": "narrow"
    },
    {
      "src": "/static/screenshots/send-mobile.png",
      "sizes": "750x1334",
      "type": "image/png",
      "form_factor": "narrow"
    }
  ]
}
```

### 1.6 Display Mode Strategy

**Primary: `standalone`**
- required for the expected installed-PWA behavior
- sufficient for push-related entry flows

**Fallback: `minimal-ui`**
- acceptable fallback
- not a primary design objective

**iOS Quirk:**
- `standalone` not fully supported
- Use `standalone` anyway - iOS will handle gracefully

---

## 2. Mobile Notification Goals and Constraints

### 2.1 Goals

**Specific Goals:**

1. **Timely Delivery** - Notifications within 10 seconds of message send
2. **Battery Efficient** - Minimal battery impact when not in use
3. **User Control** - Granular notification permissions
4. **Cross-Platform** - iOS and Android support
5. **Graceful degradation** - fall back to open-tab notifications when push is unavailable

### 2.2 Constraints

**iOS Limitations:**
- Push notifications require PWA to be installed
- No background sync when app is closed
- Service workers limited to 30 seconds of background execution
- Web Push only available in iOS 16.4+
- Notifications only show when PWA was recently active

**Android Limitations:**
- Push notifications work reliably
- Background sync available
- Some OEMs restrict background execution
- Doze mode may delay notifications

**Browser Differences:**
- Safari: Limited notification support
- Chrome: Full support
- Firefox: Good support
- Samsung Internet: Partial support

### 2.3 User Permission Strategy

**When to Request Permission:**

**Timeline:**
1. **First Visit** - No permission request
2. **After Device Pairing** - Explain benefits, ask permission
3. **First Send** - "Want to be notified of replies?"

**Permission Request UI:**

```
┌─────────────────────────────────┐
│  🔔 Enable Notifications        │
│                                 │
│  Get notified when links and    │
│  text arrive on this device.    │
│                                 │
│  [Maybe Later]  [Enable]        │
└─────────────────────────────────┘
```

**Permission States:**

| State | Behavior |
|-------|----------|
| `granted` | Full notification support |
| `denied` | No notifications, show banner in app |
| `default` | Not asked yet, show education UI |

**Re-Request Strategy:**
- If denied, show "Notifications disabled" banner with link to settings
- Offer to re-request after 30 days
- Never auto-request after explicit denial

---

## 3. Web Push / Notification Support Strategy

### 3.1 Architecture Overview

```
┌──────────────┐     Push Message     ┌─────────────┐
│   LinkHop    │ ───────────────────→ │  Push Service│
│   Server     │                      │  (FCM/APNs) │
└──────────────┘                      └──────┬──────┘
                                             │
                                             │ Push
                                             ↓
                                      ┌─────────────┐
                                      │    Mobile   │
                                      │  (PWA/SW)   │
                                      └─────────────┘
```

### 3.2 Web Push Implementation

**Service Worker Push Handler:**

```javascript
// service-worker.js

self.addEventListener('push', event => {
  const data = event.data.json();
  
  event.waitUntil(
    self.registration.showNotification('LinkHop', {
      body: data.type === 'url' 
        ? `URL from ${data.sender}: ${data.body.substring(0, 50)}...`
        : `Message from ${data.sender}: "${data.body.substring(0, 50)}..."`,
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/badge-72.png',
      tag: data.message_id, // Prevent duplicates
      requireInteraction: data.type === 'text', // Text messages need action
      actions: [
        {
          action: 'open',
          title: data.type === 'url' ? 'Open Link' : 'View Message'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ],
      data: {
        messageId: data.message_id,
        url: data.body,
        type: data.type
      }
    })
  );
  
  // Record 'presented' event
  recordSignal(data.message_id, 'presented');
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const { messageId, url, type } = event.notification.data;
  
  if (event.action === 'open' || event.action === '') {
    // Record 'opened' event
    recordSignal(messageId, 'opened');
    
    if (type === 'url') {
      // Open URL in browser
      clients.openWindow(url);
    } else {
      // Open inbox
      clients.openWindow('/inbox');
    }
  }
  
  // 'dismiss' action just closes notification
});
```

### 3.3 Push Subscription Flow

**Step 1: Check Support**
```javascript
async function checkPushSupport() {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'No Service Worker support' };
  }
  
  if (!('PushManager' in window)) {
    return { supported: false, reason: 'No Push API support' };
  }
  
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  
  return {
    supported: true,
    subscribed: !!subscription
  };
}
```

**Step 2: Request Permission & Subscribe**
```javascript
async function subscribeToPush() {
  // Request notification permission
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission denied');
  }
  
  // Get push subscription
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  });
  
  // Send subscription to server
  await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${deviceToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(subscription)
  });
  
  return subscription;
}
```

The current server implementation also exposes `GET /api/push/config` so the client can fetch the public VAPID key before subscribing.

**Step 3: Server-Side Push Sending**

```python
# Django view when message is created
from webpush import send_user_notification

def send_push_notification(message, recipient_device):
    """Send Web Push notification to recipient device."""
    
    # Get push subscription
    subscription = recipient_device.push_subscription
    if not subscription:
        return  # Device hasn't subscribed to push
    
    payload = {
        'message_id': str(message.id),
        'type': message.type,
        'body': message.body,
        'sender': message.sender_device.name if message.sender_device else 'Unknown'
    }
    
    try:
        send_user_notification(
            user=recipient_device,
            payload=payload,
            ttl=3600  # 1 hour
        )
    except Exception as e:
        logger.error(f"Push notification failed: {e}")
        # Subscription may be invalid, remove it
        if 'InvalidSubscription' in str(e):
            recipient_device.push_subscription = None
            recipient_device.save()
```

### 3.4 Push Subscription Management

**Storage:**
- Store subscriptions in a dedicated `PushSubscription` model linked to a device
- Update subscription when it changes
- Remove subscription if push fails with invalid subscription error

**Re-subscription:**
- Re-subscribe on each PWA load (subscriptions can expire)
- Check subscription validity monthly
- Handle `pushsubscriptionchange` event in service worker

**Unsubscribe:**
- User can disable notifications in PWA settings
- Unsubscribe from push when user logs out
- Clean up subscription on device revocation

---

## 4. Mobile Send Flow Beyond HTTP Shortcuts

### 4.1 Share Target API

**What:** Allow system share sheet to send to LinkHop

**Configuration:**
```json
// manifest.json
{
  "share_target": {
    "action": "/send",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  }
}
```

**Flow:**
1. User in another app (e.g., Twitter, Chrome)
2. Tap Share → LinkHop appears in share sheet
3. LinkHop opens to `/send` with pre-filled URL/text
4. User selects recipient and sends

**Limitations:**
- Android Chrome: Full support
- iOS Safari: Limited support (no custom share targets in PWA)
- Only works when PWA is installed

### 4.2 Copy-Paste Detection

**Smart Paste Detection:**
```javascript
// Detect when user pastes a URL in send form
document.getElementById('body').addEventListener('paste', (e) => {
  const pasted = e.clipboardData.getData('text');
  
  if (isValidUrl(pasted) && currentType === 'text') {
    // Suggest switching to URL type
    showSuggestion('This looks like a URL. Send as URL instead?', () => {
      setType('url');
    });
  }
});
```

### 4.3 Mobile-Optimized Send Form

**Bottom Sheet Design:**
```
┌─────────────────────────────────┐
│         Drag Handle             │
├─────────────────────────────────┤
│ Send To                         │
│ ┌─────────────────────────────┐ │
│ │ 💻 Laptop        ✓          │ │
│ │ 📱 iPhone                   │ │
│ │ 📱 Android Tablet           │ │
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Type: [URL ▼]                   │
├─────────────────────────────────┤
│ https://example.com/article     │
├─────────────────────────────────┤
│        [ Send Link ]            │
└─────────────────────────────────┘
```

**Mobile Optimizations:**
- Large touch targets (min 44x44pt)
- Bottom sheet for device picker
- Swipe gestures to switch type
- Auto-focus on body field
- Show keyboard immediately

### 4.4 Quick Actions (iOS 3D Touch / Android App Shortcuts)

**Static Shortcut:**
```json
{
  "shortcuts": [
    {
      "name": "Send to Laptop",
      "short_name": "Send Laptop",
      "description": "Send clipboard to laptop",
      "url": "/send?recipient=laptop-uuid",
      "icons": [{ "src": "/static/icons/shortcut-laptop.png", "sizes": "96x96" }]
    }
  ]
}
```

**Note:** Limited browser support, mostly native apps.

### 4.5 Voice Input Support

**Integration:**
```html
<input type="text" x-webkit-speech speech>
```

**Use Cases:**
- Dictate text messages
- Voice URL input (less common)

**Fallback:** System keyboard voice input works automatically.

---

## 5. Mobile Receive/Inbox Flow

### 5.1 Mobile Inbox Layout

**Compact List View:**
```
┌─────────────────────────────────┐
│ ← Inbox              [Refresh] │
├─────────────────────────────────┤
│ 🔗 URL from Laptop     2m ago  │
│ https://example.com...         │
├─────────────────────────────────┤
│ 💬 Text from Phone    15m ago  │
│ "Check this out when..."       │
├─────────────────────────────────┤
│ 🔗 URL from iPad      1h ago   │
│ https://news.site/arti...      │
└─────────────────────────────────┘
```

**Swipe Actions:**
- Swipe right: Mark opened
- Swipe left: Delete (with confirmation)
- Long press: Multi-select

### 5.2 Message Detail Views

**URL Message:**
```
┌─────────────────────────────────┐
│ ← URL from Laptop      [Share] │
├─────────────────────────────────┤
│ https://example.com/article     │
│                                 │
│ Preview image (if available)    │
│ Page Title Here                 │
│ example.com                     │
│                                 │
│    [    Open in Browser    ]   │
│                                 │
│ Sent: Today, 2:30 PM            │
│ From: Laptop                    │
│ Status: Opened                  │
└─────────────────────────────────┘
```

**Text Message:**
```
┌─────────────────────────────────┐
│ ← Text from Phone      [Copy]  │
├─────────────────────────────────┤
│                                 │
│  This is the full text message  │
│  content. It can be multiple    │
│  lines and is displayed in a    │
│  clean, readable format.        │
│                                 │
├─────────────────────────────────┤
│ Sent: Today, 2:30 PM            │
│ From: Phone                     │
│ Status: Received                │
└─────────────────────────────────┘
```

### 5.3 Pull-to-Refresh

**Implementation:**
```javascript
let touchStartY = 0;

inboxElement.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
});

inboxElement.addEventListener('touchmove', (e) => {
  const touchY = e.touches[0].clientY;
  const diff = touchY - touchStartY;
  
  if (diff > 100 && inboxElement.scrollTop === 0) {
    showRefreshIndicator();
    if (diff > 150) {
      refreshInbox();
    }
  }
});
```

**Visual:**
- Pull down to reveal refresh spinner
- Threshold: 150px
- Auto-refresh on release past threshold

### 5.4 Empty States

**No Messages:**
```
┌─────────────────────────────────┐
│                                 │
│           📭                   │
│                                 │
│      Your inbox is empty       │
│                                 │
│   Send links from your other   │
│        devices to see          │
│         them here.             │
│                                 │
│      [   Learn How   ]         │
│                                 │
└─────────────────────────────────┘
```

**No Connection:**
```
┌─────────────────────────────────┐
│                                 │
│           📡                   │
│                                 │
│       You're offline            │
│                                 │
│   Messages will appear when     │
│      you're back online        │
│                                 │
└─────────────────────────────────┘
```

---

## 6. Mobile Click/Open Tracking

### 6.1 URL Opening

**Native App Handling:**
```javascript
function openUrl(url) {
  // Check if it's a deep link
  if (url.startsWith('mailto:')) {
    window.location.href = url; // Open mail app
  } else if (url.startsWith('tel:')) {
    window.location.href = url; // Open phone app
  } else {
    // Open in system browser
    window.open(url, '_system');
  }
  
  // Track open
  trackOpen(messageId);
}
```

**In-App Browser Decision:**
- **Open in system browser** (recommended)
  - Pros: Full browser features, user's preferred browser
  - Cons: Leaves LinkHop app
  
- **Open in-app** (optional future)
  - Pros: Stay in LinkHop, can add "back" button
  - Cons: Limited features, security concerns

**Decision:** Always use system browser for security and user preference.

### 6.2 Open Tracking

**API Call:**
```javascript
async function trackOpen(messageId) {
  try {
    await fetch(`/api/messages/${messageId}/opened`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deviceToken}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    // Queue for later if offline
    queueSignal(messageId, 'opened');
  }
}
```

**Optimistic UI:**
- Mark as opened immediately in UI
- API call happens in background
- Rollback on error

### 6.3 Share Sheet Integration

**Share Received Content:**
```javascript
// Share button on message detail
shareButton.addEventListener('click', async () => {
  if (navigator.share) {
    await navigator.share({
      title: 'Shared via LinkHop',
      text: message.type === 'text' ? message.body : '',
      url: message.type === 'url' ? message.body : window.location.href
    });
  } else {
    // Fallback: Copy to clipboard
    await navigator.clipboard.writeText(message.body);
    showToast('Copied to clipboard');
  }
});
```

---

## 7. Background/Reconnect Expectations on Mobile

### 7.1 Mobile Background Constraints

**iOS Safari:**
- Service worker suspended when PWA not active
- Maximum 30 seconds background execution after notification
- No background sync when PWA closed
- Push notifications wake PWA briefly

**Android Chrome:**
- Service worker runs more reliably
- Background sync available
- Push notifications wake PWA
- Doze mode may delay non-urgent tasks

### 7.2 Reconnect Strategy

**Visibility Change Handling:**
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // App came to foreground
    reconnectSSE();
    syncPendingSignals();
    refreshInbox();
  } else {
    // App went to background
    // SSE connection maintained but throttled
  }
});
```

**SSE Reconnection:**
```javascript
class MobileSSEManager {
  constructor() {
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.lastEventId = null;
  }
  
  connect() {
    const url = new URL('/api/events/stream', SERVER);
    if (this.lastEventId) {
      url.searchParams.set('last_event_id', this.lastEventId);
    }
    
    this.eventSource = new EventSource(url, {
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    });
    
    this.eventSource.onmessage = (e) => {
      this.lastEventId = e.lastEventId;
      this.reconnectAttempts = 0;
      handleMessage(JSON.parse(e.data));
    };
    
    this.eventSource.onerror = () => {
      this.eventSource.close();
      this.scheduleReconnect();
    };
  }
  
  scheduleReconnect() {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    setTimeout(() => this.connect(), delay);
  }
}
```

### 7.3 Background Sync

**Queue for Background Sync:**
```javascript
// Register sync when online
async function queueForSync(messageId, signal) {
  // Store in IndexedDB
  await db.signals.add({ messageId, signal, timestamp: Date.now() });
  
  // Request background sync
  if ('sync' in registration) {
    await registration.sync.register('send-signals');
  }
}

// Service worker handles sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'send-signals') {
    event.waitUntil(sendPendingSignals());
  }
});

async function sendPendingSignals() {
  const pending = await db.signals.toArray();
  
  for (const signal of pending) {
    try {
      await fetch(`/api/messages/${signal.messageId}/${signal.signal}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      await db.signals.delete(signal.id);
    } catch (e) {
      // Will retry on next sync
      break;
    }
  }
}
```

### 7.4 Battery Optimization

**Best Practices:**
1. **Close SSE when hidden for > 5 minutes**
2. **Reconnect immediately when visible**
3. **Batch signal sends**
4. **Don't poll - use push notifications**
5. **Minimize JavaScript execution in background**

**Connection State Machine:**
```
[FOREGROUND] ←→ [BACKGROUND_SHORT] ←→ [BACKGROUND_LONG]
     ↑                (0-5 min)           (> 5 min)
     │                      │                   │
   Active SSE          Active SSE         SSE Closed
   Full features       Throttled          Push only
```

---

## 8. PWA/Web Notification Priority Rules

### 8.1 Priority Hierarchy

**From Highest to Lowest:**

1. **Browser Extension** (if installed and active)
2. **PWA Native Notifications** (Web Push)
3. **Web App In-App Notifications** (when PWA is open)

### 8.2 Coordination Strategy

**Extension Priority (Same Browser):**
```
Extension installed? 
  → YES: Extension shows notification
  → NO: Continue to PWA check

PWA installed with push?
  → YES: PWA shows native notification
  → NO: Web app shows in-app notification (if open)
```

**Cross-Device Priority:**
```
Message sent to Device A
  ↓
All clients for Device A notified
  ↓
Each client decides who shows notification:
  - Browser extension wins on desktop browsers
  - PWA push wins on mobile
  - Web app shows in-app if no other handler
```

### 8.3 Avoiding Duplicates

**Extension-PWA Coordination (Same Device):**

```javascript
// Extension claims priority
if (extensionInstalled && extensionActive) {
  // Extension handles notification
  return;
}

// PWA checks if it should show
if (pwaInstalled && pushSubscription) {
  // PWA will receive push notification
  // Don't show in-app notification
  return;
}

// Fallback: Web app in-app notification
showInAppNotification();
```

**State Tracking:**
- Use `localStorage` for cross-tab coordination
- Use BroadcastChannel for real-time sync
- Track notification ID to prevent duplicates

### 8.4 Mobile-Specific Rules

**iOS:**
- Extension not available on iOS
- PWA push limited (iOS 16.4+)
- Default to PWA notifications if available
- Otherwise rely on in-app badge/count

**Android:**
- Extension available (Kiwi Browser, etc.)
- PWA push fully supported
- Extension takes priority if installed

---

## 9. PWA Testing Strategy

### 9.1 Testing Matrix

| Device | OS Version | Browser | PWA Support | Priority |
|--------|-----------|---------|-------------|----------|
| iPhone 14 | iOS 17 | Safari | Full | High |
| iPhone 12 | iOS 16 | Safari | Partial | High |
| Pixel 7 | Android 14 | Chrome | Full | High |
| Galaxy S23 | Android 14 | Samsung | Full | Medium |
| iPad Pro | iPadOS 17 | Safari | Full | Medium |

### 9.2 Manual Testing Checklist

**Installation:**
- [ ] Add to home screen works
- [ ] Icon appears correctly
- [ ] Launches in standalone mode
- [ ] Splash screen displays

**Functionality:**
- [ ] Send flow works
- [ ] Inbox loads
- [ ] URL opening works
- [ ] Text viewing works
- [ ] Pull-to-refresh works

**Notifications:**
- [ ] Permission request appears
- [ ] Push notifications received
- [ ] Notification actions work
- [ ] Badge updates correctly

**Offline:**
- [ ] App loads offline
- [ ] Send queues when offline
- [ ] Sync happens when back online
- [ ] Appropriate error messages

**Background:**
- [ ] Notifications received when app closed
- [ ] Reconnects when brought to foreground
- [ ] No duplicate notifications

### 9.3 Automated Testing

**PWA-Specific Tests:**
```javascript
// test/pwa.spec.js
describe('PWA', () => {
  test('manifest is valid', async () => {
    const manifest = await fetch('/manifest.json').then(r => r.json());
    expect(manifest.name).toBe('LinkHop');
    expect(manifest.icons).toHaveLength(8);
  });
  
  test('service worker registers', async () => {
    const registration = await navigator.serviceWorker.ready;
    expect(registration.active).toBeTruthy();
  });
  
  test('works offline', async () => {
    await page.setOfflineMode(true);
    await page.goto('/inbox');
    expect(await page.$eval('body', el => el.textContent))
      .toContain('offline');
  });
});
```

### 9.4 Performance Budgets

**Mobile Targets:**
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3.5s
- Lighthouse PWA Score: > 90
- Bundle Size: < 200KB (gzipped)

---

## 10. Implementation Roadmap

### Phase 1: Push-Ready PWA Shell (v2.0)

- [x] Web App Manifest
- [x] Service Worker registration
- [x] Service Worker static caching for shell assets
- [x] Icons required for installability
- [ ] Minimal install guidance where needed for push setup

### Phase 2: Push Notifications (v2.1)

- [x] Web Push API integration
- [x] Push subscription management per device
- [x] Server-side push delivery hook on message creation
- [x] Service worker push handler
- [x] Notification click actions
- [x] Notification dedupe against open-tab SSE/browser notifications

### Phase 3: Secondary Mobile Features (Later)

- [ ] Better install prompts
- [ ] Share Target API
- [ ] Badging API
- [ ] Offline form submission
- [ ] Background sync / background fetch
- [ ] Touch gestures and other mobile UI polish

---

## Appendix: File Structure

```
linkhop/
├── static/
│   ├── manifest.json
│   ├── service-worker.js
│   └── icons/
│       ├── icon-72.png
│       ├── icon-96.png
│       └── ...
├── templates/
│   ├── base.html (includes manifest link)
│   └── ...
└── docs/
    └── PWA_SPEC.md (this document)
```

---

**Document Status:** Draft v1.1.0
**Last Updated:** 2026-03-27
**Next Review:** Before PWA implementation
