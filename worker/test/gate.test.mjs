import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto as crypto } from 'node:crypto';

import worker, { __test } from '../src/index.js';


const ORIGIN = 'https://abhinavutkarsh.com';
const EVIL = 'https://evil.example';
const PASSWORD = 'correct horse battery staple';
const ITERATIONS = 1000; 
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(password, saltHex, iterations = ITERATIONS) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return toHex(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      256
    )
  );
}

const SALT = '000102030405060708090a0b0c0d0e0f';
let PASSWORD_HASH;

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expires && entry.expires < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async put(key, value, opts = {}) {
      store.set(key, {
        value,
        expires: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0
      });
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

const FILE_BYTES = new Uint8Array(1000).map((_, i) => i % 251);

function makeR2(contents = { 'thesis.pdf': FILE_BYTES, 'presentation.pptx': FILE_BYTES }) {
  return {
    async get(key, opts = {}) {
      const bytes = contents[key];
      if (!bytes) return null;

      let range = undefined;
      let slice = bytes;
      const header = opts.range && typeof opts.range.get === 'function'
        ? opts.range.get('Range')
        : null;

      if (header) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (m) {
          const offset = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : bytes.length - 1;
          range = { offset, length: end - offset + 1 };
          slice = bytes.slice(offset, end + 1);
        }
      }

      return {
        size: bytes.length,
        httpEtag: '"deadbeef"',
        range,
        body: new Blob([slice]).stream(),
        writeHttpMetadata(headers) {
          headers.set('Content-Type', 'application/octet-stream');
        }
      };
    }
  };
}

function makeLimiter(limit = 100) {
  const counts = new Map();
  return {
    async limit({ key }) {
      const n = (counts.get(key) || 0) + 1;
      counts.set(key, n);
      return { success: n <= limit };
    }
  };
}

let sentEmails;
let turnstileOutcome;
let resendOk;

function installFetchMock() {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('api.resend.com')) {
      sentEmails.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'mock' }), { status: resendOk ? 200 : 500 });
    }
    if (href.includes('challenges.cloudflare.com')) {
      return new Response(JSON.stringify({ success: turnstileOutcome }), { status: 200 });
    }
    throw new Error('unexpected outbound fetch to ' + href);
  };
}

function makeEnv(overrides = {}) {
  return Object.assign(
    {
      NOTIFY_EMAIL: 'abhinav.utkarsh@tum.de',
      MAIL_FROM: 'EMO-GA <noreply@example.com>',
      ALLOWED_ORIGINS: ORIGIN + ',https://www.abhinavutkarsh.com',
      PBKDF2_ITERATIONS: String(ITERATIONS),
      TOKEN_TTL_SECONDS: '600',
      TOKEN_SECRET: 'test-token-secret-do-not-use-in-production',
      PASSWORD_HASH,
      PASSWORD_SALT: SALT,
      RESEND_API_KEY: 'test-key',
      FILES: makeR2(),
      RATE: makeKV(),
      UNLOCK_LIMIT: makeLimiter(),
      REQUEST_LIMIT: makeLimiter()
    },
    overrides
  );
}

function post(path, body, { origin = ORIGIN, ip = '203.0.113.7', raw, contentType } = {}) {
  return new Request('https://api.example.com' + path, {
    method: 'POST',
    headers: {
      'Content-Type': contentType === undefined ? 'application/json' : contentType,
      Origin: origin,
      'CF-Connecting-IP': ip
    },
    body: raw !== undefined ? raw : JSON.stringify(body)
  });
}

function get(path, { origin = ORIGIN, ip = '203.0.113.7', headers = {}, method = 'GET' } = {}) {
  return new Request('https://api.example.com' + path, {
    method,
    headers: Object.assign({ Origin: origin, 'CF-Connecting-IP': ip }, headers)
  });
}

async function unlock(env, item = 'thesis', password = PASSWORD, opts = {}) {
  const res = await worker.fetch(post('/unlock', { item, password }, opts), env);
  return { res, body: await res.json().catch(() => ({})) };
}


PASSWORD_HASH = await derive(PASSWORD, SALT);

beforeEach(() => {
  sentEmails = [];
  turnstileOutcome = true;
  resendOk = true;
  installFetchMock();
});


