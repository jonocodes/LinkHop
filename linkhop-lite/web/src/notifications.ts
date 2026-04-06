/**
 * Notification support for LinkHop Lite PWA.
 *
 * Foreground: shows notifications via ServiceWorkerRegistration.showNotification()
 * Background: custom service worker handles push events from ntfy
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
): Promise<void> {
  if (!hasPermission()) return;

  const reg = await navigator.serviceWorker?.ready;
  if (reg) {
    // Use SW notification — works even when tab is in background
    await reg.showNotification(`LinkHop: ${fromName}`, {
      body: bodyText,
      icon: "/icon.svg",
      tag: "linkhop-msg",
      renotify: true,
    });
  } else {
    // Fallback to Notification API
    new Notification(`LinkHop: ${fromName}`, {
      body: bodyText,
      icon: "/icon.svg",
    });
  }
}
