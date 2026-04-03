(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) {
    return;
  }

  function registerSw() {
    navigator.serviceWorker.register('/service-worker.js').catch(
      function (error) {
        if (window.console && typeof window.console.warn === 'function') {
          window.console.warn(
            'LinkHop service worker registration failed.',
            error,
          );
        }
      },
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerSw);
  } else {
    registerSw();
  }
})();