describe('routing and CORS', () => {
  test('health check responds', async () => {
    const res = await worker.fetch(get('/health'), makeEnv());
    assert.equal(res.status, 200);
  });

  test('allowed origin is echoed back', async () => {
    const res = await worker.fetch(get('/health'), makeEnv());
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(res.headers.get('Vary'), 'Origin');
  });

  test('hostile origin gets no CORS grant', async () => {
    const res = await worker.fetch(get('/health', { origin: EVIL }), makeEnv());
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  });

  test('never answers with a wildcard origin', async () => {
    const res = await worker.fetch(get('/health'), makeEnv());
    assert.notEqual(res.headers.get('Access-Control-Allow-Origin'), '*');
  });

  test('preflight is answered', async () => {
    const res = await worker.fetch(get('/unlock', { method: 'OPTIONS' }), makeEnv());
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  });

  test('unknown path is 404', async () => {
    const res = await worker.fetch(get('/admin'), makeEnv());
    assert.equal(res.status, 404);
  });

  test('GET on /unlock is rejected', async () => {
    const res = await worker.fetch(get('/unlock'), makeEnv());
    assert.equal(res.status, 404);
  });

  test('POST on /file is rejected', async () => {
    const res = await worker.fetch(post('/file', {}), makeEnv());
    assert.equal(res.status, 404);
  });

  test('trailing slashes normalise to the same route', async () => {
    const res = await worker.fetch(get('/health///'), makeEnv());
    assert.equal(res.status, 200);
  });
});

describe('unlock: password handling', () => {
  test('correct password returns a token', async () => {
    const { res, body } = await unlock(makeEnv());
    assert.equal(res.status, 200);
    assert.ok(body.token);
    assert.equal(body.expiresIn, 600);
  });

  test('wrong password is 401', async () => {
    const { res, body } = await unlock(makeEnv(), 'thesis', 'wrong');
    assert.equal(res.status, 401);
    assert.ok(!body.token);
  });

  test('password is case sensitive', async () => {
    const { res } = await unlock(makeEnv(), 'thesis', PASSWORD.toUpperCase());
    assert.equal(res.status, 401);
  });

  test('a one character truncation fails', async () => {
    const { res } = await unlock(makeEnv(), 'thesis', PASSWORD.slice(0, -1));
    assert.equal(res.status, 401);
  });

  test('trailing whitespace is not silently trimmed away', async () => {
    const { res } = await unlock(makeEnv(), 'thesis', PASSWORD + ' ');
    assert.equal(res.status, 401);
  });

  test('empty password is 401, never a pass', async () => {
    const { res } = await unlock(makeEnv(), 'thesis', '');
    assert.equal(res.status, 401);
  });

  test('unknown item gives the same 401 as a bad password (no enumeration)', async () => {
    const env = makeEnv();
    const bad = await unlock(env, 'nonexistent', PASSWORD);
    const wrong = await unlock(env, 'thesis', 'wrong', { ip: '203.0.113.8' });
    assert.equal(bad.res.status, 401);
    assert.equal(bad.body.error, wrong.body.error);
  });

  test('prototype keys cannot pass as items', async () => {
    for (const item of ['__proto__', 'constructor', 'hasOwnProperty', 'toString']) {
      const { res } = await unlock(makeEnv(), item, PASSWORD);
      assert.equal(res.status, 401, `item ${item} must not unlock`);
    }
  });

  test('missing server secrets fail closed', async () => {
    const env = makeEnv({ PASSWORD_HASH: undefined, PASSWORD_SALT: undefined });
    const { res } = await unlock(env);
    assert.equal(res.status, 401);
  });

  test('malformed hex in secrets fails closed rather than throwing', async () => {
    const env = makeEnv({ PASSWORD_HASH: 'zzzz', PASSWORD_SALT: 'nothex' });
    const { res } = await unlock(env);
    assert.equal(res.status, 401);
  });

  test('per-item password overrides the shared one', async () => {
    const thesisHash = await derive('thesis-only', SALT);
    const env = makeEnv({ PASSWORD_HASH_THESIS: thesisHash, PASSWORD_SALT_THESIS: SALT });

    assert.equal((await unlock(env, 'thesis', 'thesis-only')).res.status, 200);
    assert.equal((await unlock(env, 'thesis', PASSWORD, { ip: '1.1.1.1' })).res.status, 401);
    assert.equal((await unlock(env, 'presentation', PASSWORD, { ip: '1.1.1.2' })).res.status, 200);
  });

  test('unicode passwords round trip', async () => {
    const pw = 'pässwörd-日本語-🔐';
    const env = makeEnv({ PASSWORD_HASH: await derive(pw, SALT) });
    assert.equal((await unlock(env, 'thesis', pw)).res.status, 200);
    assert.equal((await unlock(env, 'thesis', 'pässwörd', { ip: '1.1.1.3' })).res.status, 401);
  });
});

