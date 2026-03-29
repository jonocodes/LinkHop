(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/service-worker.js").catch(function (error) {
      if (window.console && typeof window.console.warn === "function") {
        window.console.warn("LinkHop service worker registration failed.", error);
      }
    });
  });
})();
