#!/usr/bin/env node
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = Number(process.env.PBKDF2_ITERATIONS || 100000);
const KEY_BITS = 256;

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(length = 20) {
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = '';
  while (out.length < length) {
    const buf = crypto.getRandomValues(new Uint8Array(length));
    for (const byte of buf) {
      if (byte < max) out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function derive(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
}

const provided = process.argv[2];
const password = provided || generatePassword();
const salt = crypto.getRandomValues(new Uint8Array(16));
const hash = await derive(password, salt);

const line = '-'.repeat(72);
console.log(line);
console.log('  Password  ', password);
console.log(provided ? '  (supplied by you)' : '  (generated, 20 chars, save it in your password manager)');
console.log(line);
console.log();
console.log('Set these as Worker secrets:');
console.log();
console.log(`  echo ${toHex(salt)} | npx wrangler secret put PASSWORD_SALT`);
console.log(`  echo ${toHex(hash)} | npx wrangler secret put PASSWORD_HASH`);
console.log();
console.log(`PBKDF2 iterations used: ${ITERATIONS}`);
console.log('This must match PBKDF2_ITERATIONS in wrangler.toml, or unlock will always fail.');
console.log();
console.log('For a separate password per file, append _THESIS or _PRESENTATION');
console.log('to the secret names, for example PASSWORD_HASH_THESIS.');
