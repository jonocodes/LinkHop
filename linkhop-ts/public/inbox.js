(function (window) {
  'use strict';

  window.LinkHopInbox = {
    boot: function (config) {
      var token = config.token;
      var listEl = document.getElementById('message-list');
      var emptyEl = document.getElementById('empty-state');
      var currentFilter = 'all';
      var pushBar = document.getElementById('push-bar');
      var pushCopy = document.getElementById('push-copy');
      var pushBtn = document.getElementById('push-btn');
      var pushDisable = document.getElementById('push-disable');
      var pushTest = document.getElementById('push-test');
      var pushStatus = document.getElementById('push-status');

      function setPushStatusText(text, isError) {
        if (!text) {
          pushStatus.style.display = 'none';
          pushStatus.textContent = '';
          return;
        }
        pushStatus.style.display = '';
        pushStatus.style.color = isError ? '#9f1239' : '';
        pushStatus.textContent = text;
      }

      function renderPushState(state) {
        if (!state.supported && !state.hint) {
          pushBar.style.display = 'none';
          return;
        }
        pushBar.style.display = 'grid';
        pushBtn.disabled = false;
        if (!state.supported && state.hint) {
          pushCopy.textContent = state.hint;
          pushBtn.style.display = 'none';
          pushDisable.style.display = 'none';
          setPushStatusText('');
          return;
        }
        pushBtn.style.display = '';
        if (state.subscribed) {
          pushCopy.textContent = 'Push notifications are enabled.';
          pushBtn.textContent = 'Enabled';
          pushBtn.disabled = true;
          pushDisable.style.display = '';
          if (state.permission !== 'granted') {
            setPushStatusText('Browser permission is not granted.', true);
          }
          return;
        }
        pushDisable.style.display = 'none';
        pushBtn.textContent = 'Enable Push';
        if (state.permission === 'denied') {
          pushCopy.textContent = 'Browser notification permission is blocked.';
          setPushStatusText(
            'Allow notifications in browser settings, then try again.',
            true,
          );
          return;
        }
        pushCopy.textContent = 'Enable push notifications for this device?';
        setPushStatusText('');
      }

      function refreshPushState() {
        window.LinkHopPush.getState(renderPushState);
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
        return d.toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
      }

      function truncate(text, max) {
        if (!text) return '';
        return text.length > max ? text.slice(0, max - 1) + '...' : text;
      }

      function renderMessages(messages) {
        var filtered = messages.filter(function (m) {
          if (currentFilter === 'incoming') return m.direction === 'incoming';
          if (currentFilter === 'sent') return m.direction === 'sent';
          return true;
        });
        if (filtered.length === 0) {
          listEl.innerHTML = '';
          emptyEl.style.display = '';
          return;
        }
        emptyEl.style.display = 'none';
        var html = '<ul class="message-list">';
        filtered.forEach(function (msg) {
          var isUrl = msg.type === 'url';
          var dirLabel = msg.direction === 'sent' ? 'to' : 'from';
          var peerName = msg.direction === 'sent'
            ? (msg.recipient_name || 'device')
            : (msg.sender || 'unknown');
          var readClass = msg.read ? ' is-read' : '';
          var bodyDisplay = isUrl
            ? '<a href="' + escapeHtml(msg.body) +
              '" target="_blank" rel="noopener">' +
              escapeHtml(truncate(msg.body, 80)) + '</a>'
            : escapeHtml(truncate(msg.body, 120));
          var dirIcon = msg.direction === 'sent' ? '&uarr;' : '&darr;';
          html += '<li class="message-item' + readClass + '">' +
            '<div class="message-top">' +
            '<span class="message-body">' + dirIcon + ' ' + bodyDisplay +
            '</span>' +
            '<button data-delete="' + msg.id +
            '" class="quiet" type="button">&times;</button>' +
            '</div>' +
            '<div class="muted">' + dirLabel + ' <strong>' +
            escapeHtml(peerName) + '</strong> - ' +
            escapeHtml(formatDate(msg.created_at)) + '</div>' +
            '</li>';
        });
        html += '</ul>';
        listEl.innerHTML = html;
        listEl.querySelectorAll('[data-delete]').forEach(function (button) {
          button.addEventListener('click', function () {
            deleteMsg(button.getAttribute('data-delete'));
          });
        });
      }

      function loadAndRender() {
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
          emptyEl.style.display = '';
          emptyEl.textContent =
            'Service worker not ready. Refresh the page to try again.';
          return;
        }
        var channel = new MessageChannel();
        channel.port1.onmessage = function (e) {
          renderMessages(e.data.messages || []);
        };
        navigator.serviceWorker.controller.postMessage({
          type: 'linkhop_get_messages',
        }, [channel.port2]);
      }

      function deleteMsg(id) {
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'linkhop_delete_message',
            id: id,
          });
          setTimeout(loadAndRender, 100);
        }
      }

      document.getElementById('filter-all').addEventListener(
        'click',
        function () {
          currentFilter = 'all';
          loadAndRender();
        },
      );
      document.getElementById('filter-incoming').addEventListener(
        'click',
        function () {
          currentFilter = 'incoming';
          loadAndRender();
        },
      );
      document.getElementById('filter-sent').addEventListener(
        'click',
        function () {
          currentFilter = 'sent';
          loadAndRender();
        },
      );
      document.getElementById('btn-clear').addEventListener(
        'click',
        function () {
          if (!confirm('Clear all messages from this browser?')) return;
          if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: 'linkhop_clear_messages',
            });
            setTimeout(loadAndRender, 100);
          }
        },
      );

      if (window.LinkHopPush.isSupported()) {
        window.LinkHopPush.syncAuthToken(token);
        refreshPushState();
        window.LinkHopPush.syncSubscription(token, function (ok) {
          if (!ok) {
            setPushStatusText(
              'Push subscription needs to be re-saved. Click "Enable Push".',
              true,
            );
          }
        });
      }

      pushBtn.addEventListener('click', function () {
        pushBtn.disabled = true;
        pushBtn.textContent = 'Working...';
        setPushStatusText('');
        window.LinkHopPush.enable(token, function (ok, message) {
          if (ok) {
            setPushStatusText('Push enabled.');
            refreshPushState();
            return;
          }
          setPushStatusText(message || 'Push setup failed.', true);
          refreshPushState();
        });
      });

      pushDisable.addEventListener('click', function () {
        setPushStatusText('Disabling...');
        window.LinkHopPush.disable(token, function (ok) {
          setPushStatusText(ok ? '' : 'Failed to disable push.', !ok);
          refreshPushState();
        });
      });

      pushTest.addEventListener('click', function () {
        setPushStatusText('Sending test push...');
        fetch('/api/push/test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
          },
        })
          .then(function (response) {
            return response.json().catch(function () {
              return {};
            }).then(function (data) {
              return { ok: response.ok, data: data };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              setPushStatusText(result.data.error || 'Test push failed.', true);
              return;
            }
            setPushStatusText('Test push sent.');
          })
          .catch(function () {
            setPushStatusText('Test push failed.', true);
          });
      });

      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', function (e) {
          if (!e.data) return;
          if (e.data.type === 'linkhop_push_notified') loadAndRender();
          if (e.data.type === window.LinkHopPush.refreshEventName) {
            setPushStatusText('Push subscription changed. Refreshing...');
            window.LinkHopPush.enable(token, function (ok, message) {
              setPushStatusText(
                ok
                  ? 'Push subscription refreshed.'
                  : (message || 'Failed to refresh push.'),
                !ok,
              );
              refreshPushState();
            });
          }
        });
      }

      loadAndRender();
      window.addEventListener('pageshow', function (e) {
        if (e.persisted) loadAndRender();
      });
    },
  };
})(window);
