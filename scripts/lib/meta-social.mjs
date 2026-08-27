#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  META SOCIAL (Instagram + Threads) — tokens, uploads, publishing.
//
//  The owner's manual uploads stalled on 2026-08-05 and the accounts sat
//  three weeks silent while the material kept arriving on Telegram every
//  morning. Distribution that depends on a daily human act stops; Pinterest,
//  automated, never missed a day. So the morning material now posts itself:
//  Threads daily, Instagram Mon/Wed/Fri (the conservative cadence for a
//  young account — see the 2026-08-27 research note in memory).
//
//  Tokens: the Meta console issues 60-day tokens (INSTAGRAM_ACCESS_TOKEN /
//  THREADS_ACCESS_TOKEN secrets are the BOOTSTRAP copies). Refreshing mints a
//  NEW value, and a workflow cannot write GitHub Secrets — the Pinterest
//  problem all over again, solved the Pinterest way: the live tokens ride in
//  data/social-token.enc, AES-GCM under SOCIAL_TOKEN_KEY (a secret the owner
//  typed and nobody else has seen), committed with the state. A token not
//  refreshed within 60 days dies and only a browser re-login revives it, so
//  every run refreshes anything older than 24h (Meta's minimum age) and the
//  workflow alarms in Korean when a refresh fails.
//
//  Images: Meta fetches by public URL only. Cards go into the existing R2
//  bucket (wa-og-images, served by the worker at /og/*) via the Cloudflare
//  REST API — CF_API_TOKEN already carries Workers R2 Storage:Edit (verified
//  weekly by cf-token-check). No site rebuild needed, live immediately.
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, '..', '..', 'data', 'social-token.enc');
const IG_GRAPH = 'https://graph.instagram.com/v23.0';
const TH_GRAPH = 'https://graph.threads.net/v1.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── encrypted store (pinterest-token.mjs pattern) ────────────
const storeKey = () => {
  const s = process.env.SOCIAL_TOKEN_KEY;
  if (!s) throw new Error('SOCIAL_TOKEN_KEY not set');
  return createHash('sha256').update(s + ':wander-atlas-social-token').digest();
};

