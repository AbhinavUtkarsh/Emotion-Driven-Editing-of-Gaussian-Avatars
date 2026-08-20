
const ITEMS = {
  thesis: {
    key: 'thesis.pdf',
    filename: 'Emotion-Driven Editing of Gaussian Avatars.pdf',
    contentType: 'application/pdf',
    label: 'Thesis (PDF)'
  },
  presentation: {
    key: 'presentation.pptx',
    filename: 'EMO-GA Thesis Presentation.pptx',
    contentType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'Presentation (PPTX)'
  }
};

const REQUESTABLE = { thesis: 1, presentation: 1, both: 1 };

const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_VERSION = 'v1';


const encoder = new TextEncoder();

function b64urlEncode(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '==='.slice((padded.length + 3) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    return null;
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function positiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}


function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).indexOf(origin) !== -1) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function json(body, status, request, env, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      },
      corsHeaders(request, env),
      extraHeaders || {}
    )
  });
}


async function readJsonBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(type)) return null;

  const declared = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;

  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) return null;

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer));
  } catch (e) {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed;
}

function field(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  if (value.length > 200) return false;
  if (/[\r\n\t<>,;"\\]/.test(value)) return false;   return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  );
}

async function ipKey(prefix, request, env) {
  const material = clientIp(request) + '|' + (env.TOKEN_SECRET || '');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(material));
  return prefix + ':' + bytesToHex(digest).slice(0, 32);
}

async function underLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return true;
  try {
    const { success } = await binding.limit({ key: key });
    return success;
  } catch (e) {
    return true;
  }
}

const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_WINDOW_SECONDS = 900;

async function failureCount(env, key) {
  if (!env.RATE) return 0;
  try {
    const raw = await env.RATE.get(key);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch (e) {
    return 0;
  }
}

async function recordFailure(env, key) {
  if (!env.RATE) return;
  try {
    const next = (await failureCount(env, key)) + 1;
    await env.RATE.put(key, String(next), {
      expirationTtl: LOCKOUT_WINDOW_SECONDS
    });
  } catch (e) {
      }
}

async function clearFailures(env, key) {
  if (!env.RATE) return;
  try {
    await env.RATE.delete(key);
  } catch (e) {
      }
}


async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function signToken(env, item, ttlSeconds) {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const nonce = b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));
  const payload = [TOKEN_VERSION, item, String(expiresAt), nonce].join('.');
  const key = await hmacKey(env.TOKEN_SECRET);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return payload + '.' + b64urlEncode(signature);
}

async function verifyToken(env, token, expectedItem) {
  if (typeof token !== 'string' || token.length > 512) return false;

  const parts = token.split('.');
  if (parts.length !== 5) return false;

  const [version, item, expiresAt, , signature] = parts;
  if (version !== TOKEN_VERSION) return false;

  const payload = parts.slice(0, 4).join('.');
  let provided;
  try {
    provided = b64urlDecode(signature);
  } catch (e) {
    return false;
  }

  const key = await hmacKey(env.TOKEN_SECRET);
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  );
  if (!timingSafeEqual(provided, expected)) return false;

  const expiry = parseInt(expiresAt, 10);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;

  return item === expectedItem;
}


function credentialsFor(env, item) {
  const suffix = item.toUpperCase();
  return {
    hash: env['PASSWORD_HASH_' + suffix] || env.PASSWORD_HASH,
    salt: env['PASSWORD_SALT_' + suffix] || env.PASSWORD_SALT
  };
}

async function passwordMatches(env, item, password) {
  const { hash, salt } = credentialsFor(env, item);
  const expected = hexToBytes(hash);
  const saltBytes = hexToBytes(salt);
  if (!expected || !saltBytes) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: positiveInt(env.PBKDF2_ITERATIONS, 100000),
      hash: 'SHA-256'
    },
    key,
    expected.length * 8
  );

  return timingSafeEqual(new Uint8Array(derived), expected);
}


async function handleUnlock(request, env) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: 'Malformed request.' }, 400, request, env);

  const item = field(body.item, 40);
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';

    const known = Object.prototype.hasOwnProperty.call(ITEMS, item);

  const key = await ipKey('unlock', request, env);

  if (!(await underLimit(env.UNLOCK_LIMIT, key))) {
    return json(
      { error: 'Too many attempts. Please wait a minute and try again.' },
      429,
      request,
      env,
      { 'Retry-After': '60' }
    );
  }

  if ((await failureCount(env, key)) >= LOCKOUT_THRESHOLD) {
    return json(
      { error: 'Too many failed attempts. Please try again later.' },
      429,
      request,
      env,
      { 'Retry-After': String(LOCKOUT_WINDOW_SECONDS) }
    );
  }

  if (!password || !known || !(await passwordMatches(env, item, password))) {
    await recordFailure(env, key);
    return json({ error: 'That password is not correct.' }, 401, request, env);
  }

  await clearFailures(env, key);

  const ttl = positiveInt(env.TOKEN_TTL_SECONDS, 600);
  const token = await signToken(env, item, ttl);
  return json({ token: token, expiresIn: ttl }, 200, request, env);
}

