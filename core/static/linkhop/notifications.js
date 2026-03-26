/**
 * LinkHop browser notifications
 *
 * Shows a browser Notification for each incoming message when the page is
 * not visible. Uses BroadcastChannel to avoid duplicate notifications
 * across multiple open tabs.
 *
 * Priority note: a browser extension connecting the same device should be
 * treated as higher priority for notification delivery. If an extension is
 * present and active for this device, it should suppress web-app notifications
 * by broadcasting 'suppress' messages on the 'linkhop_notifications' channel.
 * The web app will skip showing notifications while suppressed.
 *
 * Usage:
 *
 *   LinkHopNotifications.requestPermission(function(granted) { ... });
 *
 *   LinkHopNotifications.fetchAndNotify(token);
 *   // Fetches /api/messages/incoming, shows a notification for each new
 *   // message, and records 'presented' for each notification shown.
 */
(function (window) {
  'use strict';

  // --- Cross-tab coordination ---

  var _notifiedIds = {};
  var _suppressed = false;
  var _channel = null;

  if (typeof BroadcastChannel !== 'undefined') {
    _channel = new BroadcastChannel('linkhop_notifications');
    _channel.onmessage = function (e) {
      if (!e.data) return;
      if (e.data.type === 'notified') {
        _notifiedIds[e.data.messageId] = true;
      }
      // An extension (or another tab acting as leader) can broadcast
      // 'suppress' to prevent the web app from duplicating notifications.
      if (e.data.type === 'suppress') {
        _suppressed = true;
      }
      if (e.data.type === 'unsuppress') {
        _suppressed = false;
      }
    };
  }

  function _markNotified(messageId) {
    _notifiedIds[messageId] = true;
    if (_channel) {
      _channel.postMessage({ type: 'notified', messageId: messageId });
    }
  }

  // --- Notification display ---

  function _show(message) {
    if (_suppressed) return;
    if (_notifiedIds[message.id]) return;

    _markNotified(message.id);

    var isUrl = message.type === 'url';
    var title = isUrl ? 'New link' : 'New message';
    var bodyText = message.body.length > 100
      ? message.body.slice(0, 97) + '\u2026'
      : message.body;
    var href = isUrl
      ? '/messages/' + message.id + '/open'
      : '/messages/' + message.id;

    var n = new Notification(title, {
      body: bodyText,
      tag: 'linkhop-' + message.id,
    });

    n.onclick = function () {
      window.focus();
      window.location.href = href;
      n.close();
    };
  }

  // --- API helpers ---

  function _recordPresented(token, messageId) {
    fetch('/api/messages/' + messageId + '/presented', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    }).catch(function () {});
  }

  // --- Public API ---

  window.LinkHopNotifications = {
    /**
     * Request notification permission. Calls back with true if granted.
     * Safe to call repeatedly; no-ops if already granted or denied.
     */
    requestPermission: function (callback) {
      if (!('Notification' in window)) { callback(false); return; }
      if (Notification.permission === 'granted') { callback(true); return; }
      if (Notification.permission === 'denied') { callback(false); return; }
      Notification.requestPermission().then(function (p) {
        callback(p === 'granted');
      });
    },

    /**
     * Fetch /api/messages/incoming and show a notification for each
     * message not yet notified. Records 'presented' for each shown.
     */
    fetchAndNotify: function (token) {
      if (!('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;

      fetch('/api/messages/incoming', {
        headers: { 'Authorization': 'Bearer ' + token },
      })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (messages) {
          messages.forEach(function (message) {
            if (!_notifiedIds[message.id]) {
              _show(message);
              _recordPresented(token, message.id);
            }
          });
        })
        .catch(function () {});
    },

    hasPermission: function () {
      return typeof Notification !== 'undefined' &&
             Notification.permission === 'granted';
    },

    isSupported: function () {
      return 'Notification' in window;
    },
  };
})(window);
