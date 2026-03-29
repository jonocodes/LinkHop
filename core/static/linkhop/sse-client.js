/**
 * LinkHop SSE client
 *
 * Connects to the SSE stream, handles reconnect with exponential backoff,
 * and deduplicates message notifications by message_id.
 *
 * Usage:
 *
 *   var client = new LinkHopSSE({
 *     token: 'device_...',
 *     onMessage: function(messageId) { ... },  // called for each new message_id
 *     onConnect: function() { ... },            // called on each successful hello
 *     onDisconnect: function() { ... },         // called when connection drops
 *   });
 *
 *   client.close();  // stop and do not reconnect
 */
(function (window) {
  'use strict';

  var STREAM_URL = '/api/events/stream';
  var MIN_DELAY_MS = 1000;
  var MAX_DELAY_MS = 30000;

  function LinkHopSSE(options) {
    this._token = options.token;
    this._onMessage = options.onMessage || function () {};
    this._onConnect = options.onConnect || function () {};
    this._onDisconnect = options.onDisconnect || function () {};
    this._autoRespond = options.autoRespond || false;
    this._delay = MIN_DELAY_MS;
    this._stopped = false;
    this._seenIds = {};
    this._es = null;
    this._connect();
  }

  LinkHopSSE.prototype._url = function () {
    if (!this._token) return STREAM_URL;
    return STREAM_URL + '?token=' + encodeURIComponent(this._token);
  };

  LinkHopSSE.prototype._connect = function () {
    if (this._stopped) return;

    var self = this;
    var es = new EventSource(this._url());
    this._es = es;

    es.addEventListener('hello', function () {
      self._delay = MIN_DELAY_MS;
      self._onConnect();
    });

    es.addEventListener('message', function (e) {
      var data;
      try { data = JSON.parse(e.data); } catch (_) { return; }
      var mid = data.message_id;
      if (mid && !self._seenIds[mid]) {
        self._seenIds[mid] = true;
        self._onMessage(mid);
        if (self._autoRespond && self._token) {
          self._maybeAutoRespond(mid);
        }
      }
    });

    // 'ping' events are silently consumed — they just keep the connection alive.

    es.addEventListener('error', function () {
      es.close();
      self._es = null;
      self._onDisconnect();
      if (!self._stopped) {
        self._scheduleReconnect();
      }
    });
  };

  LinkHopSSE.prototype._scheduleReconnect = function () {
    var self = this;
    var delay = this._delay;
    this._delay = Math.min(this._delay * 2, MAX_DELAY_MS);
    setTimeout(function () { self._connect(); }, delay);
  };

  /**
   * Seed the deduplication cache with known IDs so they are never treated
   * as new arrivals. Call this in onConnect with the IDs already rendered
   * on the page to prevent spurious reloads.
   */
  LinkHopSSE.prototype.seedSeen = function (ids) {
    var self = this;
    ids.forEach(function (id) { self._seenIds[id] = true; });
  };

  LinkHopSSE.prototype._maybeAutoRespond = function (messageId) {
    var self = this;
    var headers = { 'Authorization': 'Bearer ' + self._token };
    fetch('/api/messages/' + encodeURIComponent(messageId), { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (msg) {
        if (!msg || msg.type !== 'text') return;
        if (msg.body.trim().toLowerCase() !== 'ping client') return;
        if (!msg.sender_device_id) return;
        fetch('/api/messages', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
          body: JSON.stringify({
            recipient_device_id: msg.sender_device_id,
            type: 'text',
            body: 'pong (client)',
          }),
        });
      });
  };

  LinkHopSSE.prototype.close = function () {
    this._stopped = true;
    if (this._es) {
      this._es.close();
      this._es = null;
    }
  };

  window.LinkHopSSE = LinkHopSSE;
})(window);