async function handleFile(request, env) {
  const url = new URL(request.url);
  const item = field(url.searchParams.get('item'), 40);
  const token = url.searchParams.get('token') || '';

  if (!Object.prototype.hasOwnProperty.call(ITEMS, item)) {
    return json({ error: 'Not found.' }, 404, request, env);
  }
  if (!(await verifyToken(env, token, item))) {
    return json({ error: 'This link is invalid or has expired.' }, 403, request, env);
  }

  const spec = ITEMS[item];

    const object = await env.FILES.get(spec.key, { range: request.headers });
  if (!object) {
    return json({ error: 'The file is not available right now.' }, 404, request, env);
  }

  const headers = new Headers(corsHeaders(request, env));
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', spec.contentType);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Accept-Ranges', 'bytes');
  headers.set(
    'Content-Disposition',
    "attachment; filename*=UTF-8''" + encodeURIComponent(spec.filename)
  );

    if (request.method === 'HEAD') {
    headers.set('Content-Length', String(object.size));
    return new Response(null, { status: 200, headers: headers });
  }

  if (object.range && request.headers.get('Range')) {
    const offset = object.range.offset || 0;
    const length =
      typeof object.range.length === 'number' ? object.range.length : object.size - offset;
    const end = offset + length - 1;
    headers.set('Content-Range', 'bytes ' + offset + '-' + end + '/' + object.size);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers: headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers: headers });
}

async function handleRequestAccess(request, env) {
  const body = await readJsonBody(request);
  if (!body) return json({ error: 'Malformed request.' }, 400, request, env);

    if (field(body.website, 200)) {
    return json({ ok: true }, 200, request, env);
  }

  const item = field(body.item, 40);
  const name = field(body.name, 120);
  const email = field(body.email, 200);
  const affiliation = field(body.affiliation, 160);
  const message = field(body.message, 2000);

  if (!Object.prototype.hasOwnProperty.call(REQUESTABLE, item)) {
    return json({ error: 'Please choose what you need.' }, 400, request, env);
  }
  if (name.length < 2) {
    return json({ error: 'Please enter your name.' }, 400, request, env);
  }
  if (!isValidEmail(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400, request, env);
  }
  if (message.length < 10) {
    return json({ error: 'Please say a little about why you need it.' }, 400, request, env);
  }

  const key = await ipKey('request', request, env);
  if (!(await underLimit(env.REQUEST_LIMIT, key))) {
    return json(
      { error: 'Too many requests. Please wait a minute and try again.' },
      429,
      request,
      env,
      { 'Retry-After': '60' }
    );
  }

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env, field(body.turnstileToken, 2048), clientIp(request));
    if (!ok) {
      return json({ error: 'Verification failed. Please try again.' }, 400, request, env);
    }
  }

  const sent = await sendRequestEmail(env, {
    item: item,
    name: name,
    email: email,
    affiliation: affiliation,
    message: message
  });

  if (!sent) {
    return json(
      { error: 'The request could not be sent. Please email abhinav.utkarsh@tum.de directly.' },
      502,
      request,
      env
    );
  }

  return json({ ok: true }, 200, request, env);
}


async function verifyTurnstile(env, token, ip) {
  if (!token) return false;
  try {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET);
    form.append('response', token);
    if (ip && ip !== 'unknown') form.append('remoteip', ip);

    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form }
    );
    const result = await response.json();
    return result.success === true;
  } catch (e) {
    return false;
  }
}

async function sendRequestEmail(env, data) {
  if (!env.RESEND_API_KEY) return false;

  const label = ITEMS[data.item] ? ITEMS[data.item].label : 'Thesis and Presentation';
  const rows = [
    ['Requested', label],
    ['Name', data.name],
    ['Email', data.email],
    ['Affiliation', data.affiliation || 'Not given']
  ]
    .map(
      ([k, v]) =>
        '<tr><td style="padding:4px 12px 4px 0;color:#666;">' +
        escapeHtml(k) +
        '</td><td style="padding:4px 0;">' +
        escapeHtml(v) +
        '</td></tr>'
    )
    .join('');

  const html =
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;">' +
    '<p>New access request from the EMO-GA project page.</p>' +
    '<table style="border-collapse:collapse;">' + rows + '</table>' +
    '<p style="margin-top:16px;"><strong>Message</strong></p>' +
    '<blockquote style="margin:0;padding:8px 14px;border-left:3px solid #ddd;color:#333;white-space:pre-wrap;">' +
    escapeHtml(data.message) +
    '</blockquote></div>';

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [env.NOTIFY_EMAIL],
        reply_to: data.email,
        subject: 'EMO-GA access request: ' + label + ' (' + data.name + ')',
        html: html
      })
    });
    return response.ok;
  } catch (e) {
    return false;
  }
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      if (path === '/unlock' && request.method === 'POST') {
        return await handleUnlock(request, env);
      }
      if (path === '/file' && (request.method === 'GET' || request.method === 'HEAD')) {
        return await handleFile(request, env);
      }
      if (path === '/request' && request.method === 'POST') {
        return await handleRequestAccess(request, env);
      }
      if (path === '/health' && request.method === 'GET') {
        return json({ ok: true }, 200, request, env);
      }
    } catch (e) {
            return json({ error: 'Unexpected error.' }, 500, request, env);
    }

    return json({ error: 'Not found.' }, 404, request, env);
  }
};

export const __test = {
  timingSafeEqual,
  b64urlEncode,
  b64urlDecode,
  hexToBytes,
  field,
  isValidEmail,
  escapeHtml,
  signToken,
  verifyToken,
  ITEMS
};
