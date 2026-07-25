#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PINTEREST OAUTH TOKEN STORE — no short-lived console tokens.
//  One-time: the owner authorizes in the browser → auth code → the
//  "Pinterest 연결" workflow calls `exchange <code>` here. The refresh
//  token is AES-encrypted (key derived from PINTEREST_APP_SECRET, which
//  only exists in GitHub Secrets) and committed as data/pinterest-token.enc
//  — safe in a public repo, useless without the secret.
//  Daily: getAccessToken() decrypts, runs the refresh grant (rotating the
//  refresh token — Pinterest continuous refresh keeps it alive forever as
//  long as we run at least yearly), re-encrypts, returns a live token.
//
//  CLI:  node scripts/lib/pinterest-token.mjs exchange <code>
//        node scripts/lib/pinterest-token.mjs refresh
//  Env:  PINTEREST_APP_SECRET (required)
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '..', '..', 'data', 'pinterest-token.enc');
const APP_ID = '1594195';
const REDIRECT_URI = 'https://wanderatlasguides.com/pinterest-callback';

const secret = () => {
  const s = process.env.PINTEREST_APP_SECRET;
  if (!s) throw new Error('PINTEREST_APP_SECRET not set');
  return s;
};
const key = () => createHash('sha256').update(secret() + ':wander-atlas-pinterest-token').digest();

function encrypt(obj) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(raw) {
  const { iv, tag, data } = JSON.parse(raw);
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
}

async function oauth(params) {
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${secret()}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`oauth ${res.status}: ${body.message || body.error || JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function save(tokens) {
  await writeFile(TOKEN_FILE, encrypt({
    refresh_token: tokens.refresh_token,
    obtained_at: new Date().toISOString(),
  }) + '\n', 'utf8');
}

export async function exchangeCode(code) {
  const tokens = await oauth({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  if (!tokens.refresh_token) throw new Error('no refresh_token in response — check scopes');
  await save(tokens);
  return tokens.scope;
}

export async function getAccessToken() {
  const stored = decrypt(await readFile(TOKEN_FILE, 'utf8'));
  const tokens = await oauth({ grant_type: 'refresh_token', refresh_token: stored.refresh_token });
  // Continuous refresh: Pinterest may rotate the refresh token — keep the newest.
  if (tokens.refresh_token && tokens.refresh_token !== stored.refresh_token) await save(tokens);
  return tokens.access_token;
}

// ── CLI (only when executed directly, not when imported) ─────
const cmd = process.argv[1]?.endsWith('pinterest-token.mjs') ? process.argv[2] : undefined;
if (cmd === 'exchange') {
  const code = (process.argv[3] || '').trim();
  if (!code) { console.error('usage: pinterest-token.mjs exchange <code>'); process.exit(1); }
  exchangeCode(code)
    .then((scope) => console.log(`✅ connected — scopes: ${scope}`))
    .catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
} else if (cmd === 'refresh') {
  getAccessToken()
    .then(() => console.log('✅ token refresh OK'))
    .catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}
