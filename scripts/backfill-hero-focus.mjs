#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  HERO FOCAL-POINT BACKFILL
//
//  The vision gate now reports WHERE the subject sits (heroImage.focus) for
//  every hero it approves, and the hero frame + card thumbnails crop toward
//  it. That fixes new photos. This fills the point in for the ~1,000 heroes
//  already live, where a portrait cropped centre-on showed The Weeknd's chin,
//  Post Malone's torso and Bruno Mars' headless suit (owner, 2026-08-15:
//  "모든 사진 부분에서 그렇게 되어야지").
//
//  Cost-aware: the vision call goes ONLY where a centre crop can plausibly
//  hurt — portrait/near-square images, and every event hero (performers,
//  athletes: faces). A wide landscape of a beach crops fine from centre and
//  is skipped, with its dimensions recorded so it is never re-fetched.
//  Resumable via data/hero-focus.json (keyed by hero URL).
//
//    node scripts/backfill-hero-focus.mjs              # apply
//    DRY=1 node scripts/backfill-hero-focus.mjs        # measure only, no vision, no writes
//    FOCUS_LIMIT=50 node scripts/backfill-hero-focus.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { politeFetch } from './lib/polite-fetch.mjs';
import { HEAD_BOX_ASK, HEAD_BOX_JSON, focusFromReply, focusYaml } from './lib/head-box.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const STATE = join(ROOT, 'data', 'hero-focus.json');
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.FOCUS_LIMIT || 0) || Infinity;
const UA = 'WanderAtlasBot/1.0 (https://wanderatlasguides.com; hero-focus)';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const state = existsSync(STATE) ? JSON.parse(await readFile(STATE, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHero(url) {
  if (url.startsWith('/')) return readFile(join(ROOT, 'public', url.replace(/^\/+/, '')));
  // Commons throttles bursts with 429 — retry the transient codes instead of
  // counting a throttle as a failed hero (64 of 96 'failures' on 08-19 were 429).
  const r = await politeFetch(url, { headers: { 'user-agent': UA }, tries: 3, baseMs: 4000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function askFocus(buf, subject) {
  // Downscale for the model: 800px is plenty to locate a face, and cheap.
  const small = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  // 200, not 60. The head-box answer (subject + focus + four edges, which the
  // model wraps in a code fence) runs about 74 tokens. At 60 every reply was
  // cut before its closing brace, parsed as nothing, and cached as
  // `focus: null` — "no subject" for The Weeknd, Yunho and Lee Hi alike. A
  // cached URL is never asked again, so each of those portraits was left to a
  // centre crop for good. Reproduced 2026-09-14: 60 → stop max_tokens, null;
  // 200 → end_turn, a correct box.
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 200,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } },
      // Same head-box question as the live gate (lib/head-box.mjs) — two
      // prompts with two wordings is how the point drifted 8–17% low unseen.
      { type: 'text', text: `This photo heads a travel-guide article about ${subject}. ${HEAD_BOX_ASK} Reply ONLY JSON: {${HEAD_BOX_JSON}}` },
    ] }],
  });
  const t = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  // A cut-off reply is a failure to measure, not an answer of "nothing here":
  // throw, so the hero counts as failed and is asked again next run instead of
  // being cached as null (same rule as lib/vision-check.mjs).
  if (msg.stop_reason === 'max_tokens') throw new Error('focus reply truncated at max_tokens');
  const j = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
  return focusFromReply(j);
}

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
let measured = 0, asked = 0, written = 0, skippedWide = 0, failed = 0, done = 0;
for (const f of files) {
  if (done >= LIMIT) break;
  const p = join(POSTS_DIR, f);
  const raw = await readFile(p, 'utf8');
  let parsed; try { parsed = matter(raw); } catch { continue; }
  const d = parsed.data;
  if (d.draft === true || !d.heroImage?.url || d.heroImage.focus) continue;
  const url = String(d.heroImage.url).trim();
  const slug = f.replace(/\.md$/, '');
  let rec = state[url];
  // A cache hit costs nothing — it must not eat the run's work budget.
  // With 600+ already-measured heroes ahead of them alphabetically, the 96
  // still-unmeasured ones sat forever past the LIMIT horizon: FOCUS_LIMIT=200
  // returned measured=0 having 'done' 200 free lookups (2026-08-20).
  const cached = Boolean(rec);
  try {
    if (!rec) {
      const buf = await fetchHero(url);
      const m = await sharp(buf).metadata();
      rec = { w: m.width, h: m.height };
      measured++;
      const isEvent = d.category === 'event';
      const tallish = m.height >= m.width * 0.85; // portrait or near-square
      if ((isEvent || tallish) && client && !DRY) {
        const subject = d.place?.name || d.title;
        // Counted BEFORE the call: a call that throws (a truncated reply) was
        // still paid for, and the summary must say so.
        asked++;
        rec.focus = await askFocus(buf, subject);
        await sleep(200);
      } else if (!isEvent && !tallish) {
        skippedWide++;
      }
      state[url] = rec;
      if (!url.startsWith('/')) await sleep(300);
    }
    if (!cached) done++;
    if (rec.focus && !DRY) {
      // Textual splice: add "  focus:" under heroImage without re-serialising
      // the frontmatter (gray-matter round-trips reorder keys).
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const line = focusYaml(rec.focus, eol);
      // Insert after the heroImage block's last indented line.
      const out = raw.replace(/(^heroImage:\r?\n(?:[ ]{2}.*\r?\n)+?)(?=^[^ \r\n]|^\S)/m, (blk) => blk.replace(/\r?\n$/, '') + eol + line + eol);
      if (out !== raw) { await writeFile(p, out, 'utf8'); written++; }
      else console.log(`  ⚠ ${slug}: could not splice focus`);
    }
    if (!DRY && (measured + done) % 50 === 0) await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
  } catch (e) {
    failed++;
    // A failed uncached hero used this run's budget too. Without this, a
    // reply that keeps truncating skipped `done++`, so FOCUS_LIMIT=25 made 26+
    // paid calls and every later night repeated them (Codex, 2026-09-14).
    if (!cached) done++;
    console.log(`  ⚠ ${slug}: ${e.message.slice(0, 60)}`);
  }
}
// DRY must not write the cache. It used to: a dry run recorded every hero it
// measured as {w,h} with no focus, and since a cached URL is never asked again,
// the next REAL run skipped those event heroes for good — performer photos left
// to a centre crop. Caught 2026-09-14, when one dry run added 93 such records.
if (!DRY) await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
console.log(`\nHERO_FOCUS_SUMMARY measured=${measured} asked=${asked} written=${written} skippedWide=${skippedWide} failed=${failed}${DRY ? ' (dry)' : ''}`);
