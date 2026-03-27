# LinkHop Browser Extension Specification

## Version 1.0.0 - Draft

This document defines the specification for a LinkHop browser extension that enables seamless link and text sharing directly from the browser context.

---

## 1. Goals and Non-Goals

### 1.1 Goals

**Primary Goal:** Enable users to send URLs and selected text from their browser to any LinkHop-connected device with minimal friction.

**Specific Goals:**

1. **Speed**: Send current page URL in ≤ 3 clicks
2. **Convenience**: Context menu integration for right-click sharing
3. **Selection Support**: Share selected text/snippets, not just full URLs
4. **Device Targeting**: Quick selection of recipient device
5. **Offline Queueing**: Queue sends when offline, sync when reconnected
6. **Notification Handling**: Native browser notifications for incoming messages
7. **Quick Access**: Keyboard shortcuts for power users
8. **Visual Feedback**: Clear success/error indicators

### 1.2 Non-Goals

The extension will **NOT**:

1. Replace the web app inbox (extension is for send + quick receive only)
2. Support voice/image/file sharing (URLs and text only)
3. Work without a LinkHop account (requires device registration)
4. Sync browser history or bookmarks
5. Track user browsing behavior
6. Work in incognito/private mode (by default, optional opt-in)
7. Support multiple LinkHop servers simultaneously
8. Replace mobile apps (mobile uses HTTP Shortcuts or PWA)

### 1.3 Success Metrics

- Time to send: < 5 seconds from intent to completion
- User retention: > 60% of installed users active after 30 days
- Error rate: < 1% failed sends due to extension issues
- Support burden: < 5% of total support tickets

---

## 2. Device Identity and Linking

### 2.1 Linking Strategy

The extension **shares device identity** with the web app rather than creating a separate device registration.

**Why Shared Identity?**
- Single device token to manage
- Consistent device name across web + extension
- Unified message history and tracking
- Simpler mental model for users

### 2.2 Identity Linking Options

**Option A: Token Import (Recommended)**

```
User copies device token from web app → Pastes into extension
```

**Flow:**
1. User opens web app `/connect` page
2. Clicks "Copy Token" (masked, 30-second timeout)
3. Opens extension popup
4. Pastes token into "Link Device" field
5. Extension validates token with `/api/device/me`
6. Token stored in extension secure storage

**Pros:**
- Simple to implement
- Works across all browsers
- No additional server changes needed

**Cons:**
- Manual copy-paste step
- Token visible to user (but only temporarily)

**Option B: QR Code Scanning**

```
Web app displays QR code → Extension scans with camera
```

**Flow:**
1. User opens web app, clicks "Link Extension"
2. Web app displays QR code containing token
3. User opens extension, clicks "Scan QR"
4. Extension uses camera API to scan
5. Token extracted and validated

**Pros:**
- No typing/pasting
- Feels modern and seamless

**Cons:**
- Requires camera permission
- More complex implementation
- Not all browsers support camera in extensions

**Option C: OAuth-style Redirect**

```
Extension opens web app → User approves → Redirects back with token
```

**Flow:**
1. Extension popup opens with "Link Device" button
2. Opens `https://linkhop.example.com/extension/link`
3. User clicks "Approve Extension" in web app
4. Web app redirects to extension with token in URL hash
5. Extension captures token from redirect

**Pros:**
- Seamless user experience
- No manual token handling

**Cons:**
- Requires server changes for redirect handling
- Complex redirect flow
- Potential security considerations

**Decision: Implement Option A first, with Option B as future enhancement.**

### 2.3 Token Storage

**Storage Requirements:**
- Location: Browser extension `chrome.storage.local` API
- Encryption: None required (token is bearer token, not password)
- Backup: Sync across browser instances via `chrome.storage.sync` (optional)
- Lifetime: Until user unlinks or token is revoked

**Security:**
- Token never displayed in UI after initial link
- No export functionality
- Clear on extension uninstall
- Detect revocation and prompt re-link

---

## 3. Authentication and Bootstrap Flow

### 3.1 First-Time Setup

**Step 1: Extension Installation**
```
User installs extension from Chrome Web Store/Firefox Add-ons
```

**Step 2: Welcome Screen**
```
Extension popup shows:
- Welcome message
- "Get Started" button
- Brief explanation of LinkHop
- Link to web app for account creation
```

**Step 3: Device Linking**
```
(See Section 2.2 - Token Import flow)
```