describe('unlock: malformed input', () => {
  test('non-JSON content type is 400', async () => {
    const res = await worker.fetch(
      post('/unlock', null, { raw: 'item=thesis', contentType: 'application/x-www-form-urlencoded' }),
      makeEnv()
    );
    assert.equal(res.status, 400);
  });

  test('invalid JSON is 400', async () => {
    const res = await worker.fetch(post('/unlock', null, { raw: '{oops' }), makeEnv());
    assert.equal(res.status, 400);
  });

  test('a JSON array body is 400', async () => {
    const res = await worker.fetch(post('/unlock', null, { raw: '[1,2,3]' }), makeEnv());
    assert.equal(res.status, 400);
  });

  test('a bare JSON string body is 400', async () => {
    const res = await worker.fetch(post('/unlock', null, { raw: '"hello"' }), makeEnv());
    assert.equal(res.status, 400);
  });

  test('null body is 400', async () => {
    const res = await worker.fetch(post('/unlock', null, { raw: 'null' }), makeEnv());
    assert.equal(res.status, 400);
  });

  test('oversized body is rejected', async () => {
    const huge = JSON.stringify({ item: 'thesis', password: 'x'.repeat(64 * 1024) });
    const res = await worker.fetch(post('/unlock', null, { raw: huge }), makeEnv());
    assert.equal(res.status, 400);
  });

  test('type confusion in fields does not crash', async () => {
    const payloads = [
      { item: { a: 1 }, password: PASSWORD },
      { item: ['thesis'], password: PASSWORD },
      { item: 'thesis', password: 12345 },
      { item: 'thesis', password: { toString: 'x' } },
      { item: 'thesis', password: null },
      { item: 42, password: [] },
      {}
    ];
    for (const payload of payloads) {
      const res = await worker.fetch(post('/unlock', payload), makeEnv());
      assert.ok(
        res.status === 400 || res.status === 401,
        `expected 400/401 for ${JSON.stringify(payload)}, got ${res.status}`
      );
    }
  });
});

describe('unlock: brute force resistance', () => {
  test('repeated failures lock the address out', async () => {
    const env = makeEnv();
    for (let i = 0; i < 8; i++) {
      const { res } = await unlock(env, 'thesis', 'wrong' + i);
      assert.equal(res.status, 401, `attempt ${i} should still be 401`);
    }
    const locked = await unlock(env, 'thesis', 'wrong-again');
    assert.equal(locked.res.status, 429);
    assert.ok(locked.res.headers.get('Retry-After'));
  });

  test('lockout holds even once the right password is offered', async () => {
    const env = makeEnv();
    for (let i = 0; i < 8; i++) await unlock(env, 'thesis', 'wrong' + i);
    const { res } = await unlock(env, 'thesis', PASSWORD);
    assert.equal(res.status, 429);
  });

  test('a success clears the failure counter', async () => {
    const env = makeEnv();
    for (let i = 0; i < 4; i++) await unlock(env, 'thesis', 'wrong' + i);
    assert.equal((await unlock(env, 'thesis', PASSWORD)).res.status, 200);
    for (let i = 0; i < 7; i++) {
      assert.equal((await unlock(env, 'thesis', 'wrong' + i)).res.status, 401);
    }
  });

  test('one address being locked out does not lock out everyone', async () => {
    const env = makeEnv();
    for (let i = 0; i < 9; i++) await unlock(env, 'thesis', 'wrong' + i, { ip: '198.51.100.1' });
    const other = await unlock(env, 'thesis', PASSWORD, { ip: '198.51.100.2' });
    assert.equal(other.res.status, 200);
  });

  test('the in-colo limiter caps burst attempts', async () => {
    const env = makeEnv({ UNLOCK_LIMIT: makeLimiter(3), RATE: makeKV() });
    for (let i = 0; i < 3; i++) await unlock(env, 'thesis', 'wrong');
    const { res } = await unlock(env, 'thesis', PASSWORD);
    assert.equal(res.status, 429);
  });

  test('raw IP addresses are not written into the rate limit store', async () => {
    const env = makeEnv();
    await unlock(env, 'thesis', 'wrong', { ip: '198.51.100.55' });
    const keys = [...env.RATE.store.keys()].join(' ');
    assert.ok(!keys.includes('198.51.100.55'));
  });

  test('the gate still works with no rate limit bindings at all', async () => {
    const env = makeEnv({ RATE: undefined, UNLOCK_LIMIT: undefined });
    assert.equal((await unlock(env)).res.status, 200);
  });
});

