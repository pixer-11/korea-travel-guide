#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  HERO WIDTH SCAN — finds LIVE posts whose hero's TRUE pixel width is below
//  Google Discover's 1200px large-card floor (2026-08-03 audit: Fort Aguada
//  ships a 1024×768 og:image because the Wikimedia ORIGINAL is 1024px) and
//  queues them in data/hero-width-queue.json for the nightly patrol, which
//  runs upgrade-hero-width.mjs in QUEUE mode against the due entries.
//
//  This scan never touches a post: a narrow hero is a QUALITY ceiling, not a
//  defect — small hero beats no hero, so nothing here drafts or retires.
//
//  Cheap by construction: probe results are cached per slug+url in the queue
//  file, so a nightly run only network-probes NEW posts and CHANGED heroes
//  (a hero swap changes the url, which misses the cache). A failed probe is
//  not cached — transient network errors must not queue or clear anything.
//
//  Env: DRY=1 (report only). Usage: node scripts/scan-hero-widths.mjs
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import matter from 'gray-matter';
import { probeWidth } from './lib/image-width.mjs';

const POSTS = 'src/content/posts';
const QUEUE_FILE = 'data/hero-width-queue.json';
const MIN_WIDTH = 1200;
const DRY = process.env.DRY === '1';
const CONCURRENCY = 4;
const today = new Date().toISOString().slice(0, 10);

let store;
try {
  store = JSON.parse(await readFile(QUEUE_FILE, 'utf8'));
} catch {
  store = {};
}
if (typeof store.probes !== 'object' || !store.probes) store.probes = {};
if (typeof store.queue !== 'object' || !store.queue) store.queue = {};

const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const targets = [];
const activeSlugs = new Set();
let drafts = 0, noHero = 0;
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  const { data } = matter(await readFile(`${POSTS}/${f}`, 'utf8'));
  // Drafts belong to the mismatch patrol (which may retire them); a queue
  // entry would just make two pipelines fight over one post.
  if (data.draft === true) { drafts++; continue; }
  const url = data.heroImage?.url || '';
  if (!url || url.includes('placeholder')) { noHero++; continue; }
  activeSlugs.add(slug);
  targets.push({ slug, url });
}

let probed = 0, probeFailed = 0, narrow = 0, queuedNew = 0;
const activeKeys = new Set();
let next = 0;
async function worker() {
  while (next < targets.length) {
    const { slug, url } = targets[next++];
    const key = `${slug}\x01${url}`;
    activeKeys.add(key);
    let w = store.probes[key];
    if (w === undefined) {
      w = await probeWidth(url);
      probed++;
      if (w == null) { probeFailed++; activeKeys.delete(key); continue; } // unknown: retry next scan, change nothing
      store.probes[key] = w;
    }
    if (w < MIN_WIDTH) {
      narrow++;
      if (!store.queue[slug]) {
        store.queue[slug] = { width: w, attempts: 0, nextTry: today, flaggedAt: today };
        queuedNew++;
        console.log(`  📐 ${slug}: hero is ${w}px (<${MIN_WIDTH}) — queued for upgrade`);
      } else {
        store.queue[slug].width = w;
      }
    } else if (store.queue[slug]) {
      delete store.queue[slug]; // hero changed/upgraded since it was flagged
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

// Prune: probe cache entries whose slug+url is no longer any live post's hero
// (post retired, hero swapped, post drafted), and queue entries for posts that
// left the live set — the mismatch patrol owns drafts, and retired slugs are gone.
for (const key of Object.keys(store.probes)) {
  if (!activeKeys.has(key)) delete store.probes[key];
}
let removedGone = 0;
for (const slug of Object.keys(store.queue)) {
  if (!activeSlugs.has(slug)) { delete store.queue[slug]; removedGone++; }
}

if (!DRY) {
  store.updated = new Date().toISOString();
  await writeFile(QUEUE_FILE, JSON.stringify(store, null, 1) + '\n', 'utf8');
}

const queueTotal = Object.keys(store.queue).length;
console.log(`\n📦 scanned ${targets.length} live hero(es): ${narrow} below ${MIN_WIDTH}px · ${queuedNew} newly queued · queue now ${queueTotal} · ${probed} probed (${probeFailed} unknown, retry next scan) · ${drafts} drafts + ${noHero} placeholder/no-hero skipped${removedGone ? ` · ${removedGone} stale queue entr(ies) dropped` : ''}`);
console.log(`WIDTH_SCAN_SUMMARY scanned=${targets.length} narrow=${narrow} queued_new=${queuedNew} queue_total=${queueTotal} probe_failed=${probeFailed}`);