export function encryptStore(obj, keyBuf = storeKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBuf, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function decryptStore(raw, keyBuf = storeKey()) {
  const { iv, tag, data } = JSON.parse(raw);
  const decipher = createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8'));
}

/**
 * Live tokens: the enc file when it decrypts, else the bootstrap secrets.
 * Shape: { ig: {token, refreshedAt}, th: {token, refreshedAt} }
 */
export async function loadTokens() {
  try {
    const stored = decryptStore(await readFile(TOKEN_FILE, 'utf8'));
    if (stored?.ig?.token && stored?.th?.token) return stored;
  } catch { /* first run, or key rotated — fall back to bootstrap */ }
  const ig = process.env.INSTAGRAM_ACCESS_TOKEN, th = process.env.THREADS_ACCESS_TOKEN;
  if (!ig || !th) throw new Error('no token store and bootstrap secrets missing');
  // refreshedAt unknown for console-issued tokens; claim "now" so the first
  // refresh happens tomorrow (Meta refuses to refresh tokens younger than 24h).
  const now = new Date().toISOString();
  return { ig: { token: ig, refreshedAt: now }, th: { token: th, refreshedAt: now } };
}

export async function saveTokens(tokens) {
  await writeFile(TOKEN_FILE, encryptStore(tokens) + '\n', 'utf8');
}

/**
 * Refresh both tokens if old enough (>24h). Returns { tokens, failures[] } —
 * a refresh failure is NOT fatal today (the current token may still be live)
 * but the caller must alarm, because 60 days of silent failure is a dead
 * account integration.
 */
export async function refreshTokens(tokens) {
  const failures = [];
  const jobs = [
    ['ig', `${IG_GRAPH.replace(/\/v[\d.]+$/, '')}/refresh_access_token?grant_type=ig_refresh_token&access_token=`],
    ['th', `${TH_GRAPH.replace(/\/v[\d.]+$/, '')}/refresh_access_token?grant_type=th_refresh_token&access_token=`],
  ];
  for (const [kind, base] of jobs) {
    const cur = tokens[kind];
    const ageH = (Date.now() - Date.parse(cur.refreshedAt || 0)) / 36e5;
    if (Number.isFinite(ageH) && ageH < 24) { console.log(`${kind} token is ${ageH.toFixed(1)}h old — refresh skipped (Meta needs ≥24h)`); continue; }
    try {
      const res = await fetch(base + encodeURIComponent(cur.token));
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) throw new Error(`${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
      tokens[kind] = { token: body.access_token, refreshedAt: new Date().toISOString() };
      console.log(`${kind} token refreshed (expires_in ${body.expires_in ?? '?'}s)`);
    } catch (e) {
      failures.push(`${kind}: ${e.message}`);
    }
  }
  return { tokens, failures };
}

// ── R2 upload via Cloudflare REST (no S3 keys needed) ────────
export async function r2Put(key, buf, contentType = 'image/jpeg') {
  const acct = process.env.CF_ACCOUNT_ID, tok = process.env.CF_API_TOKEN;
  if (!acct || !tok) throw new Error('CF_ACCOUNT_ID / CF_API_TOKEN not set');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${acct}/r2/buckets/wa-og-images/objects/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': contentType }, body: buf },
  );
  if (!res.ok) throw new Error(`R2 put ${key} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return `https://wanderatlasguides.com/og/${key}`;
}

// ── graph helpers ────────────────────────────────────────────
async function graph(base, path, token, { method = 'GET', params = {} } = {}) {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const url = `${base}${path}${method === 'GET' ? `?${qs}` : ''}`;
  const res = await fetch(url, method === 'GET' ? {} : {
    method, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: qs,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(body.error || body).slice(0, 220)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function waitFinished(base, id, token, { tries = 20, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const s = await graph(base, `/${id}`, token, { params: { fields: 'status_code,status' } });
    const code = s.status_code || s.status;
    if (code === 'FINISHED') return;
    if (code === 'ERROR') throw new Error(`container ${id} entered ERROR state`);
    await sleep(delayMs);
  }
  throw new Error(`container ${id} not FINISHED after ${tries} checks`);
}

/** Instagram: single image or carousel (2+). Returns the published media id. */
export async function igPublish({ token, imageUrls, caption }) {
  const me = await graph(IG_GRAPH, '/me', token, { params: { fields: 'user_id,username' } });
  const uid = me.user_id || me.id;
  let creationId;
  if (imageUrls.length === 1) {
    const c = await graph(IG_GRAPH, `/${uid}/media`, token, { method: 'POST', params: { image_url: imageUrls[0], caption } });
    creationId = c.id;
  } else {
    const children = [];
    for (const u of imageUrls.slice(0, 10)) {
      const c = await graph(IG_GRAPH, `/${uid}/media`, token, { method: 'POST', params: { image_url: u, is_carousel_item: 'true' } });
      children.push(c.id);
      await sleep(1200);
    }
    const c = await graph(IG_GRAPH, `/${uid}/media`, token, {
      method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), caption },
    });
    creationId = c.id;
  }
  await waitFinished(IG_GRAPH, creationId, token);
  const pub = await graph(IG_GRAPH, `/${uid}/media_publish`, token, { method: 'POST', params: { creation_id: creationId } });
  return { id: pub.id, username: me.username };
}

/**
 * Threads: text with 0, 1, or MANY images (2-20 → carousel). The owner's
 * manual posts were always the full slide set, and his first reaction to the
 * automated single-image post was to ask where the rest went (2026-08-27) —
 * the site's own material guidance says multi-image sets perform best on
 * Threads too. Returns { id, permalink }.
 */
export async function thPublish({ token, text, imageUrls = [] }) {
  let container;
  if (imageUrls.length >= 2) {
    const children = [];
    for (const u of imageUrls.slice(0, 20)) {
      const c = await graph(TH_GRAPH, '/me/threads', token, { method: 'POST', params: { media_type: 'IMAGE', image_url: u, is_carousel_item: 'true' } });
      children.push(c.id);
      await sleep(1200);
    }
    container = await graph(TH_GRAPH, '/me/threads', token, {
      method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), text },
    });
  } else {
    const params = imageUrls[0]
      ? { media_type: 'IMAGE', image_url: imageUrls[0], text }
      : { media_type: 'TEXT', text };
    container = await graph(TH_GRAPH, '/me/threads', token, { method: 'POST', params });
  }
  // Threads docs recommend waiting for server-side processing before publish.
  await waitFinished(TH_GRAPH, container.id, token).catch(() => sleep(15000));
  const pub = await graph(TH_GRAPH, '/me/threads_publish', token, { method: 'POST', params: { creation_id: container.id } });
  const info = await graph(TH_GRAPH, `/${pub.id}`, token, { params: { fields: 'permalink' } }).catch(() => ({}));
  return { id: pub.id, permalink: info.permalink };
}

// ── material helpers (pure, unit-tested) ─────────────────────
/**
 * The writer answers in a fixed frame (A:/KO:/B:/KO:/C:/KO:). Option C is the
 * question form — the format the account's own guidance calls best for
 * Threads, where replies drive distribution. Falls back B → A → raw.
 */
export function pickThreadsOption(threadsPart) {
  const grab = (letter) => {
    const m = String(threadsPart || '').match(new RegExp(`^${letter}:\\s*([\\s\\S]*?)(?=\\n(?:KO|[ABC]|IG):|$)`, 'm'));
    return m ? m[1].trim() : null;
  };
  const en = grab('C') || grab('B') || grab('A');
  if (en) return en;
  return String(threadsPart || '')
    .split('\n').filter((l) => !/^KO:/.test(l)).join(' ').replace(/^[ABC]:\s*/, '').trim().slice(0, 400);
}

/** Threads text = option + article link, hard-capped to the API's 500 chars. */
export function threadsText(option, url) {
  const tail = `\n\n${url}`;
  return option.slice(0, 500 - tail.length) + tail;
}

/** Instagram cadence for a young account: Mon / Wed / Fri (KST). */
export function isIgDay(kstDate = new Date(Date.now() + 9 * 3600e3)) {
  return [1, 3, 5].includes(kstDate.getUTCDay());
}
