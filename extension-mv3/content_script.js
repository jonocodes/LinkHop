/**
 * Relays link messages from the web page to the extension background service worker.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "linkhop:connect_extension") return;
  chrome.runtime.sendMessage({ type: "session_link", ...event.data.payload });
});
