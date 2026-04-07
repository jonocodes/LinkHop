const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const deviceName = document.getElementById("device-name");
const appUrlInput = document.getElementById("app-url");
const btnOpen = document.getElementById("btn-open");
const btnDisconnect = document.getElementById("btn-disconnect");
const btnReconnect = document.getElementById("btn-reconnect");

function updateUI(status) {
  // Status dot and text
  statusDot.className = "dot";
  if (!status.configured) {
    statusDot.classList.add("unconfigured");
    statusText.textContent = "No device linked";
  } else if (status.tab_open) {
    statusDot.classList.add("idle");
    statusText.textContent = "Tab is open — app is handling messages";
  } else if (status.watching) {
    statusDot.classList.add("watching");
    statusText.textContent = "Watching for messages";
  } else {
    statusDot.classList.add("disconnected");
    statusText.textContent = "Disconnected";
  }

  // Device name
  if (status.device_name) {
    deviceName.textContent = status.device_name;
    deviceName.hidden = false;
  } else {
    deviceName.hidden = true;
  }

  // App URL
  appUrlInput.value = status.app_url || "";

  // Buttons
  btnDisconnect.hidden = !status.configured;
  btnReconnect.hidden = status.configured;
}

function getStatus() {
  chrome.runtime.sendMessage({ type: "get_status" }, (status) => {
    if (status) updateUI(status);
  });
}

// --- Event listeners ---

btnOpen.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "open_app" });
  window.close();
});

btnDisconnect.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "disconnect" }, () => getStatus());
});

btnReconnect.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" });
  window.close();
});

let urlDebounce = null;
appUrlInput.addEventListener("input", () => {
  clearTimeout(urlDebounce);
  urlDebounce = setTimeout(() => {
    const url = appUrlInput.value.trim();
    if (url) {
      chrome.runtime.sendMessage({ type: "set_app_url", url });
    }
  }, 500);
});

// --- Init ---
getStatus();
