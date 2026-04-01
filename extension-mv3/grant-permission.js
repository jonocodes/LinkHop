document.getElementById("btn").addEventListener("click", async () => {
  const status = document.getElementById("status");
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    await chrome.runtime.sendMessage({ type: "register_push" });
    status.textContent = "✓ Notifications enabled! You can close this tab.";
    document.getElementById("btn").disabled = true;
  } else {
    status.textContent = "Permission was not granted. Check your browser notification settings.";
  }
});
