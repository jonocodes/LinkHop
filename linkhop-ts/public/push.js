(function (window) {
  'use strict';

  var REFRESH_EVENT = 'linkhop_push_refresh_required';

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = window.atob(base64);
    var outputArray = new Uint8Array(rawData.length);

    for (var i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  function postJson(url, token, method, payload) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    return fetch(url, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
  }

  function getRegistration() {
    return navigator.serviceWorker.ready;
  }

  /** Idempotent; ensures Enable Push is not blocked waiting for `window.load`. */
  function ensureServiceWorkerRegistered() {
    return navigator.serviceWorker.register('/service-worker.js');
  }

  function postAuthMessage(token) {
    if (!token) return Promise.resolve();
    return getRegistration().then(function (registration) {
      var worker = registration.active || registration.waiting ||
        registration.installing;
      if (!worker) return;
      worker.postMessage({
        type: 'linkhop_push_auth',
        token: token,
      });
    });
  }

  function getSubscription() {
    return getRegistration().then(function (registration) {
      return registration.pushManager.getSubscription();
    });
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isSafari() {
    return /Safari/.test(navigator.userAgent) &&
      !/Chrome|Chromium|Firefox|Edg|OPR|Opera/.test(navigator.userAgent);
  }

  window.LinkHopPush = {
    refreshEventName: REFRESH_EVENT,

    isSupported: function () {
      return 'serviceWorker' in navigator && 'PushManager' in window &&
        'Notification' in window;
    },

    isStandalone: function () {
      if (navigator.standalone === true) return true;
      return window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches;
    },

    isIOS: isIOS,
    isSafari: isSafari,

    getPushHint: function () {
      if (this.isSupported()) return '';

      if (isIOS() && !this.isStandalone()) {
        return 'On iOS, push notifications require installing LinkHop to your home screen.';
      }

      if (isSafari() && !this.isStandalone()) {
        return 'On Safari, push works best when LinkHop is installed as an app.';
      }

      return 'Push notifications are not supported in this browser.';
    },

    getState: function (callback) {
      callback = callback || function () {};

      if (!this.isSupported()) {
        callback({
          supported: false,
          standalone: this.isStandalone(),
          permission: 'unsupported',
          subscribed: false,
          hint: this.getPushHint(),
        });
        return;
      }

      var self = this;
      getSubscription()
        .then(function (subscription) {
          callback({
            supported: true,
            standalone: self.isStandalone(),
            permission: Notification.permission,
            subscribed: !!subscription,
            hint: '',
          });
        })
        .catch(function () {
          callback({
            supported: true,
            standalone: self.isStandalone(),
            permission: Notification.permission,
            subscribed: false,
            hint: '',
          });
        });
    },

    enable: function (token, callback) {
      callback = callback || function () {};

      if (!this.isSupported()) {
        callback(
          false,
          this.getPushHint() || 'Push is not supported on this device.',
        );
        return;
      }

      if (
        typeof window.isSecureContext !== 'undefined' &&
        !window.isSecureContext
      ) {
        callback(
          false,
          'Web Push needs a secure context (HTTPS or http://localhost). Try opening http://127.0.0.1:8000 on this machine.',
        );
        return;
      }

      // Permission must run in the user-gesture window. If we fetch /api/push/config
      // first, Chromium treats the gesture as stale and requestPermission() never
      // completes properly from the click handler.
      var permPromise;
      if (Notification.permission === 'granted') {
        permPromise = Promise.resolve('granted');
      } else {
        var permAsk = Notification.requestPermission();
        var permTimeout = new Promise(function (_, reject) {
          window.setTimeout(function () {
            reject(
              new Error(
                'Notification permission did not finish (no prompt?). Use Chrome/Firefox in a normal window on http://127.0.0.1:8000 — not an IDE embedded browser.',
              ),
            );
          }, 45000);
        });
        permPromise = Promise.race([permAsk, permTimeout]);
      }

      permPromise
        .then(function (permission) {
          if (permission !== 'granted') {
            callback(false, 'Notification permission was not granted.');
            return;
          }
          return fetch('/api/push/config', {
            credentials: 'same-origin',
            headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          })
            .then(function (response) {
              return response.ok ? response.json() : null;
            })
            .then(function (config) {
              if (!config || !config.supported || !config.vapid_public_key) {
                callback(false, 'Push is not configured on the server.');
                return;
              }
              return ensureServiceWorkerRegistered()
                .then(function () {
                  return navigator.serviceWorker.ready;
                })
                .then(function (registration) {
                  return new Promise(function (resolve) {
                    window.setTimeout(function () {
                      postAuthMessage(token)
                        .then(function () {
                          resolve(registration);
                        })
                        .catch(function () {
                          resolve(registration);
                        });
                    }, 50);
                  });
                })
                .then(function (registration) {
                  return registration.pushManager.getSubscription()
                    .then(function (existing) {
                      if (existing) return existing;
                      return registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(
                          config.vapid_public_key,
                        ),
                      });
                    });
                })
                .then(function (subscription) {
                  if (!subscription) {
                    callback(
                      false,
                      'Could not create a push subscription (browser blocked or unsupported).',
                    );
                    return;
                  }
                  var payload = Object.assign({}, subscription.toJSON(), {
                    client_type: window.LinkHopPush.isStandalone()
                      ? 'pwa'
                      : 'browser',
                  });
                  return postJson(
                    '/api/push/subscriptions',
                    token,
                    'POST',
                    payload,
                  ).then(function (response) {
                    callback(
                      response.status === 204,
                      response.status === 204
                        ? ''
                        : 'Failed to save push subscription.',
                    );
                  });
                });
            });
        })
        .catch(function (err) {
          var msg = err && err.message
            ? String(err.message)
            : String(err || 'Failed to enable push notifications.');
          callback(false, msg);
        });
    },

    disable: function (token, callback) {
      callback = callback || function () {};

      if (!('serviceWorker' in navigator)) {
        callback(true);
        return;
      }

      getSubscription()
        .then(function (subscription) {
          if (!subscription) {
            callback(true);
            return null;
          }

          return postJson('/api/push/subscriptions', token, 'DELETE', {
            endpoint: subscription.endpoint,
          })
            .then(function () {
              return subscription.unsubscribe();
            })
            .then(function () {
              callback(true);
            });
        })
        .catch(function () {
          callback(false);
        });
    },

    syncAuthToken: function (token) {
      if (!('serviceWorker' in navigator)) {
        return;
      }

      postAuthMessage(token);
    },

    syncSubscription: function (token, callback) {
      callback = callback || function () {};

      if (!this.isSupported()) {
        callback(false);
        return;
      }

      getSubscription()
        .then(function (subscription) {
          if (!subscription) {
            callback(false);
            return;
          }

          var payload = Object.assign({}, subscription.toJSON(), {
            client_type: window.LinkHopPush.isStandalone() ? 'pwa' : 'browser',
          });
          return postJson('/api/push/subscriptions', token, 'POST', payload)
            .then(function (response) {
              callback(response.status === 204);
            });
        })
        .catch(function () {
          callback(false);
        });
    },
  };
})(window);
