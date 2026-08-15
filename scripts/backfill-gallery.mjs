#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  IN-BODY PHOTO RETRY PATROL (weekly)
//
//  The second photo (gallery[0], rendered inside the prose) is attempted
//  exactly ONCE, at publish time, and never again — the hero patrol only
//  cares about posts with NO hero at all. So a landmark like Mui Ne Fishing
//  Village, whose Commons category keeps growing, stays a one-photo page
//  forever because its publish-day attempt happened to fail (owner noticed
//  three such pages in a row, 2026-08-15). Hit rate at publish is ~60-70%;
//  this patrol gives the other third more chances.
//
//  The GATE IS IDENTICAL to generate.mjs's in-body block on purpose —
//  commonsBest (≥1200px, ≥2 cross-check tokens) + venuePhotoCandidates,
//  vision-verified with hedged verdicts rejected ("probably" = no). One
//  correct photo or none; a doubtful second photo is worse than none. Only
//  the RETRY CADENCE is new, never the bar.
//
//    node scripts/backfill-gallery.mjs            # apply, cap GALLERY_LIMIT (default 40)
//    DRY=1 node scripts/backfill-gallery.mjs      # report only
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { commonsBest, tokens } from './lib/commons.mjs';
import { venuePhotoCandidates } from './lib/photo-sources.mjs';
import { verifyGalleryImage } from './lib/vision-check.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const STATE = join(ROOT, 'data', 'gallery-retry.json');
const LIMIT = Number(process.env.GALLERY_LIMIT || 0) || 40;
const DRY = process.env.DRY === '1';
const RETRY_DAYS = 21; // a failed venue rests three weeks before its next try
const VENUE = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

const state = existsSync(STATE) ? JSON.parse(await readFile(STATE, 'utf8')) : {};

// Site-wide image dedup: no photo may appear on two posts. Collect EVERY
// image url (hero + gallery), not just heroes — the second photo must not
// duplicate another post's second photo either.
const usedUrls = new Set();
const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
const candidates = [];
for (const f of files) {
  const raw = await readFile(join(POSTS_DIR, f), 'utf8');
  for (const m of raw.matchAll(/^\s+(?:- )?url:\s*"?([^"\n]+?)"?\s*$/gm)) usedUrls.add(m[1].trim());
  let data;
  try { ({ data } = matter(raw)); } catch { continue; }
  if (data.draft === true || !VENUE.has(data.category)) continue;
  if (!data.heroImage?.url || (data.gallery || []).length) continue;
  if (!data.place?.name) continue; // nothing to anchor a search on
  const last = state[f.replace(/\.md$/, '')]?.lastTried;
  if (last && (Date.now() - Date.parse(last)) < RETRY_DAYS * 864e5) continue;
  candidates.push({ f, data });
}

// Oldest-published first: those have waited longest since their one attempt.
candidates.sort((a, b) => String(a.data.pubDate).localeCompare(String(b.data.pubDate)));

console.log(`${candidates.length} one-photo venue post(s) eligible · trying up to ${LIMIT}${DRY ? ' (dry-run)' : ''}`);
let tried = 0, added = 0;
const wins = [];

for (const { f, data } of candidates) {
  if (tried >= LIMIT) break;
  tried++;
  const slug = f.replace(/\.md$/, '');
  const place = data.place;
  const heroUrl = data.heroImage.url;
  const near = `${data.region}, ${data.country}`;
  const cands = [];
  try {
    const wiki = await commonsBest(`${place.name} ${data.region}`, {
      used: new Set([heroUrl]),
      minWidth: 1200,
      crossCheck: tokens(`${place.name} ${data.region}`),
      minCross: 2,
    });
    if (wiki?.url) cands.push({ ...wiki, license: 'wikimedia' });
  } catch {}
  try {
    for (const c of await venuePhotoCandidates({ name: place.name, lat: place.lat, lng: place.lng, near })) {
      if (c.url && c.url !== heroUrl) cands.push(c);
      if (cands.length >= 4) break;
    }
  } catch {}

  let picked = null;
  for (const c of cands) {
    if (usedUrls.has(c.url)) continue;
    let v;
    try {
      v = await verifyGalleryImage({
        url: c.url, heroUrl, name: place.name,
        category: data.category, region: data.region, country: data.country,
      });
    } catch { continue; }
    // Same hedge rule as publish: an unsure vision verdict is a rejection.
    const hedged = /probabl|plausib|likely|appears to|could be|maybe|possibly/i.test(v?.reason || '');
    if (!v?.ok || hedged) continue;
    const entry = { url: c.url, credit: c.credit, license: c.license, source: c.source };
    if (isImageAllowed(entry)) { picked = { entry, reason: v.reason }; break; }
  }

  state[slug] = { lastTried: new Date().toISOString() };
  if (!picked) { console.log(`  – ${slug}: no candidate cleared the gate`); continue; }

  if (!DRY) {
    // Textual splice keeps the frontmatter byte-stable except the one line —
    // gray-matter round-trips reorder keys and have bitten before.
    const p = join(POSTS_DIR, f);
    const raw = await readFile(p, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const { entry } = picked;
    const yq = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
    const block = ['gallery:', `  - url: ${yq(entry.url)}`, `    credit: ${yq(entry.credit)}`,
      `    license: ${yq(entry.license)}`, `    source: ${yq(entry.source)}`].join(eol);
    let out = raw.replace(/^gallery: \[\]\s*$/m, block);
    if (out === raw) {
      // 153 older posts predate the gallery key entirely (the schema defaults
      // it to []). Anchor on the heroImage line instead — every candidate here
      // is guaranteed one, since hero-less posts are the other patrol's job.
      out = raw.replace(/^heroImage:\s*$/m, `${block}${eol}heroImage:`);
    }
    if (out === raw) { console.log(`  ⚠ ${slug}: no anchor for gallery — left untouched`); continue; }
    await writeFile(p, out, 'utf8');
  }
  // Recorded only after the file actually changed — a splice failure above
  // must read as "not added" so the next run retries it properly.
  state[slug].added = true;
  usedUrls.add(picked.entry.url);
  added++;
  wins.push(`  + ${slug} ← ${picked.reason.slice(0, 60)}`);
  console.log(`  🖼  ${slug}: ${picked.reason.slice(0, 70)}`);
  await new Promise((r) => setTimeout(r, 300));
}

if (!DRY) await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
console.log(`\nGALLERY_PATROL_SUMMARY tried=${tried} added=${added} eligible=${candidates.length}`);

// Telegram (Korean), same pattern as the other patrols: say what happened AND
// what happens next, so the list never reads as a to-do for the owner.
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (!DRY && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && added > 0) {
  const text = `🖼️ Wander Atlas — 본문 사진 주간 순찰\n` +
    `1장짜리 글 ${tried}편 재시도 → ${added}편에 검증 통과한 본문 사진 추가\n` +
    `${wins.slice(0, 10).join('\n')}\n` +
    `나머지는 ${RETRY_DAYS}일 뒤 자동 재시도합니다. 하실 일은 없습니다.`;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  }).catch(() => {});
}