describe('tokens', () => {
  async function tokenFor(env, item = 'thesis') {
    const { body } = await unlock(env, item, PASSWORD, { ip: '203.0.113.' + Math.ceil(Math.random() * 200) });
    return body.token;
  }

  test('a fresh token opens the file', async () => {
    const env = makeEnv();
    const token = await tokenFor(env);
    const res = await worker.fetch(get(`/file?item=thesis&token=${encodeURIComponent(token)}`), env);
    assert.equal(res.status, 200);
  });

  test('no token is 403', async () => {
    const res = await worker.fetch(get('/file?item=thesis'), makeEnv());
    assert.equal(res.status, 403);
  });

  test('a garbage token is 403', async () => {
    const res = await worker.fetch(get('/file?item=thesis&token=abc.def.ghi'), makeEnv());
    assert.equal(res.status, 403);
  });

  test('flipping a byte of the signature is 403', async () => {
    const env = makeEnv();
    const token = await tokenFor(env);
    const parts = token.split('.');
    const sig = parts[4];
    parts[4] = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const res = await worker.fetch(get(`/file?item=thesis&token=${parts.join('.')}`), env);
    assert.equal(res.status, 403);
  });

  test('extending the expiry without resigning is 403', async () => {
    const env = makeEnv();
    const token = await tokenFor(env);
    const parts = token.split('.');
    parts[2] = String(parseInt(parts[2], 10) + 86400);
    const res = await worker.fetch(get(`/file?item=thesis&token=${parts.join('.')}`), env);
    assert.equal(res.status, 403);
  });

  test('a thesis token cannot open the presentation', async () => {
    const env = makeEnv();
    const token = await tokenFor(env, 'thesis');
    const res = await worker.fetch(
      get(`/file?item=presentation&token=${encodeURIComponent(token)}`),
      env
    );
    assert.equal(res.status, 403);
  });

  test('rewriting the item inside the token is 403', async () => {
    const env = makeEnv();
    const token = await tokenFor(env, 'thesis');
    const parts = token.split('.');
    parts[1] = 'presentation';
    const res = await worker.fetch(get(`/file?item=presentation&token=${parts.join('.')}`), env);
    assert.equal(res.status, 403);
  });

  test('an expired token is 403', async () => {
    const env = makeEnv();
    const token = await __test.signToken(env, 'thesis', -5);
    const res = await worker.fetch(
      get(`/file?item=thesis&token=${encodeURIComponent(token)}`),
      env
    );
    assert.equal(res.status, 403);
  });

  test('a token expiring one second from now still works', async () => {
    const env = makeEnv();
    const token = await __test.signToken(env, 'thesis', 1);
    const res = await worker.fetch(
      get(`/file?item=thesis&token=${encodeURIComponent(token)}`),
      env
    );
    assert.equal(res.status, 200);
  });

  test('a nonsensical TTL config never mints a negative-life token', async () => {
    for (const ttl of ['-5', '0', 'abc', '']) {
      const env = makeEnv({ TOKEN_TTL_SECONDS: ttl });
      const { res, body } = await unlock(env, 'thesis', PASSWORD, {
        ip: '203.0.113.' + Math.ceil(Math.random() * 200)
      });
      assert.equal(res.status, 200);
      assert.ok(body.expiresIn > 0, `TTL ${ttl} must fall back to a positive value`);
    }
  });

  test('a token signed with a different secret is 403', async () => {
    const minted = makeEnv();
    const token = await tokenFor(minted);
    const other = makeEnv({ TOKEN_SECRET: 'a-completely-different-secret' });
    const res = await worker.fetch(
      get(`/file?item=thesis&token=${encodeURIComponent(token)}`),
      other
    );
    assert.equal(res.status, 403);
  });

  test('a wrong version prefix is 403', async () => {
    const env = makeEnv();
    const parts = (await tokenFor(env)).split('.');
    parts[0] = 'v2';
    const res = await worker.fetch(get(`/file?item=thesis&token=${parts.join('.')}`), env);
    assert.equal(res.status, 403);
  });

  test('an absurdly long token is rejected without work', async () => {
    const res = await worker.fetch(get(`/file?item=thesis&token=${'a'.repeat(5000)}`), makeEnv());
    assert.equal(res.status, 403);
  });

  test('extra token segments are rejected', async () => {
    const env = makeEnv();
    const token = await tokenFor(env);
    const res = await worker.fetch(get(`/file?item=thesis&token=${token}.extra`), env);
    assert.equal(res.status, 403);
  });

  test('tokens are unique per unlock', async () => {
    const env = makeEnv();
    const a = await tokenFor(env);
    const b = await tokenFor(env);
    assert.notEqual(a, b);
  });

  test('the token carries no password material', async () => {
    const env = makeEnv();
    const token = await tokenFor(env);
    assert.ok(!token.toLowerCase().includes('horse'));
    assert.ok(!token.includes(PASSWORD_HASH.slice(0, 12)));
  });
});

