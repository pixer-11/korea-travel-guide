#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RE-MEASURE HERO FOCUS AS A HEAD BOX
//
//  Every hero focused before 2026-08-23 carries a single point, and that
//  point sat 8–17% below the face. The card crop's window absorbs the error
//  on ordinary portraits; on very tall ones (an upright 16:9 phone photo,
//  ratio ≥ 1.6) it can cut the chin. This asks the head-box question again
//  for those heroes only — new photos get the box at birth from the gate —
//  and writes top/bottom next to the point. The next build-wall run sees the
//  'v3:' crop key and re-cuts just these thumbnails.
//
//    node scripts/remeasure-hero-focus.mjs                 # ratio ≥ 1.6, no box yet
//    MIN_RATIO=1.4 node scripts/remeasure-hero-focus.mjs   # widen the net
//    node scripts/remeasure-hero-focus.mjs slug-a,slug-b   # named posts, any ratio
//    DRY=1 …                                               # ask, print, write nothing
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import sharp from 'sharp';
import Anthropic from '@anthropic-ai/sdk';
import { politeFetch } from './lib/polite-fetch.mjs';
import { HEAD_BOX_ASK, HEAD_BOX_JSON, focusFromReply, hasBox, spliceFocus } from './lib/head-box.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const STATE = join(ROOT, 'data', 'hero-focus.json');
const DRY = process.env.DRY === '1';
const MIN_RATIO = Number(process.env.MIN_RATIO || 1.6);
const ONLY = new Set((process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean));
const UA = 'WanderAtlasBot/1.0 (https://wanderatlasguides.com; hero-focus)';
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing — refusing to guess a head box'); process.exit(1); }
const client = new Anthropic();
const state = existsSync(STATE) ? JSON.parse(await readFile(STATE, 'utf8')) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHero(url) {
  if (url.startsWith('/')) return readFile(join(ROOT, 'public', url.replace(/^\/+/, '')));
  const r = await politeFetch(url, { headers: { 'user-agent': UA }, tries: 3, baseMs: 4000 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function askHeadBox(buf, subject) {
  const small = await sharp(buf).resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 120,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: small.toString('base64') } },
      { type: 'text', text: `This photo heads a travel-guide article about ${subject}. ${HEAD_BOX_ASK} Reply ONLY JSON: {${HEAD_BOX_JSON}}` },
    ] }],
  });
  const t = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return focusFromReply(JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? 'null'));
}

const files = (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'));
let candidates = 0, asked = 0, written = 0, noBox = 0, failed = 0;
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  if (ONLY.size && !ONLY.has(slug)) continue;
  const p = join(POSTS_DIR, f);
  const raw = await readFile(p, 'utf8');
  let d; try { d = matter(raw).data; } catch { continue; }
  if (d.draft === true || !d.heroImage?.url) continue;
  const url = String(d.heroImage.url).trim();
  const rec = state[url];
  if (!ONLY.size) {
    if (!rec?.w || !rec?.h || rec.h / rec.w < MIN_RATIO) continue;
    if (hasBox(d.heroImage.focus)) continue;
  }
  candidates++;
  try {
    const buf = await fetchHero(url);
    const subject = d.place?.name || d.title;
    const focus = await askHeadBox(buf, subject);
    asked++;
    const ratio = rec?.h && rec?.w ? (rec.h / rec.w).toFixed(2) : '?';
    const cur = d.heroImage.focus || null;
    const was = cur ? `${cur.x},${cur.y}${hasBox(cur) ? ` head ${cur.top}-${cur.bottom}` : ''}` : 'none';
    if (!focus) { noBox++; console.log(`  · ${slug} (${ratio}): unusable reply — kept ${was}`); continue; }
    if (!hasBox(focus)) {
      // Not a person: the reply is a fresh focal point with the old meaning.
      // Written only when it moves — a same-value rewrite would re-cut nothing.
      noBox++;
      if (cur && cur.x === focus.x && cur.y === focus.y && !hasBox(cur)) { console.log(`  · ${slug} (${ratio}): not a person, point unchanged ${was}`); continue; }
      console.log(`  ○ ${slug} (${ratio}): not a person — point ${focus.x},${focus.y} (was ${was})`);
    } else {
      console.log(`  ✓ ${slug} (${ratio}): head ${focus.top}-${focus.bottom}% (centre ${focus.y}) — was ${was}`);
    }
    if (DRY) continue;
    const out = spliceFocus(raw, focus);
    if (!out) { console.log(`  ⚠ ${slug}: could not splice focus`); failed++; continue; }
    await writeFile(p, out, 'utf8');
    state[url] = { ...(rec || {}), focus };
    written++;
    await sleep(250);
  } catch (e) {
    failed++;
    console.log(`  ⚠ ${slug}: ${e.message.slice(0, 80)}`);
  }
}
if (!DRY && written) await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
console.log(`\nHEAD_BOX_SUMMARY candidates=${candidates} asked=${asked} written=${written} noBox=${noBox} failed=${failed}${DRY ? ' (dry)' : ''}`);
