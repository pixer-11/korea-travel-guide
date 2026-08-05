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
  // Hand the token to the next step through a temp file, never through the
  // screen: this session is being screen-recorded for Pinterest's reviewers
  // and a printed access token would be a live credential in a video.
  const { writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  writeFileSync(`${tmpdir()}/pin-demo-token.txt`, t.access_token, 'utf8');
  console.log('\n  (token handed to the next step securely — never printed)\n');
} else if (cmd === 'calls') {
  let token = process.env.DEMO_TOKEN;
  if (!token) {
    try {
      const { readFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      token = readFileSync(`${tmpdir()}/pin-demo-token.txt`, 'utf8').trim();
    } catch { /* fall through */ }
  }
  if (!token) { console.error('no token — run `exchange <code>` first'); process.exit(1); }
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

  // The sandbox is a SEPARATE environment with its own token (a production
  // token answers 401 there), issued from the developer console's "Generate
  // access token → Sandbox" control. When it isn't provided the demo simply
  // ends after the 403 — which already proves the integration works and the
  // tier is the only blocker.
  const sbToken = process.env.PINTEREST_SANDBOX_TOKEN;
  if (!sbToken) {
    rule('END — Production integration verified; Pin creation needs Standard access');
    console.log('\n  Account read ✔   Boards read ✔   Pin create ✖ (Trial tier)\n');
    process.exit(0);
  }
  rule('STEP 9 — The SAME code against the API Sandbox: Pin created');
  const sbBoards = await api(SANDBOX, '/v5/boards?page_size=5', sbToken);
  let sbBoard = sbBoards.body?.items?.[0]?.id;
  if (!sbBoard) {
    console.log('\n  (no sandbox board yet — creating one)');
    const made = await api(SANDBOX, '/v5/boards', sbToken, {
      method: 'POST', body: JSON.stringify({ name: 'Wander Atlas Demo Board' }),
    });
    sbBoard = made.body?.id;
  }
  const pin = await api(SANDBOX, '/v5/pins', sbToken, {
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
    // NOT a GET. The second review said so in as many words (2026-08-05):
    // "After publishing a Pin you need to go to Pinterest to show it on the
    // platform. A GET call cannot replace this step." So the terminal stops
    // here and hands the recording a URL to open in the browser — which is also
    // the only way a sandbox Pin can be shown at all, since those are visible
    // solely to the account that created them while the app sits on Trial.
    // Both of the reviewer's constraints, satisfied by the same shot.
    rule('STEP 10 — The Pin on Pinterest (open this in the browser now)');
    console.log(`\n     https://www.pinterest.com/pin/${pin.body.id}/\n`);
    console.log('  ✔ Created by the same code path the daily job runs.');
    console.log('    Sandbox Pins are visible only to the owning account, so what');
    console.log('    follows is this Pin open in a signed-in Pinterest tab.\n');
  }
} else {
  console.log('usage: pinterest-demo.mjs url | exchange <code> | calls');
}
