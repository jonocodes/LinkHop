/**
 * Notification support for LinkHop Lite PWA.
 *
 * Foreground: shows notifications via ServiceWorkerRegistration.showNotification()
 * Background: ntfy web push → service worker push event → showNotification
 */

export async function requestPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function hasPermission(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}

export async function showMessageNotification(
  fromName: string,
  bodyText: string,
  msgId?: string,
  url?: string,
): Promise<void> {
  if (!hasPermission()) return;

  const data: Record<string, string> = {};
  if (msgId) data.msg_id = msgId;
  if (url) data.url = url;
  const reg = await navigator.serviceWorker?.ready;
  if (reg) {
    await reg.showNotification(`LinkHop: ${fromName}`, {
      body: bodyText,
      icon: "/icon.svg",
      tag: "linkhop-msg",
      renotify: true,
      data,
      actions: [
        { action: "mark-viewed", title: "Mark as Read" },
        { action: "open", title: "Open" },
      ],
    });
  } else {
    new Notification(`LinkHop: ${fromName}`, {
      body: bodyText,
      icon: "/icon.svg",
      data,
    });
  }
}

/**
 * Subscribe to ntfy web push for a topic.
 * This enables background notifications even when the tab is closed.
 *
 * Requires:
 * - Service worker registered
 * - Notification permission granted
 * - ntfy server configured with VAPID keys (web push enabled)
 *
 * Fails gracefully if the server doesn't support web push.
 */
export async function subscribeWebPush(
  ntfyUrl: string,
  topic: string,
): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.pushManager) return false;

    // Get the server's VAPID public key from ntfy's web push info endpoint
    const infoRes = await fetch(`${ntfyUrl}/v1/webpush`);
    if (!infoRes.ok) return false;
    const info = await infoRes.json() as { public_key?: string };
    if (!info.public_key) return false;

    // Get or create a push subscription
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      const vapidKey = urlBase64ToUint8Array(info.public_key);
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey,
      });
    }

    // Register subscription with ntfy for this topic
    const res = await fetch(`${ntfyUrl}/${topic}/webpush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Unsubscribe from ntfy web push for a topic.
 */
export async function unsubscribeWebPush(
  ntfyUrl: string,
  topic: string,
): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg?.pushManager) return;

    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return;

    await fetch(`${ntfyUrl}/${topic}/webpush`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch {
    // Best effort
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
