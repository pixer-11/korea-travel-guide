#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  PINTEREST AUTO-PIN — turns published posts into vertical pins.
//  For each not-yet-pinned post (newest first, capped per run):
//   • composes a 1000×1500 vertical pin image with sharp
//     (hero photo + bottom scrim + title + site branding)
//   • finds/creates a per-country board ("Japan Travel Guide")
//   • creates the pin via Pinterest API v5 (image_base64 upload)
//  State lives in data/pinterest.json (boards + pinned slugs) so the
//  daily cron never double-pins. Skips cleanly when no token is set.
//
//  Env: PINTEREST_ACCESS_TOKEN (required to do anything)
//       PINS_PER_RUN (default 8 — steady drip beats blasting a new account)
//       DRY=1  (compose + report, no API calls)
//  Usage: node scripts/pinterest-publish.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';
import { getAccessToken } from './lib/pinterest-token.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const STATE_FILE = join(ROOT, 'data', 'pinterest.json');
const SITE_URL = 'https://wanderatlasguides.com';
// NOTE: the API sandbox (api-sandbox.pinterest.com) requires its own console-
// generated token — our OAuth token 401s there, so there is no sandbox mode.
const API = process.env.PINTEREST_API_BASE || 'https://api.pinterest.com/v5';

// Direct token (secret override) OR the OAuth refresh store (PINTEREST_APP_SECRET
// + data/pinterest-token.enc) — resolved in main().
let TOKEN = process.env.PINTEREST_ACCESS_TOKEN;
const PINS_PER_RUN = Number(process.env.PINS_PER_RUN ?? 8);
const DRY = process.env.DRY === '1';

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${body.message || JSON.stringify(body).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); }
  catch { return { boards: {}, pinned: {} }; }
}

// ── boards ───────────────────────────────────────────────────
async function ensureBoard(country, state) {
  if (state.boards[country]) return state.boards[country];
  const name = `${country} Travel Guide`;
  // One listing call covers all boards (well under the 250 page cap).
  if (!state._boardList) {
    const { items = [] } = await api('/boards?page_size=250');
    state._boardList = items;
  }
  let board = state._boardList.find((b) => b.name === name);
  if (!board) {
    board = await api('/boards', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: `Editor-reviewed ${country} travel guides from Wander Atlas — where to go, what to eat, and when to beat the crowds.`,
        privacy: 'PUBLIC',
      }),
    });
    state._boardList.push(board);
    console.log(`  📌 created board "${name}"`);
  }
  state.boards[country] = board.id;
  return board.id;
}

// ── pin image (1000×1500 vertical — the format Pinterest ranks) ──
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function wrapTitle(title, maxChars = 24, maxLines = 4) {
  const words = String(title).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur + ' ' + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '') + '…';
  }
  return lines;
}

