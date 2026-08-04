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
import yaml from 'js-yaml';
import { probeWidth } from './lib/image-width.mjs';

const POSTS = 'src/content/posts';
const QUEUE_FILE = 'data/hero-width-queue.json';
const AUDIT_FILE = 'data/visual-audit.json';
const MIN_WIDTH = 1200;
// Below this a hero is not "small", it is broken. The Shenzhen tennis guide
// shipped a 152×219 portrait as its hero (2026-08-04) — stretched across a
// full-width banner that is a smear, not a photograph. "Small hero beats no
// hero" holds down to roughly a phone's width; past that the page looks
// defective, so these are handed to the alt-photo patrol as mismatches and
// taken off the site until it finds a real one, exactly like a wrong photo.
const UNUSABLE_WIDTH = 640;
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
const unusable = [];
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
    if (w < UNUSABLE_WIDTH) {
      unusable.push({ slug, url, w });
      narrow++;
    } else if (w < MIN_WIDTH) {
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

// A hero too small to render is handed to the alt-photo patrol the same way a
// wrong photo is: recorded as a MISMATCH in the audit store (which
// backfill-photos-alt.mjs drains) and taken off the site until a real photo
// arrives. Drafting it here rather than leaving it live is deliberate — the
// "small hero beats no hero" rule assumes the picture is at least legible, and
// a 152px banner is not. It also keeps validate-content's UNQUARANTINED-MISMATCH
// rule true: a MISMATCH on record must never be a published page.
if (unusable.length && !DRY) {
  let audit = {};
  try { audit = JSON.parse(await readFile(AUDIT_FILE, 'utf8')); } catch { /* first run */ }
  for (const u of unusable) {
    audit[`${u.slug}\x01${u.url}`] = {
      slug: u.slug,
      verdict: 'MISMATCH',
      reason: `hero is only ${u.w}px wide — unusable as a banner`,
      reasonKo: `사진이 ${u.w}px로 너무 작음`,
      at: new Date().toISOString(),
    };
    const path = `${POSTS}/${u.slug}.md`;
    const { data, content } = matter(await readFile(path, 'utf8'));
    if (data.draft !== true) {
      data.draft = true;
      await writeFile(path, `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
    }
    delete store.queue[u.slug]; // the patrol owns it now, not the width queue
    console.log(`  🚫 ${u.slug}: hero is ${u.w}px (<${UNUSABLE_WIDTH}) — quarantined for photo replacement`);
  }
  await writeFile(AUDIT_FILE, JSON.stringify(audit, null, 1) + '\n', 'utf8');
}

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
