(function () {
  'use strict';

  var CFG = window.EMOGA_ACCESS || {};
  var API = String(CFG.apiBase || '').replace(/\/+$/, '');

  var UNLOCK_ITEMS = ['thesis', 'presentation'];
  var REQUEST_ITEMS = ['thesis', 'presentation', 'both'];

  var $ = function (id) { return document.getElementById(id); };

  function setStatus(el, kind, message) {
    el.className = 'access-status is-visible is-' + kind;
    el.textContent = message;
  }

  function clearStatus(el) {
    el.className = 'access-status';
    el.textContent = '';
  }

  function setBusy(button, busy, busyLabel) {
    var label = button.querySelector('span:last-child');
    if (busy) {
      if (!button.dataset.idleLabel) button.dataset.idleLabel = label.textContent;
      label.textContent = busyLabel;
      button.setAttribute('disabled', 'disabled');
    } else {
      if (button.dataset.idleLabel) label.textContent = button.dataset.idleLabel;
      button.removeAttribute('disabled');
    }
  }

  function readJson(response) {
    return response.text().then(function (text) {
      if (!text) return {};
      try { return JSON.parse(text); } catch (e) { return {}; }
    });
  }

  function post(path, payload) {
    if (!API) {
      return Promise.reject(new Error('The access service is not configured yet.'));
    }
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;

    return fetch(API + path, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (timer) clearTimeout(timer);
      return readJson(response).then(function (body) {
        return { ok: response.ok, status: response.status, body: body };
      });
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  function describeFailure(result) {
    var body = result.body || {};
    if (body.error) return body.error;
    if (result.status === 429) return 'Too many attempts. Please wait a little and try again.';
    if (result.status === 400) return 'Please check the form and try again.';
    if (result.status === 401) return 'That password is not correct.';
    if (result.status >= 500) return 'The service is having trouble right now. Please try again shortly.';
    return 'Something went wrong. Please try again.';
  }

  function describeNetworkError(err) {
    if (err && err.name === 'AbortError') return 'The request timed out. Please try again.';
    if (err && err.message && /not configured/.test(err.message)) return err.message;
    return 'Could not reach the access service. Check your connection and try again.';
  }

  function preselectFromQuery() {
    var item;
    try {
      item = new URLSearchParams(window.location.search).get('item');
    } catch (e) {
      item = null;
    }
    if (!item) return;
    if (UNLOCK_ITEMS.indexOf(item) !== -1) $('unlock-item').value = item;
    if (REQUEST_ITEMS.indexOf(item) !== -1) $('request-item').value = item;
  }

  function initUnlock() {
    var form = $('unlock-form');
    var button = $('unlock-submit');
    var status = $('unlock-status');
    var ready = $('download-ready');
    var link = $('download-link');
    var passwordField = $('unlock-password');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(status);
      ready.className = 'download-ready';

      var item = $('unlock-item').value;
      var password = passwordField.value;

      if (UNLOCK_ITEMS.indexOf(item) === -1) {
        setStatus(status, 'error', 'Please choose a file.');
        return;
      }
      if (!password) {
        setStatus(status, 'error', 'Please enter the password.');
        passwordField.focus();
        return;
      }

      setBusy(button, true, 'Checking');

      post('/unlock', { item: item, password: password })
        .then(function (result) {
          setBusy(button, false);

          if (!result.ok || !result.body.token) {
            setStatus(status, 'error', describeFailure(result));
            passwordField.select();
            return;
          }

          passwordField.value = '';

          link.href = API + '/file?item=' + encodeURIComponent(item) +
                      '&token=' + encodeURIComponent(result.body.token);
          ready.className = 'download-ready is-visible';
          setStatus(status, 'success', 'Unlocked. Your link is ready below.');
          link.focus();
        })
        .catch(function (err) {
          setBusy(button, false);
          setStatus(status, 'error', describeNetworkError(err));
        });
    });
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function turnstileToken() {
    if (!CFG.turnstileSiteKey) return '';
    if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
      return window.turnstile.getResponse() || '';
    }
    return '';
  }

  function resetTurnstile() {
    if (window.turnstile && typeof window.turnstile.reset === 'function') {
      try { window.turnstile.reset(); } catch (e) { }
    }
  }

  function mountTurnstile() {
    if (!CFG.turnstileSiteKey) return;
    var slot = $('turnstile-slot');
    var widget = document.createElement('div');
    widget.className = 'cf-turnstile';
    widget.setAttribute('data-sitekey', CFG.turnstileSiteKey);
    widget.setAttribute('data-theme', 'auto');
    slot.appendChild(widget);

    var script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }

  function initRequest() {
    var form = $('request-form');
    var button = $('request-submit');
    var status = $('request-status');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      clearStatus(status);

      var item = $('request-item').value;
      var name = $('request-name').value.trim();
      var email = $('request-email').value.trim();
      var affiliation = $('request-affiliation').value.trim();
      var message = $('request-message').value.trim();
      var website = $('request-website').value;

      if (REQUEST_ITEMS.indexOf(item) === -1) {
        setStatus(status, 'error', 'Please choose what you need.');
        return;
      }
      if (name.length < 2) {
        setStatus(status, 'error', 'Please enter your name.');
        $('request-name').focus();
        return;
      }
      if (!looksLikeEmail(email)) {
        setStatus(status, 'error', 'Please enter a valid email address.');
        $('request-email').focus();
        return;
      }
      if (message.length < 10) {
        setStatus(status, 'error', 'Please say a little about why you need it.');
        $('request-message').focus();
        return;
      }

      var captcha = turnstileToken();
      if (CFG.turnstileSiteKey && !captcha) {
        setStatus(status, 'error', 'Please complete the verification check.');
        return;
      }

      setBusy(button, true, 'Sending');

      post('/request', {
        item: item,
        name: name,
        email: email,
        affiliation: affiliation,
        message: message,
        website: website,
        turnstileToken: captcha
      })
        .then(function (result) {
          setBusy(button, false);
          resetTurnstile();

          if (!result.ok) {
            setStatus(status, 'error', describeFailure(result));
            return;
          }

          form.reset();
          preselectFromQuery();
          setStatus(
            status,
            'success',
            'Request sent. You will get the password by email at ' + email + '.'
          );
        })
        .catch(function (err) {
          setBusy(button, false);
          resetTurnstile();
          setStatus(status, 'error', describeNetworkError(err));
        });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    preselectFromQuery();
    mountTurnstile();
    initUnlock();
    initRequest();
  });
})();