async function composePin(post) {
  let url = post.heroImage.url;
  if (url.startsWith('/')) url = SITE_URL + url; // self-hosted heroes
  // Wikimedia (and friends) reject UA-less requests.
  const res = await fetch(url, { headers: { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' } });
  if (!res.ok) throw new Error(`hero fetch ${res.status}`);
  const heroBuf = Buffer.from(await res.arrayBuffer());

  const W = 1000, H = 1500;
  const base = await sharp(heroBuf).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();

  const lines = wrapTitle(post.title);
  const lineH = 74;
  const textTop = H - 150 - lines.length * lineH;
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.82"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${textTop - 220}" width="${W}" height="${H - textTop + 220}" fill="url(#scrim)"/>
    <text x="60" y="${textTop - 36}" font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="600" fill="#f5d9a8" letter-spacing="4">${esc((post.region + ' · ' + post.country).toUpperCase())}</text>
    ${lines.map((l, i) => `<text x="60" y="${textTop + 30 + i * lineH}" font-family="DejaVu Serif, serif" font-size="62" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join('\n')}
    <text x="60" y="${H - 55}" font-family="DejaVu Sans, sans-serif" font-size="30" fill="#e8e2d5">wanderatlasguides.com</text>
  </svg>`;

  return sharp(base)
    .composite([{ input: Buffer.from(overlay) }])
    .jpeg({ quality: 86 })
    .toBuffer();
}

// ── main ─────────────────────────────────────────────────────
async function main() {
  if (!TOKEN && !DRY && process.env.PINTEREST_APP_SECRET) {
    try {
      TOKEN = await getAccessToken();
    } catch (e) {
      if (e.code === 'ENOENT') {
        console.log('Not connected yet (no data/pinterest-token.enc) — run the "Pinterest 연결" workflow first.');
      } else {
        console.log(`Token refresh failed: ${e.message}`);
        console.log('PIN_AUTH_FAILED');
      }
      console.log('PIN_SUMMARY new=0 total=0');
      return;
    }
  }
  if (!TOKEN && !DRY) {
    console.log('No Pinterest credentials set — skipping (nothing pinned).');
    console.log('PIN_SUMMARY new=0 total=0');
    return;
  }

  const state = await loadState();
  const today = new Date().toISOString().slice(0, 10);

  // New-account ramp (owner-approved 2026-08-02): Pinterest's spam systems
  // watch a fresh account's pin RATE, and the community-measured safe pattern
  // is a handful a day growing over weeks — accounts that start blasting on
  // day one of API access get suspended. The workflow runs twice a day
  // (morning/evening KST), so the per-run cap is half the daily budget,
  // derived from how many pins this account has ever made: 2/day until 14,
  // then 4/day, 6/day, and only past 80 pins the full 8. An explicit
  // PINS_PER_RUN env (manual dispatch) still overrides.
  const everPinned = Object.keys(state.pinned || {}).length;
  const rampPerRun = everPinned < 14 ? 1 : everPinned < 40 ? 2 : everPinned < 80 ? 3 : 4;
  const perRun = process.env.PINS_PER_RUN ? PINS_PER_RUN : rampPerRun;

  const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const f of files) {
    const slug = f.replace(/\.md$/, '');
    if (state.pinned[slug]) continue;
    try {
      const { data } = matter(await readFile(join(POSTS_DIR, f), 'utf8'));
      if (!data.title || !data.heroImage?.url || data.draft) continue;
      // Pinning a finished event sends people to something they can't attend.
      if (data.eventEndDate && String(data.eventEndDate).slice(0, 10) < today) continue;
      posts.push({ slug, ...data });
    } catch {}
  }
  // Season-ahead boost (growth research B4, 2026-08-13): Pinterest search
  // momentum builds MONTHS before an event — travel bloggers' measured wins
  // came from pinning seasonal content a season early, and events are this
  // site's impression engine (80% of GSC impressions). An event starting 30 to
  // 150 days out jumps the queue; too soon (<30d) misses Pinterest's indexing
  // lag, too far (>150d) outruns searcher intent. Everything else keeps
  // newest-first, and the finished-event guard above still applies.
  const seasonScore = (p) => {
    const start = String(p.eventStartDate || '').slice(0, 10);
    if (!start) return 0;
    const days = (new Date(start) - new Date(today)) / 864e5;
    return days >= 30 && days <= 150 ? 1 : 0;
  };
  posts.sort((a, b) => seasonScore(b) - seasonScore(a) || String(b.pubDate).localeCompare(String(a.pubDate)));
  const batch = posts.slice(0, perRun);

  console.log(`\n📌 Pinterest — ${posts.length} unpinned post(s), pinning ${batch.length} this run${DRY ? ' (DRY)' : ''}\n`);

  let done = 0, failed = 0, authFailed = false, trialBlocked = false;
  for (const post of batch) {
    try {
      const img = await composePin(post);
      if (DRY) { console.log(`  · would pin ${post.slug} (${(img.length / 1024).toFixed(0)}KB)`); done++; continue; }

      const boardId = await ensureBoard(post.country, state);
      const link = `${SITE_URL}/posts/${post.slug}/`;
      const description = `${post.description || post.title}`.slice(0, 460) +
        ` | ${post.region}, ${post.country} — full guide on Wander Atlas.`;
      const pin = await api('/pins', {
        method: 'POST',
        body: JSON.stringify({
          board_id: boardId,
          title: String(post.title).slice(0, 100),
          description: description.slice(0, 500),
          alt_text: `${post.title} — ${post.region}, ${post.country}`.slice(0, 500),
          link,
          media_source: { source_type: 'image_base64', content_type: 'image/jpeg', data: img.toString('base64') },
        }),
      });
      state.pinned[post.slug] = pin.id;
      done++;
      console.log(`  ✅ ${post.slug} → pin ${pin.id}`);
    } catch (err) {
      failed++;
      console.log(`  ⚠️  ${post.slug} — ${err.message}`);
      // Trial apps can't create production pins at all — NOT a token problem.
      // Stop quietly; the workflow reports it as "waiting on Standard access".
      if (/Trial access/i.test(err.message)) { trialBlocked = true; break; }
      if (err.status === 401 || err.status === 403) { authFailed = true; break; } // token dead — stop, alert
      if (err.status === 429) { console.log('  ⏸  rate-limited — stopping this run.'); break; }
    }
  }

  delete state._boardList;
  if (!DRY) await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');

  const total = Object.keys(state.pinned).length;
  console.log(`\n📦 ${done} pinned · ${failed} failed · ${total} total pins\n`);
  if (authFailed) console.log('PIN_AUTH_FAILED'); // workflow turns this into a Korean Telegram alert
  if (trialBlocked) console.log('PIN_TRIAL_BLOCKED');
  console.log(`PIN_SUMMARY new=${done} total=${total}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
