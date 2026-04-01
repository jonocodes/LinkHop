document.getElementById("btn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const btn = document.getElementById("btn");
  btn.disabled = true;
  try {
    status.textContent = "Requesting permission…";
    const permission = await Notification.requestPermission();
    status.textContent = `Permission: ${permission}`;
    if (permission !== "granted") {
      status.textContent = "Permission not granted. Check browser notification settings.";
      btn.disabled = false;
      return;
    }
    status.textContent = "Registering push subscription…";
    const reply = await chrome.runtime.sendMessage({ type: "register_push" });
    if (reply?.ok) {
      status.textContent = "✓ Notifications enabled! You can close this tab.";
    } else {
      status.textContent = "Push registration failed: " + (reply?.error || "unknown error");
      btn.disabled = false;
    }
  } catch (e) {
    status.textContent = "Error: " + e.message;
    btn.disabled = false;
  }
});
