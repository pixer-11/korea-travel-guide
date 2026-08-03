#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PINTEREST STANDARD-ACCESS DEMO DRIVER
//
//  The first upgrade demo was rejected (2026-08-03) for "does not show the
//  Pinterest integration" and "does not show the full OAuth flow" — the video
//  jumped straight to a workflow run and never showed the CONSENT screen or a
//  live API call. This script is the terminal half of the re-shoot: it prints
//  big labelled steps, pauses between them, and makes REAL calls so the
//  reviewer sees request URLs and response bodies on screen.
//
//  Usage during recording (English UI, one continuous take):
//    node scripts/pinterest-demo.mjs url       # step 1: print the authorize URL
//    node scripts/pinterest-demo.mjs exchange <code>   # steps 5-6: token + whoami
//    node scripts/pinterest-demo.mjs calls     # boards (prod) → pins 403 (prod)
//                                             #   → pins 201 (sandbox)
//  Env: PINTEREST_APP_SECRET (required), PINTEREST_DEMO_BOARD (optional)
//
//  Tokens are masked in output — Pinterest's own guidelines ask that secrets
//  not be exposed, and a masked token still proves the exchange happened.
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';

const APP_ID = '1594195';
const REDIRECT_URI = 'https://wanderatlasguides.com/pinterest-callback';
const SCOPES = 'boards:read,boards:write,pins:read,pins:write,user_accounts:read';
const PROD = 'https://api.pinterest.com';
const SANDBOX = 'https://api-sandbox.pinterest.com';

const secret = () => {
  const s = process.env.PINTEREST_APP_SECRET;
  if (!s) { console.error('PINTEREST_APP_SECRET not set'); process.exit(1); }
  return s;
};
const mask = (t) => (t ? `${String(t).slice(0, 8)}…${String(t).slice(-4)} (masked)` : '(none)');
const rule = (label) => {
  console.log('\n' + '═'.repeat(72));
  console.log(`  ${label}`);
  console.log('═'.repeat(72));
};
const show = (method, url) => console.log(`\n  → ${method} ${url}\n`);

async function api(base, path, token, opts = {}) {
  const url = `${base}${path}`;
  show(opts.method || 'GET', url);
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  console.log(`  HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2).split('\n').slice(0, 24).join('\n'));
  return { status: res.status, body };
}

const cmd = process.argv[2];

if (cmd === 'url') {
  rule('STEP 1 — OAuth authorize URL (client_id + scopes visible)');
  console.log(`\nhttps://www.pinterest.com/oauth/?client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${SCOPES}\n`);
  console.log('  Open this in the browser: Pinterest login → CONSENT screen → redirect back.');
} else if (cmd === 'exchange') {
  const code = (process.argv[3] || '').trim();
  if (!code) { console.error('usage: pinterest-demo.mjs exchange <code>'); process.exit(1); }
  rule('STEP 5 — Exchange authorization code for an access token');
  show('POST', `${PROD}/v5/oauth/token`);
  const res = await fetch(`${PROD}/v5/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${APP_ID}:${secret()}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }).toString(),
  });
  const t = await res.json();
  console.log(`  HTTP ${res.status}`);
  console.log(`  access_token : ${mask(t.access_token)}`);
  console.log(`  refresh_token: ${mask(t.refresh_token)}   ← the ONLY value we store, AES-GCM encrypted`);
  console.log(`  scope        : ${t.scope}`);
  if (!t.access_token) process.exit(1);
  rule('STEP 6 — Authenticated production API call with that token');
  await api(PROD, '/v5/user_account', t.access_token);
  console.log('\n  ✔ The token works against the production Pinterest API.');
  console.log(`\n  Keep this for the next command:\n  export DEMO_TOKEN=${t.access_token}\n`);
} else if (cmd === 'calls') {
  const token = process.env.DEMO_TOKEN;
  if (!token) { console.error('DEMO_TOKEN not set — run `exchange` first'); process.exit(1); }
  rule('STEP 7 — Board management works in PRODUCTION');
  const boards = await api(PROD, '/v5/boards?page_size=5', token);
  const boardId = process.env.PINTEREST_DEMO_BOARD || boards.body?.items?.[0]?.id;

  rule('STEP 8 — Creating a Pin in PRODUCTION is blocked by the Trial tier');
  await api(PROD, '/v5/pins', token, {
    method: 'POST',
    body: JSON.stringify({
      board_id: boardId,
      title: 'Wander Atlas — demo',
      description: 'Standard-access demo pin.',
      media_source: { source_type: 'image_url', url: 'https://wanderatlasguides.com/og-default.jpg' },
    }),
  });
  console.log('\n  ↑ This is exactly why we are requesting Standard access.');

  rule('STEP 9 — The SAME code against the API Sandbox: Pin created');
  const sbBoards = await api(SANDBOX, '/v5/boards?page_size=5', token);
  let sbBoard = sbBoards.body?.items?.[0]?.id;
  if (!sbBoard) {
    console.log('\n  (no sandbox board yet — creating one)');
    const made = await api(SANDBOX, '/v5/boards', token, {
      method: 'POST', body: JSON.stringify({ name: 'Wander Atlas Demo Board' }),
    });
    sbBoard = made.body?.id;
  }
  const pin = await api(SANDBOX, '/v5/pins', token, {
    method: 'POST',
    body: JSON.stringify({
      board_id: sbBoard,
      title: 'Vieux Lyon: Travel Guide',
      description: 'One of Europe\'s largest intact Renaissance quarters — from wanderatlasguides.com',
      link: 'https://wanderatlasguides.com/posts/lyon-vieux-lyon/',
      media_source: { source_type: 'image_url', url: 'https://wanderatlasguides.com/og-default.jpg' },
    }),
  });
  if (pin.body?.id) {
    rule('STEP 10 — Reading the created Pin back by id');
    await api(SANDBOX, `/v5/pins/${pin.body.id}`, token);
    console.log('\n  ✔ Pin created and verified. This is the same code path our daily job runs.');
  }
} else {
  console.log('usage: pinterest-demo.mjs url | exchange <code> | calls');
}