**Step 4: Test Send**
```
After linking, extension suggests:
- "Send this page to yourself" test
- Opens current tab URL in send flow
```

### 3.2 Token Validation

**On Extension Load:**
```javascript
// Validate stored token
const response = await fetch(`${SERVER}/api/device/me`, {
  headers: { 'Authorization': `Bearer ${token}` }
});

if (response.status === 401) {
  // Token revoked or invalid
  showReLinkPrompt();
}
```

**On 401 Errors:**
- Clear token from storage
- Show "Session Expired" message
- Prompt user to re-link device

### 3.3 Bootstrap State Machine

```
[INSTALL] → [UNLINKED] → [LINKING] → [LINKED] → [ACTIVE]
              ↓              ↓           ↓
           Welcome      Validate      Ready
           Screen       Token

[LINKED] → [UNLINKED] (on 401 or user unlink)
```

---

## 4. Priority Behavior (Extension vs Web App)

### 4.1 Priority Rules

**Rule 1: Extension Wins for Notifications**

When both extension and web app are open:
- Extension handles native browser notifications
- Web app suppresses notifications (via BroadcastChannel API)
- Extension records `presented` event

**Implementation:**
```javascript
// Extension registers as notification handler
// Web app checks for extension presence
const extensionPresent = await checkExtensionPresence();
if (extensionPresent) {
  skipNotification();
}
```

**Rule 2: Active Tab Determines Priority**

If web app inbox tab is currently focused:
- Web app receives and displays messages
- Extension shows subtle badge update only
- Web app records `presented` event

If any other tab is focused:
- Extension shows notification
- Extension records `presented` event

**Rule 3: Extension Always Handles External Sends**

When sending from extension popup:
- Extension handles API call
- Records events
- Shows confirmation

Web app doesn't need to know about extension sends.

### 4.2 Coordination Mechanism

**BroadcastChannel API (for same-browser coordination):**

```javascript
// Shared channel name
const CHANNEL = 'linkhop-coordination';

// Extension announces presence
const channel = new BroadcastChannel(CHANNEL);
channel.postMessage({ type: 'EXTENSION_ACTIVE' });

// Web app listens
channel.onmessage = (event) => {
  if (event.data.type === 'EXTENSION_ACTIVE') {
    // Suppress notifications
    extensionActive = true;
  }
};
```

**Heartbeat:**
- Extension sends heartbeat every 30 seconds
- Web app considers extension inactive if no heartbeat for 60 seconds

### 4.3 Edge Cases

**Multiple Browser Windows:**
- Each window has its own web app tab
- Extension coordinates with all of them via BroadcastChannel
- Notification shown by extension if no focused inbox

**Extension Disabled/Removed:**
- Web app detects loss of heartbeat
- Resumes normal notification behavior
- Graceful fallback

**Incognito Mode:**
- Extension doesn't run in incognito (default browser behavior)
- Web app handles everything if opened in incognito

---

## 5. Send User Experience

### 5.1 Popup Interface

**Main Popup View:**

```
┌─────────────────────────────┐
│ LinkHop          [≡] [⚙️]  │
├─────────────────────────────┤
│ Send To: [Dropdown      ▼] │
├─────────────────────────────┤
│ [Icon] https://example.com  │
│       Page Title...         │
├─────────────────────────────┤
│ Type: (•) URL  ( ) Text    │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ https://example.com/    │ │
│ │ article/something       │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ [      Send Link      ]    │
└─────────────────────────────┘
```

**Components:**

1. **Recipient Dropdown**
   - Shows all active devices from `/api/devices`
   - Recently used devices at top
   - Device online/offline indicator
   - "Default" option (saves last choice)

2. **Content Preview**
   - Shows page title and URL
   - Favicon from current tab
   - Text preview if text mode selected

3. **Type Toggle**
   - URL: Send full page URL (default)
   - Text: Send selected text (if any)

4. **Send Button**
   - Shows loading state during send
   - Success: Checkmark + "Sent!"
   - Error: Red text with error message

### 5.2 Context Menu Integration

**Right-click menu items:**

```
LinkHop → Send Page to [Last Device]
          Send Page to → [Device A]
                         [Device B]
                         [Device C]
          ──────────────────────────
          Send Link to [Last Device]
          Send Selection to [Last Device]
```

**Contexts:**
- `page` - Click on page background
- `link` - Click on hyperlink
- `selection` - Text is selected

**Smart Defaults:**
- If text selected: Default to "Send Selection"
- If on link: Default to "Send Link" (the link URL, not page URL)
- Otherwise: "Send Page"

