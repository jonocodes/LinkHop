(function (window) {
  'use strict';

  var API_BASE = '';
  var currentRoute = null;
  var deviceInfo = null;
  var deviceToken = null;

  async function apiRequest(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin'
    };
    if (deviceToken) {
      opts.headers['Authorization'] = 'Bearer ' + deviceToken;
    }
    if (body) opts.body = JSON.stringify(body);
    var res = await fetch(API_BASE + '/api' + path, opts);
    if (res.status === 401) {
      // Session missing → /login. Logged in but no device yet → activate (device routes 401).
      var me = await fetch(API_BASE + '/api/me', { credentials: 'same-origin' });
      window.location.href = me.ok ? '/account/activate-device' : '/login';
      return null;
    }
    return res;
  }

  async function checkAuth() {
    console.log('checkAuth: starting');
    var res = await fetch(API_BASE + '/api/me', { credentials: 'same-origin' });
    console.log('checkAuth: got response', res.status, res.ok);
    if (!res.ok) {
      console.log('checkAuth: redirecting to /login');
      window.location.href = '/login';
      return false;
    }
    return true;
  }

  async function loadDeviceInfo() {
    if (deviceInfo) return deviceInfo;
    var res = await apiRequest('GET', '/device/me');
    if (!res) return null;
    deviceInfo = await res.json();
    // Device cookie is httpOnly — expose token for SW / Bearer via session-bound endpoint.
    var linkRes = await fetch(API_BASE + '/api/session/link', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (linkRes.ok) {
      var linkBody = await linkRes.json();
      deviceToken = linkBody.token || null;
    }
    return deviceInfo;
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function truncate(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max - 1) + '...' : text;
  }

  function setHeading(text) {
    document.getElementById('page-heading').textContent = text;
  }

  function setActiveNav(route) {
    document.querySelectorAll('#main-nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === route);
    });
  }

  function showFlash(msg, isError) {
    var el = document.getElementById('flash-message');
    if (!msg) {
      el.style.display = 'none';
      return;
    }
    el.textContent = msg;
    el.style.color = isError ? '#9f1239' : '';
    el.style.display = '';
  }

  function getContentEl() {
    return document.getElementById('app-content');
  }

  // Views
  var views = {};

  views.inbox = {
    render: function () {
      console.log('inbox.render: starting');
      try {
        setHeading('Inbox');
        setActiveNav('inbox');
        getContentEl().innerHTML = `
          <p id="device-info">Loading...</p>
          <div id="push-bar" class="stack" style="display:none">
            <div class="row">
              <span id="push-copy">Enable push notifications for this device?</span>
              <button id="push-btn" type="button">Enable Push</button>
              <button id="push-disable" type="button" class="quiet" style="display:none">Disable</button>
              <button id="push-test" type="button" class="quiet">Test Push</button>
            </div>
            <div id="push-status" class="muted" style="display:none"></div>
          </div>
          <div class="row">
            <button id="filter-all" type="button">All</button>
            <button id="filter-incoming" type="button">Incoming</button>
            <button id="filter-sent" type="button">Sent</button>
            <button id="btn-clear" type="button" class="quiet">Clear all</button>
          </div>
          <div id="message-list"></div>
          <p id="empty-state" class="muted" style="display:none">No messages yet.</p>
        `;
        loadDeviceInfo().then(function (device) {
          console.log('inbox.render: device loaded', device);
          if (device) {
            document.getElementById('device-info').innerHTML = 'Current device: <strong>' + escapeHtml(device.name) + '</strong>';
            window.LinkHopInbox.boot({
              token: deviceToken,
              deviceId: device.id,
              deviceName: device.name,
            });
          }
        }).catch(function (err) {
          console.error('inbox.render: loadDeviceInfo error', err);
        });
        console.log('inbox.render: done');
      } catch (err) {
        console.error('inbox.render: error', err);
      }
    },
  };

  views.send = {
    render: async function () {
      setHeading('Send');
      setActiveNav('send');
      var devicesRes = await apiRequest('GET', '/devices');
      if (!devicesRes) return;
      var devicePayload = await devicesRes.json();
      var devices = devicePayload.devices || [];
      var allowSelfSend = devicePayload.allow_self_send === true;
      var currentDevice = await loadDeviceInfo();
      var selfId = currentDevice && currentDevice.id;
      var options = devices
        .filter(function (d) {
          return allowSelfSend || !selfId || d.id !== selfId;
        })
        .map(function (d) { return '<option value="' + d.id + '">' + escapeHtml(d.name) + '</option>'; })
        .join('');

      getContentEl().innerHTML = `
        <form id="send-form">
          <label>Recipient
            <select name="to" required>
              ${options || '<option value="">No other devices</option>'}
            </select>
          </label>
          <label>Type
            <select name="type">
              <option value="url">URL</option>
              <option value="text">Text</option>
            </select>
          </label>
          <label>Body <textarea name="body" rows="6" required></textarea></label>
          <button type="submit">Send</button>
        </form>
        <p id="send-status" class="muted" style="display:none"></p>
      `;
      this.attachEvents(currentDevice);
    },
    attachEvents: function (currentDevice) {
      var form = document.getElementById('send-form');
      var status = document.getElementById('send-status');
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        status.style.display = '';
        status.textContent = 'Sending...';
        var fd = new FormData(form);
        var payload = {
          recipient_device_id: fd.get('to'),
          type: fd.get('type'),
          body: fd.get('body')
        };
        var res = await apiRequest('POST', '/messages', payload);
        if (res && res.ok) {
          var data = await res.json().catch(function () { return {}; });
          form.reset();
          status.textContent = data.push_delivered ? 'Sent!' : 'Queued for delivery';
        } else {
          var err = res ? await res.json().catch(function () { return {}; }) : {};
          status.textContent = err.error || 'Send failed';
          status.style.color = '#9f1239';
        }
      });
    }
  };

  views.devices = {
    render: async function () {
      setHeading('Devices');
      setActiveNav('devices');
      var res = await apiRequest('GET', '/devices');
      if (!res) return;
      var devices = (await res.json()).devices || [];
      var html = devices.length === 0
        ? '<p>No devices registered.</p>'
        : '<table><thead><tr><th>Name</th><th>Type</th><th>Browser</th><th>OS</th><th>Last seen</th></tr></thead><tbody>' +
          devices.map(function (d) {
            return '<tr><td>' + escapeHtml(d.name) + '</td><td>' + escapeHtml(d.device_type) + '</td><td>' + escapeHtml(d.browser || '—') + '</td><td>' + escapeHtml(d.os || '—') + '</td><td>' + escapeHtml(d.last_seen_at || 'Never') + '</td></tr>';
          }).join('') + '</tbody></table>';
      getContentEl().innerHTML = html + '<p><a href="/account/activate-device">Register this browser</a></p>';
    }
  };

  views.settings = {
    render: async function () {
      setHeading('Settings');
      setActiveNav('settings');
      var res = await apiRequest('GET', '/push/config');
      var config = res ? await res.json() : {};
      getContentEl().innerHTML = `
        <dl>
          <dt>VAPID supported</dt>
          <dd>${config.supported ? 'Yes' : 'No'}</dd>
          <dt>Public key</dt>
          <dd><code>${config.vapid_public_key ? escapeHtml(config.vapid_public_key.slice(0, 30)) + '...' : 'N/A'}</code></dd>
        </dl>
        <p>Password change coming soon.</p>
      `;
    }
  };

  // Router
  function navigate(path) {
    console.log('navigate: path =', path);
    var route = path.replace('/account/', '').split('?')[0] || 'inbox';
    console.log('navigate: route =', route);
    if (views[route]) {
      currentRoute = route;
      views[route].render();
    } else {
      console.log('navigate: unknown route, redirecting to /account/inbox');
      window.location.href = '/account/inbox';
    }
  }

  function init() {
    console.log('init: starting');
    // Check auth then load initial route
    checkAuth().then(function (ok) {
      console.log('init: checkAuth result =', ok);
      if (ok) {
        console.log('init: calling navigate');
        navigate(window.location.pathname);
      }
    });

    // Handle nav clicks
    document.querySelectorAll('#main-nav a[data-route]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var route = a.getAttribute('data-route');
        window.history.pushState({}, '', '/account/' + route);
        navigate('/account/' + route);
      });
    });

    // Handle browser back/forward
    window.addEventListener('popstate', function () {
      navigate(window.location.pathname);
    });
  }

  // Boot when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
