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
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function askFocus(buf, subject) {
  // Downscale for the model: 800px is plenty to locate a face, and cheap.
  const small = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 60,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } },
      { type: 'text', text: `This photo heads a travel-guide article about ${subject}. Where is the FOCAL POINT a viewer must see — a person's FACE, the landmark's most recognisable part, the dish? Give x,y as percentages from the top-left (0-100). If it is a landscape with no single subject, answer 50,50. Reply ONLY JSON: {"x":<0-100>,"y":<0-100>}` },
    ] }],
  });
  const t = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const j = JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? 'null');
  const p = (v) => (Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Math.round(Number(v)))) : null);
  const x = p(j?.x), y = p(j?.y);
  return x != null && y != null ? { x, y } : null;
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
        rec.focus = await askFocus(buf, subject);
        asked++;
        await sleep(200);
      } else if (!isEvent && !tallish) {
        skippedWide++;
      }
      state[url] = rec;
      if (!url.startsWith('/')) await sleep(300);
    }
    done++;
    if (rec.focus && !DRY) {
      // Textual splice: add "  focus:" under heroImage without re-serialising
      // the frontmatter (gray-matter round-trips reorder keys).
      const eol = raw.includes('\r\n') ? '\r\n' : '\n';
      const line = `  focus:${eol}    x: ${rec.focus.x}${eol}    y: ${rec.focus.y}`;
      // Insert after the heroImage block's last indented line.
      const out = raw.replace(/(^heroImage:\r?\n(?:[ ]{2}.*\r?\n)+?)(?=^[^ \r\n]|^\S)/m, (blk) => blk.replace(/\r?\n$/, '') + eol + line + eol);
      if (out !== raw) { await writeFile(p, out, 'utf8'); written++; }
      else console.log(`  ⚠ ${slug}: could not splice focus`);
    }
    if ((measured + done) % 50 === 0) await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
  } catch (e) {
    failed++;
    console.log(`  ⚠ ${slug}: ${e.message.slice(0, 60)}`);
  }
}
await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
console.log(`\nHERO_FOCUS_SUMMARY measured=${measured} asked=${asked} written=${written} skippedWide=${skippedWide} failed=${failed}${DRY ? ' (dry)' : ''}`);