### 5.3 Keyboard Shortcuts

**Default Shortcuts:**

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+L` (Cmd+Shift+L) | Open extension popup |
| `Ctrl+Shift+S` (Cmd+Shift+S) | Quick send to default device |
| `Ctrl+Shift+D` (Cmd+Shift+D) | Open device selector popup |

**Customizable:**
- User can change shortcuts in browser settings
- Extension provides options page for customization

### 5.4 Send Flow

**Step-by-Step:**

1. **Capture Content**
   ```javascript
   // Get current tab info
   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
   const url = tab.url;
   const title = tab.title;
   ```

2. **Show Popup**
   - Pre-fill URL/title
   - Load device list
   - Restore last used device preference

3. **User Confirmation**
   - User selects device
   - User clicks "Send"

4. **API Call**
   ```javascript
   const response = await fetch(`${SERVER}/api/messages`, {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({
       recipient_device_id: selectedDeviceId,
       type: 'url',
       body: url
     })
   });
   ```

5. **Feedback**
   - Success: Show checkmark, close popup after 1 second
   - Error: Show error message, allow retry

6. **Analytics (Optional)**
   - Log send success/failure (local only)
   - Update "recent devices" list

### 5.5 Quick Send (No Popup)

**Behavior:**
- Uses last used device
- No popup, just badge notification
- `Ctrl+Shift+S` sends current page immediately

**Visual Feedback:**
- Badge shows "✓" briefly on success
- Badge shows "✗" on error
- Click badge to see error details

---

## 6. Receive User Experience

### 6.1 Notification Handling

**Notification Style:**
- Use browser native notifications (`chrome.notifications`)
- Icon: LinkHop logo
- Title: "New message from [Sender]"
- Message: URL or text preview (truncated)
- Buttons: [Open] [Dismiss]

**URL Message:**
```
┌──────────────────────────────────┐
│ 🔔 LinkHop                       │
├──────────────────────────────────┤
│ New URL from iPhone              │
│ https://example.com/article/...  │
├──────────────────────────────────┤
│ [   Open   ] [   Dismiss   ]    │
└──────────────────────────────────┘
```

**Text Message:**
```
┌──────────────────────────────────┐
│ 🔔 LinkHop                       │
├──────────────────────────────────┤
│ New text from Laptop             │
│ "Hey, check this out when you..."│
├──────────────────────────────────┤
│ [   View   ] [   Dismiss   ]    │
└──────────────────────────────────┘
```

### 6.2 Notification Actions

**Open Button:**
- URL: Open URL in new tab + track open
- Text: Open LinkHop web app inbox

**Dismiss Button:**
- Close notification
- Record `presented` event (if not already recorded)

**Click Notification Body:**
- Same as "Open" button

### 6.3 Inbox Handoff

**When user wants to see full inbox:**

Option 1: Click "View Inbox" in extension popup
- Opens web app `/inbox` in new tab
- Extension suppresses notifications while inbox is focused

Option 2: Right-click extension icon
- Context menu: "View Inbox"
- Opens inbox

Option 3: Badge click (if messages pending)
- Opens inbox instead of popup

### 6.4 Badge Indicators

**Badge shows pending message count:**
- `1`, `2`, `3`... `9+` for many messages
- Color: Blue for normal, Red for errors

**Badge tooltip:**
- Hover shows "3 pending messages"

**Badge click behavior:**
- If messages pending: Open inbox
- If no messages: Open popup

### 6.5 Message Lifecycle Tracking

**Extension records:**
1. `received` - When SSE message event received
2. `presented` - When notification shown
3. `opened` - When user clicks notification

**Web app records:**
- None when extension is handling notifications

**Coordination:**
- Extension marks messages as handled
- Web app skips handled messages

---

## 7. Signal Recording

### 7.1 Extension Responsibility

The extension is responsible for recording all lifecycle signals for messages it handles.

**Received Signal:**
```javascript
// When SSE message event received
await fetch(`${SERVER}/api/messages/${messageId}/received`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Presented Signal:**
```javascript
// When notification displayed
await fetch(`${SERVER}/api/messages/${messageId}/presented`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Opened Signal:**
```javascript
// When user clicks notification
await fetch(`${SERVER}/api/messages/${messageId}/opened`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// Then open the URL
chrome.tabs.create({ url: messageBody });
```

### 7.2 Batching and Optimization

**Challenge:** Don't spam API with individual requests for rapid events

**Solution:** Batch signals with debouncing

```javascript
// Queue signals
const signalQueue = [];

// Debounced flush
const flushSignals = debounce(async () => {
  if (signalQueue.length === 0) return;
  
  // Send individually (API limitation) but batched in time
  const signals = [...signalQueue];
  signalQueue.length = 0;
  
  for (const signal of signals) {
    await fetch(`${SERVER}/api/messages/${signal.messageId}/${signal.type}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
  }
}, 1000); // 1 second debounce

// Queue a signal
function queueSignal(messageId, type) {
  signalQueue.push({ messageId, type });
  flushSignals();
}
```

### 7.3 Offline Handling

**Queue signals when offline:**

```javascript
const offlineQueue = [];

async function recordSignal(messageId, type) {
  if (!navigator.onLine) {
    offlineQueue.push({ messageId, type, timestamp: Date.now() });
    return;
  }
  
  // Send normally
  await sendSignal(messageId, type);
}

// Flush offline queue when back online
window.addEventListener('online', async () => {
  while (offlineQueue.length > 0) {
    const signal = offlineQueue.shift();
    await sendSignal(signal.messageId, signal.type);
  }
});
```

---

## 8. Duplicate Notification Prevention

### 8.1 The Problem

Without coordination:
1. Message arrives via SSE
2. Extension shows notification
3. Web app shows notification
4. User gets 2 notifications for 1 message ❌

### 8.2 Solution: Leader Election

**Mechanism:**

1. **Extension Claims Leadership**
   ```javascript
   // When extension loads and is linked
   channel.postMessage({
     type: 'CLAIM_LEADERSHIP',
     timestamp: Date.now()
   });
   ```

2. **Web App Acknowledges**
   ```javascript
   channel.onmessage = (event) => {
     if (event.data.type === 'CLAIM_LEADERSHIP') {
       // Extension is handling notifications
       extensionLeader = true;
       suppressNotifications = true;
       
       // Acknowledge
       channel.postMessage({
         type: 'LEADERSHIP_ACK',
         timestamp: Date.now()
       });
     }
   };
   ```

3. **Heartbeat**
   - Extension sends heartbeat every 30s
   - Web app considers extension dead after 60s without heartbeat

4. **Graceful Handoff**
   - Extension unloads → sends `RESIGN_LEADERSHIP`
   - Web app resumes notification responsibility

### 8.3 State Tracking

**Message State Shared Between Extension and Web App:**

```javascript
// Use localStorage for cross-tab state (fallback)
const NOTIFICATION_STATE_KEY = 'linkhop_notification_state';

function markMessageNotified(messageId) {
  const state = JSON.parse(localStorage.getItem(NOTIFICATION_STATE_KEY) || '{}');
  state[messageId] = {
    notified: true,
    timestamp: Date.now(),
    by: 'extension' // or 'webapp'
  };
  localStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify(state));
  
  // Also broadcast to other contexts
  channel.postMessage({
    type: 'MESSAGE_NOTIFIED',
    messageId,
    timestamp: Date.now()
  });
}

function hasMessageBeenNotified(messageId) {
  const state = JSON.parse(localStorage.getItem(NOTIFICATION_STATE_KEY) || '{}');
  return state[messageId]?.notified || false;
}
```

### 8.4 Cleanup

**Remove old entries:**

```javascript
// Clean up entries older than 7 days
function cleanupNotificationState() {
  const state = JSON.parse(localStorage.getItem(NOTIFICATION_STATE_KEY) || '{}');
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  
  Object.keys(state).forEach(key => {
    if (now - state[key].timestamp > sevenDays) {
      delete state[key];
    }
  });
  
  localStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify(state));
}

// Run cleanup daily
setInterval(cleanupNotificationState, 24 * 60 * 60 * 1000);
```

---

## 9. Reconnect and Offline Behavior

### 9.1 SSE Connection Management

**Connection Lifecycle:**

```
[CONNECTING] → [OPEN] → [RECEIVING]
                  ↓
            [ERROR/CLOSED]
                  ↓
            [RECONNECTING] → (back to CONNECTING)
```

**Reconnect Strategy:**

```javascript
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 1000; // 1 second

function connectSSE() {
  const eventSource = new EventSource(`${SERVER}/api/events/stream`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  eventSource.onopen = () => {
    reconnectAttempts = 0;
    updateConnectionStatus('connected');
  };
  
  eventSource.onerror = () => {
    eventSource.close();
    handleReconnect();
  };
  
  return eventSource;
}

function handleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    updateConnectionStatus('failed');
    return;
  }
  
  // Exponential backoff with jitter
  const delay = Math.min(
    BASE_DELAY * Math.pow(2, reconnectAttempts) + Math.random() * 1000,
    30000 // Max 30 seconds
  );
  
  reconnectAttempts++;
  updateConnectionStatus('reconnecting', reconnectAttempts);
  
  setTimeout(connectSSE, delay);
}
```

### 9.2 Offline Queue

**Queue sends when offline:**

```javascript
const offlineSendQueue = [];

async function sendMessage(recipientId, type, body) {
  if (!navigator.onLine) {
    offlineSendQueue.push({
      recipientId,
      type,
      body,
      timestamp: Date.now()
    });
    
    showOfflineNotification();
    return { queued: true };
  }
  
  return await makeSendRequest(recipientId, type, body);
}

// Flush queue when back online
window.addEventListener('online', async () => {
  if (offlineSendQueue.length === 0) return;
  
  showFlushNotification(offlineSendQueue.length);
  
  while (offlineSendQueue.length > 0) {
    const item = offlineSendQueue.shift();
    await makeSendRequest(item.recipientId, item.type, item.body);
  }
  
  showFlushCompleteNotification();
});
```

### 9.3 Connection Status UI

**Badge States:**

| State | Badge | Tooltip |
|-------|-------|---------|
| Connected | Normal color | "Connected" |
| Reconnecting | Gray | "Reconnecting... (attempt 3/10)" |
| Offline | Red dot | "Offline - messages queued" |
| Failed | Red X | "Connection failed - click to retry" |

**Visual Indicators in Popup:**

```
┌─────────────────────────────┐
│ LinkHop          [≡] [⚙️]  │
├─────────────────────────────┤
│ 🟢 Connected                │
│                             │
│ Send To: ...                │
└─────────────────────────────┘
```

### 9.4 Message Sync on Reconnect

**Problem:** Missed messages while offline

**Solution:**

1. Track last message timestamp before disconnect
2. On reconnect, fetch messages since that timestamp
3. Show notifications for missed messages

```javascript
let lastMessageTimestamp = null;

// Before disconnect, save timestamp
function saveLastTimestamp() {
  chrome.storage.local.set({
    lastMessageTimestamp: lastMessageTimestamp || Date.now()
  });
}

// After reconnect, sync missed messages
async function syncMissedMessages() {
  const { lastMessageTimestamp } = await chrome.storage.local.get(
    'lastMessageTimestamp'
  );
  
  if (!lastMessageTimestamp) return;
  
  // Fetch messages since timestamp
  const response = await fetch(
    `${SERVER}/api/messages/incoming?since=${lastMessageTimestamp}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  
  const messages = await response.json();
  
  // Show notifications for missed messages
  messages.forEach(message => {
    showNotification(message);
  });
}
```

---

## 10. Testing Strategy

### 10.1 Test Levels

**Unit Tests (Jest):**

```javascript
// test/send.test.js
describe('Send Flow', () => {
  test('sends URL successfully', async () => {
    const result = await sendMessage('device-123', 'url', 'https://example.com');
    expect(result.success).toBe(true);
  });
  
  test('queues when offline', async () => {
    simulateOffline();
    const result = await sendMessage('device-123', 'url', 'https://example.com');
    expect(result.queued).toBe(true);
  });
});
```

**Integration Tests (Puppeteer/Playwright):**

```javascript
// test/extension-e2e.test.js
describe('Extension E2E', () => {
  test('popup opens and sends message', async () => {
    // Load extension
    await loadExtension();
    
    // Click extension icon
    await clickExtensionIcon();
    
    // Select device
    await selectDevice('Test Device');
    
    // Click send
    await clickSend();
    
    // Verify success
    await expectSuccessMessage();
  });
});
```

**Manual Testing Checklist:**

- [ ] Install on clean browser profile
- [ ] Link device with token
- [ ] Send page URL to device
- [ ] Send selected text to device
- [ ] Receive notification when message arrives
- [ ] Click notification opens URL
- [ ] Works offline (queues)
- [ ] Reconnects after network interruption
- [ ] No duplicate notifications with web app open
- [ ] Graceful handling of revoked token
- [ ] Context menu items work
- [ ] Keyboard shortcuts work
- [ ] Badge updates correctly
- [ ] Extension survives browser restart

### 10.2 Browser Compatibility

**Primary Targets:**

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | Latest 2 versions | Full |
| Firefox | Latest 2 versions | Full |
| Edge | Latest 2 versions | Full |
| Safari | 16+ | Partial (no context menu) |

**Manifest Versions:**
- Chrome: Manifest V3
- Firefox: Manifest V2 (V3 support coming)

**Feature Detection:**

```javascript
// Detect API availability
const hasNotifications = 'notifications' in chrome;
const hasContextMenus = 'contextMenus' in chrome;
const hasCommands = 'commands' in chrome;
```

### 10.3 Performance Tests

**Benchmarks:**

- Popup open time: < 100ms
- Send API call: < 500ms (with network)
- SSE connection: < 1s
- Reconnect after disconnect: < 3s
- Memory usage: < 50MB

**Load Testing:**

- 1000 messages in inbox
- 10 devices in list
- Rapid send (10 messages in 5 seconds)

### 10.4 Security Tests

**Test Cases:**

1. **Token Security**
   - Token not exposed in console
   - Token not in error messages
   - Token cleared on unlink

2. **XSS Prevention**
   - Page titles sanitized before display
   - URLs validated before sending
   - No innerHTML usage

3. **Origin Validation**
   - Only communicates with configured server
   - Validates server certificate

4. **Permission Tests**
   - Works with minimal permissions
   - Graceful degradation if permissions denied

### 10.5 CI/CD Integration

**GitHub Actions Workflow:**

```yaml
name: Extension Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm test
      
      - name: Build extension
        run: npm run build
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload build artifact
        uses: actions/upload-artifact@v3
        with:
          name: extension
          path: dist/
```

---

## 11. Implementation Roadmap

### Phase 1: MVP (v1.0)

- [x] Basic popup with send functionality
- [x] Token linking
- [x] URL sending
- [x] Device selection
- [x] Context menu (page only)
- [x] Basic notifications
- [x] Chrome/Edge support

### Phase 2: Enhanced (v1.1)

- [ ] Text selection sending
- [ ] Keyboard shortcuts
- [ ] Firefox support
- [ ] Quick send (no popup)
- [ ] Badge count
- [ ] Offline queueing

### Phase 3: Polish (v1.2)

- [ ] Duplicate notification prevention
- [ ] QR code linking
- [ ] Settings page
- [ ] Analytics opt-in
- [ ] Safari support

---

## 12. File Structure

```
extension/
├── manifest.json              # Extension manifest (V3)
├── manifest-v2.json           # Firefox manifest
├── src/
│   ├── background.js          # Service worker
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── content/
│   │   └── content.js         # Content script (if needed)
│   ├── options/
│   │   ├── options.html
│   │   └── options.js
│   └── shared/
│       ├── api.js             # API client
│       ├── storage.js         # Storage utilities
│       ├── sse.js             # SSE connection manager
│       └── notifications.js   # Notification handlers
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   └── icon-128.png
├── _locales/
│   └── en/
│       └── messages.json
├── tests/
│   ├── unit/
│   └── e2e/
├── package.json
└── README.md
```

---

## 13. Open Questions

1. Should we support sending to multiple devices at once?
2. Should we support scheduled/delayed sends?
3. How should we handle extremely long URLs (>2048 chars)?
4. Should we add read receipts (knowing if recipient opened)?
5. Should we support keyboard shortcuts for specific devices?
6. How do we handle corporate proxies/firewalls?
7. Should we add dark mode support in popup?

---

## Appendix A: API Endpoints Used

- `POST /api/devices/register` - Device registration (not used directly)
- `GET /api/devices` - List devices
- `GET /api/device/me` - Validate token
- `POST /api/messages` - Send message
- `POST /api/messages/{id}/received` - Mark received
- `POST /api/messages/{id}/presented` - Mark presented
- `POST /api/messages/{id}/opened` - Mark opened
- `GET /api/events/stream` - SSE stream

## Appendix B: Browser APIs Used

- `chrome.storage.local` / `browser.storage.local`
- `chrome.notifications` / `browser.notifications`
- `chrome.contextMenus` / `browser.menus`
- `chrome.commands` / `browser.commands`
- `chrome.tabs` / `browser.tabs`
- `chrome.action` / `browser.browserAction`
- `BroadcastChannel` (standard Web API)
- `EventSource` (standard Web API)

---

**Document Status:** Draft v1.0.0
**Last Updated:** 2026-03-26
**Next Review:** Before implementation start
