/**
 * Relays link messages from the web page to the extension background script.
 * The web page posts a window message; this script forwards it via runtime.sendMessage.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== "linkhop:connect_extension") return;
  browser.runtime.sendMessage({ type: "session_link", ...event.data.payload });
});