describe('file delivery', () => {
  async function open(env, item = 'thesis', extra = {}) {
    const { body } = await unlock(env, item, PASSWORD, { ip: '203.0.113.99' });
    return worker.fetch(
      get(`/file?item=${item}&token=${encodeURIComponent(body.token)}`, extra),
      env
    );
  }

  test('unknown item is 404 before any token work', async () => {
    const res = await worker.fetch(get('/file?item=../../etc/passwd&token=x'), makeEnv());
    assert.equal(res.status, 404);
  });

  test('served as an attachment with the real filename', async () => {
    const res = await open(makeEnv());
    const disposition = res.headers.get('Content-Disposition');
    assert.match(disposition, /^attachment;/);
    assert.match(disposition, /Emotion-Driven/);
  });

  test('marked private and non-indexable', async () => {
    const res = await open(makeEnv());
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
    assert.match(res.headers.get('X-Robots-Tag'), /noindex/);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  });

  test('correct content type per item', async () => {
    assert.equal((await open(makeEnv(), 'thesis')).headers.get('Content-Type'), 'application/pdf');
    assert.match(
      (await open(makeEnv(), 'presentation')).headers.get('Content-Type'),
      /presentationml/
    );
  });

  test('body matches the stored bytes', async () => {
    const res = await open(makeEnv());
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.equal(bytes.length, FILE_BYTES.length);
    assert.deepEqual(bytes.slice(0, 10), FILE_BYTES.slice(0, 10));
  });

  test('a range request returns 206 with a content range', async () => {
    const res = await open(makeEnv(), 'thesis', { headers: { Range: 'bytes=100-199' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('Content-Range'), 'bytes 100-199/1000');
    assert.equal(res.headers.get('Content-Length'), '100');
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual(bytes, FILE_BYTES.slice(100, 200));
  });

  test('ranged downloads can be resumed repeatedly with one token', async () => {
    const env = makeEnv();
    const { body } = await unlock(env, 'thesis', PASSWORD, { ip: '203.0.113.77' });
    for (const range of ['bytes=0-99', 'bytes=100-199', 'bytes=200-299']) {
      const res = await worker.fetch(
        get(`/file?item=thesis&token=${encodeURIComponent(body.token)}`, { headers: { Range: range } }),
        env
      );
      assert.equal(res.status, 206, `range ${range} should succeed`);
    }
  });

  test('HEAD reports the size without a body', async () => {
    const env = makeEnv();
    const { body } = await unlock(env, 'thesis', PASSWORD, { ip: '203.0.113.66' });
    const res = await worker.fetch(
      get(`/file?item=thesis&token=${encodeURIComponent(body.token)}`, { method: 'HEAD' }),
      env
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Length'), '1000');
    assert.equal(await res.text(), '');
  });

  test('a missing object in the bucket is 404, not a crash', async () => {
    const env = makeEnv({ FILES: makeR2({}) });
    const { body } = await unlock(env, 'thesis', PASSWORD, { ip: '203.0.113.55' });
    const res = await worker.fetch(
      get(`/file?item=thesis&token=${encodeURIComponent(body.token)}`),
      env
    );
    assert.equal(res.status, 404);
  });
});

describe('request form', () => {
  const valid = {
    item: 'thesis',
    name: 'Jane Doe',
    email: 'jane@university.edu',
    affiliation: 'ETH',
    message: 'I am researching avatar editing and would like to read the thesis.'
  };

  test('a valid request sends exactly one email to the owner', async () => {
    const res = await worker.fetch(post('/request', valid), makeEnv());
    assert.equal(res.status, 200);
    assert.equal(sentEmails.length, 1);
    assert.deepEqual(sentEmails[0].to, ['abhinav.utkarsh@tum.de']);
    assert.equal(sentEmails[0].reply_to, 'jane@university.edu');
  });

  test('the requester address never becomes the recipient', async () => {
    await worker.fetch(post('/request', { ...valid, email: 'attacker@evil.test' }), makeEnv());
    assert.deepEqual(sentEmails[0].to, ['abhinav.utkarsh@tum.de']);
  });

  test('"both" is accepted as a request but is not a downloadable item', async () => {
    const res = await worker.fetch(post('/request', { ...valid, item: 'both' }), makeEnv());
    assert.equal(res.status, 200);

    const file = await worker.fetch(get('/file?item=both&token=x'), makeEnv());
    assert.equal(file.status, 404);
  });

  test('a filled honeypot is silently dropped', async () => {
    const res = await worker.fetch(
      post('/request', { ...valid, website: 'http://spam.example' }),
      makeEnv()
    );
    assert.equal(res.status, 200);
    assert.equal(sentEmails.length, 0);
  });

  test('invalid addresses are rejected', async () => {
    const bad = ['', 'nope', 'a@b', 'a@@b.com', '@b.com', 'a b@c.com', 'a@b.c', 'x'.repeat(250)];
    for (const email of bad) {
      const res = await worker.fetch(post('/request', { ...valid, email }), makeEnv());
      assert.equal(res.status, 400, `${email} should be rejected`);
    }
    assert.equal(sentEmails.length, 0);
  });

  test('header injection through the address is blocked', async () => {
    const attacks = [
      'a@b.com\r\nBcc: victim@example.com',
      'a@b.com\nTo: victim@example.com',
      '"a"@b.com',
      'a@b.com>, victim@example.com'
    ];
    for (const email of attacks) {
      const res = await worker.fetch(post('/request', { ...valid, email }), makeEnv());
      assert.equal(res.status, 400, `${JSON.stringify(email)} should be rejected`);
    }
    assert.equal(sentEmails.length, 0);
  });

  test('newlines in the name cannot reach the email', async () => {
    await worker.fetch(
      post('/request', { ...valid, name: 'Jane\r\nBcc: victim@example.com' }),
      makeEnv()
    );
    assert.equal(sentEmails.length, 1);
    assert.ok(!sentEmails[0].subject.includes('\n'));
    assert.ok(!sentEmails[0].subject.includes('\r'));
  });

  test('HTML in user text is escaped in the email body', async () => {
    await worker.fetch(
      post('/request', {
        ...valid,
        name: '<img src=x onerror=alert(1)>',
        message: '</blockquote><script>alert("xss")</script> please send it over'
      }),
      makeEnv()
    );
    const html = sentEmails[0].html;
    assert.ok(!html.includes('<script'), 'no live script tag');
    assert.ok(!html.includes('<img'), 'no live img tag');
    assert.ok(!html.includes('</blockquote></blockquote>'), 'cannot break out of the quote');
    assert.ok(html.includes('&lt;script&gt;'), 'the payload is present but escaped');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'name is escaped, not stripped');
  });

  test('quotes and ampersands in user text cannot break out of an attribute', async () => {
    await worker.fetch(
      post('/request', { ...valid, name: `" onmouseover="alert(1)` , affiliation: 'A & B <b>' }),
      makeEnv()
    );
    const html = sentEmails[0].html;
    assert.ok(!html.includes('onmouseover="'), 'no injected attribute');
    assert.ok(html.includes('&quot;'), 'quotes escaped');
    assert.ok(html.includes('&amp;'), 'ampersands escaped');
    assert.ok(!html.includes('<b>'), 'no live markup from affiliation');
  });

  test('short or missing fields are rejected', async () => {
    const cases = [
      { ...valid, name: 'J' },
      { ...valid, name: '   ' },
      { ...valid, message: 'too short' },
      { ...valid, message: '' },
      { ...valid, item: 'nonsense' },
      { ...valid, item: '__proto__' }
    ];
    for (const payload of cases) {
      const res = await worker.fetch(post('/request', payload), makeEnv());
      assert.equal(res.status, 400, `${JSON.stringify(payload).slice(0, 60)} should be 400`);
    }
    assert.equal(sentEmails.length, 0);
  });

  test('oversized text is truncated rather than accepted whole', async () => {
    await worker.fetch(post('/request', { ...valid, message: 'A'.repeat(10000) }), makeEnv());
    const res = await worker.fetch(post('/request', { ...valid, message: 'A'.repeat(3000) }), makeEnv());
    assert.equal(res.status, 200);
    assert.ok(sentEmails[sentEmails.length - 1].html.length < 6000);
  });

  test('the form is rate limited', async () => {
    const env = makeEnv({ REQUEST_LIMIT: makeLimiter(2) });
    assert.equal((await worker.fetch(post('/request', valid), env)).status, 200);
    assert.equal((await worker.fetch(post('/request', valid), env)).status, 200);
    const third = await worker.fetch(post('/request', valid), env);
    assert.equal(third.status, 429);
    assert.equal(sentEmails.length, 2);
  });

  test('a failed captcha blocks the send', async () => {
    turnstileOutcome = false;
    const env = makeEnv({ TURNSTILE_SECRET: 'secret' });
    const res = await worker.fetch(post('/request', { ...valid, turnstileToken: 'tok' }), env);
    assert.equal(res.status, 400);
    assert.equal(sentEmails.length, 0);
  });

  test('a missing captcha token blocks the send when captcha is on', async () => {
    const env = makeEnv({ TURNSTILE_SECRET: 'secret' });
    const res = await worker.fetch(post('/request', valid), env);
    assert.equal(res.status, 400);
    assert.equal(sentEmails.length, 0);
  });

  test('a mail provider failure surfaces as 502, not a false success', async () => {
    resendOk = false;
    const res = await worker.fetch(post('/request', valid), makeEnv());
    assert.equal(res.status, 502);
  });

  test('a delivered request is kept in the log', async () => {
    const env = makeEnv();
    await worker.fetch(post('/request', valid), env);
    const keys = [...env.RATE.store.keys()].filter((k) => k.startsWith('req:'));
    assert.equal(keys.length, 1);
    const saved = JSON.parse(env.RATE.store.get(keys[0]).value);
    assert.equal(saved.email, 'jane@university.edu');
    assert.equal(saved.emailSent, true);
    assert.ok(saved.at);
  });

  test('a request survives in the log even when the email fails', async () => {
    resendOk = false;
    const env = makeEnv();
    const res = await worker.fetch(post('/request', valid), env);
    assert.equal(res.status, 502);
    const keys = [...env.RATE.store.keys()].filter((k) => k.startsWith('req:'));
    assert.equal(keys.length, 1, 'the request must not be lost');
    assert.equal(JSON.parse(env.RATE.store.get(keys[0]).value).emailSent, false);
  });

  test('a honeypot submission is not written to the log', async () => {
    const env = makeEnv();
    await worker.fetch(post('/request', { ...valid, website: 'spam' }), env);
    assert.equal([...env.RATE.store.keys()].filter((k) => k.startsWith('req:')).length, 0);
  });

  test('a rejected request is not written to the log', async () => {
    const env = makeEnv();
    await worker.fetch(post('/request', { ...valid, email: 'bad' }), env);
    assert.equal([...env.RATE.store.keys()].filter((k) => k.startsWith('req:')).length, 0);
  });

  test('log keys do not collide within the same millisecond', async () => {
    const env = makeEnv({ REQUEST_LIMIT: makeLimiter(50) });
    await Promise.all(
      Array.from({ length: 5 }, () => worker.fetch(post('/request', valid), env))
    );
    assert.equal([...env.RATE.store.keys()].filter((k) => k.startsWith('req:')).length, 5);
  });

  test('the log survives a KV outage without failing the request', async () => {
    const env = makeEnv({
      RATE: { get: async () => null, put: async () => { throw new Error('kv down'); }, delete: async () => {} }
    });
    const res = await worker.fetch(post('/request', valid), env);
    assert.equal(res.status, 200);
    assert.equal(sentEmails.length, 1);
  });

  test('a missing API key fails closed', async () => {
    const env = makeEnv({ RESEND_API_KEY: undefined });
    const res = await worker.fetch(post('/request', valid), env);
    assert.equal(res.status, 502);
    assert.equal(sentEmails.length, 0);
  });
});

describe('information disclosure', () => {
  test('no response leaks the password, hash or token secret', async () => {
    const env = makeEnv();
    const responses = await Promise.all([
      worker.fetch(post('/unlock', { item: 'thesis', password: 'wrong' }), env),
      worker.fetch(get('/file?item=thesis&token=bogus'), env),
      worker.fetch(get('/nope'), env),
      worker.fetch(post('/unlock', null, { raw: '{bad' }), env)
    ]);
    for (const res of responses) {
      const text = await res.text();
      assert.ok(!text.includes(PASSWORD));
      assert.ok(!text.includes(PASSWORD_HASH));
      assert.ok(!text.includes(SALT));
      assert.ok(!text.toLowerCase().includes('token_secret'));
    }
  });

  test('an internal throw becomes a plain 500', async () => {
    const env = makeEnv({
      FILES: {
        get() {
          throw new Error('secret internal detail xyzzy');
        }
      }
    });
    const { body } = await unlock(env, 'thesis', PASSWORD, { ip: '203.0.113.44' });
    const res = await worker.fetch(
      get(`/file?item=thesis&token=${encodeURIComponent(body.token)}`),
      env
    );
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes('xyzzy'));
  });
});

describe('helper units', () => {
  test('timingSafeEqual compares content and length', () => {
    const a = new Uint8Array([1, 2, 3]);
    assert.equal(__test.timingSafeEqual(a, new Uint8Array([1, 2, 3])), true);
    assert.equal(__test.timingSafeEqual(a, new Uint8Array([1, 2, 4])), false);
    assert.equal(__test.timingSafeEqual(a, new Uint8Array([1, 2])), false);
    assert.equal(__test.timingSafeEqual(a, [1, 2, 3]), false);
    assert.equal(__test.timingSafeEqual(a, null), false);
  });

  test('base64url round trips including bytes that need padding', () => {
    for (const len of [1, 2, 3, 16, 31, 32]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      const encoded = __test.b64urlEncode(bytes);
      assert.ok(!/[+/=]/.test(encoded), 'must be url safe');
      assert.deepEqual(__test.b64urlDecode(encoded), bytes);
    }
  });

  test('hexToBytes rejects anything that is not clean hex', () => {
    assert.equal(__test.hexToBytes('abc'), null);
    assert.equal(__test.hexToBytes('zz'), null);
    assert.equal(__test.hexToBytes(''), null);
    assert.equal(__test.hexToBytes(undefined), null);
    assert.deepEqual(__test.hexToBytes('00ff'), new Uint8Array([0, 255]));
  });

  test('field strips control characters and clamps length', () => {
    const CTRL = String.fromCharCode(0) + String.fromCharCode(31);
    assert.equal(__test.field('a' + CTRL + 'b', 50), 'a  b');
    assert.equal(__test.field('line' + String.fromCharCode(13,10) + 'break', 50), 'line  break');
    assert.equal(__test.field('  padded  ', 50), 'padded');
    assert.equal(__test.field('x'.repeat(100), 10).length, 10);
    assert.equal(__test.field(123, 10), '');
    assert.equal(__test.field(null, 10), '');
  });

  test('escapeHtml covers every dangerous character', () => {
    assert.equal(__test.escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });
});
