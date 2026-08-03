#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  FOURSQUARE CDN LIVENESS — 362 fastly.4sqi.net hotlinks across ~290 posts
//  are one CDN policy change away from silent link-rot (the older irs0/irs3
//  subdomains DID die this way), and nothing was watching. Weekly HEAD-check
//  of every 4sqi hero/gallery URL:
//
//    • dead HERO  → recorded as a MISMATCH in data/visual-audit.json (the
//      exact store the nightly alt-photos patrol reads), so the post rides
//      the existing vision-gated photo-replacement pipeline — same treatment
//      as a vision reject. The patrol's current-hero recheck fetches the dead
//      URL, gets "image unusable: image fetch 404" (NOT the outage pattern),
//      and proceeds to replace. Nothing is unpublished here.
//    • dead GALLERY entry → removed from the post immediately (a post with
//      one real photo is an allowed layout; gallery backfill can refill).
//
//  "Dead" is deliberately hard to earn — NEVER over a transient error:
//    • only a second, independent GET confirming a 4xx counts; 5xx / 429 /
//      timeouts / network errors are transient and just wait for next week.
//    • circuit breaker: if ≥10 URLs AND >30% of all checked URLs look dead,
//      that is a CDN-wide event (outage or hotlink-policy change), not rot —
//      flag NOTHING, report it for a human decision.
//
//  Env: DRY=1 (report only). Output: FSQ_HEALTH_SUMMARY line for the weekly
//  refresh workflow's Korean Telegram report.
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const POSTS = 'src/content/posts';
const AUDIT_FILE = 'data/visual-audit.json';
const DRY = process.env.DRY === '1';
const CONCURRENCY = 4;
const UA = { 'User-Agent': 'WanderAtlasBot/1.0 (https://wanderatlasguides.com)' };

const is4sqi = (url) => {
  try { return /(^|\.)4sqi\.net$/.test(new URL(url).hostname); } catch { return false; }
};

// Collect every 4sqi URL in hero + gallery positions, drafts included (a dead
// hero on a draft still blocks its republish path — flag it the same way).
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const items = []; // { slug, url, kind: 'hero' | 'gallery' }
for (const f of files) {
  const slug = f.replace(/\.md$/, '');
  const { data } = matter(await readFile(`${POSTS}/${f}`, 'utf8'));
  const hero = data.heroImage?.url || '';
  if (is4sqi(hero)) items.push({ slug, url: hero, kind: 'hero' });
  for (const g of Array.isArray(data.gallery) ? data.gallery : []) {
    if (g?.url && is4sqi(g.url)) items.push({ slug, url: g.url, kind: 'gallery' });
  }
}
console.log(`🔗 ${items.length} Foursquare CDN URL(s) across hero/gallery slots — checking (≤${CONCURRENCY} concurrent)…`);

async function fetchStatus(url, method) {
  try {
    const res = await fetch(url, {
      method, headers: { ...UA, ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) },
      redirect: 'follow', signal: AbortSignal.timeout(15000),
    });
    return res.status;
  } catch {
    return 0; // network error / timeout → transient
  }
}

// ok | dead (double-confirmed 4xx) | transient (proves nothing this week)
async function classify(url) {
  const head = await fetchStatus(url, 'HEAD');
  if (head >= 200 && head < 300) return { state: 'ok', status: head };
  if (head >= 400 && head < 500 && head !== 429) {
    const get = await fetchStatus(url, 'GET'); // some CDNs mishandle HEAD — confirm independently
    if (get >= 200 && get < 300) return { state: 'ok', status: get };
    if (get >= 400 && get < 500 && get !== 429) return { state: 'dead', status: get };
  }
  return { state: 'transient', status: head };
}

let next = 0;
const results = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < items.length) {
    const item = items[next++];
    const r = await classify(item.url);
    results.push({ ...item, ...r });
    if (r.state !== 'ok') console.log(`  ${r.state === 'dead' ? '💀' : '⏳'} ${item.slug} (${item.kind}): HTTP ${r.status || 'network-error'}`);
  }
}));

const dead = results.filter((r) => r.state === 'dead');
const transient = results.filter((r) => r.state === 'transient');
const outage = dead.length >= 10 && dead.length / Math.max(results.length, 1) > 0.3;

let heroFlagged = 0, galleryRemoved = 0;
if (outage) {
  console.log(`\n🚨 ${dead.length}/${results.length} URLs dead — that is a CDN-wide event, not link-rot. Flagging NOTHING; needs a human look (self-hosting migration?).`);
} else if (dead.length && !DRY) {
  // Dead heroes → the patrol's queue, keyed exactly as visual-audit.mjs keys
  // its verdicts (slug\x01url) so backfill-photos-alt.mjs treats it as a
  // current-hero MISMATCH and replaces through the vision gate.
  const audit = existsSync(AUDIT_FILE) ? JSON.parse(await readFile(AUDIT_FILE, 'utf8')) : {};
  let auditDirty = false;
  for (const d of dead.filter((r) => r.kind === 'hero')) {
    const key = `${d.slug}\x01${d.url}`;
    if ((audit[key]?.verdict || '').toUpperCase().includes('MISMATCH')) continue; // already queued
    audit[key] = { slug: d.slug, verdict: 'MISMATCH', reason: `Foursquare CDN link dead (HTTP ${d.status})`, at: new Date().toISOString() };
    auditDirty = true;
    heroFlagged++;
    console.log(`  🛠️  ${d.slug}: dead hero queued for the nightly photo-replacement patrol`);
  }
  if (auditDirty) await writeFile(AUDIT_FILE, JSON.stringify(audit, null, 1) + '\n', 'utf8');

  // Dead gallery entries → drop in place. Same serialization as every other
  // frontmatter writer in this repo (lineWidth -1, keys unsorted).
  const bySlug = new Map();
  for (const d of dead.filter((r) => r.kind === 'gallery')) {
    if (!bySlug.has(d.slug)) bySlug.set(d.slug, new Set());
    bySlug.get(d.slug).add(d.url);
  }
  for (const [slug, urls] of bySlug) {
    const path = `${POSTS}/${slug}.md`;
    const { data, content } = matter(await readFile(path, 'utf8'));
    if (!Array.isArray(data.gallery)) continue;
    const kept = data.gallery.filter((g) => !urls.has(g?.url));
    if (kept.length === data.gallery.length) continue;
    galleryRemoved += data.gallery.length - kept.length;
    if (kept.length) data.gallery = kept;
    else delete data.gallery;
    await writeFile(path, `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
    console.log(`  🧹 ${slug}: removed ${urls.size} dead gallery photo(s)`);
  }
} else if (dead.length && DRY) {
  console.log(`  (DRY) would flag ${dead.filter((r) => r.kind === 'hero').length} hero(es) and remove ${dead.filter((r) => r.kind === 'gallery').length} gallery photo(s)`);
}

console.log(`\n📦 checked ${results.length}: ${results.length - dead.length - transient.length} ok · ${dead.length} dead · ${transient.length} transient (recheck next week) · ${heroFlagged} hero(es) queued · ${galleryRemoved} gallery photo(s) removed${outage ? ' · OUTAGE SUSPECTED — nothing flagged' : ''}`);
console.log(`FSQ_HEALTH_SUMMARY checked=${results.length} dead=${dead.length} transient=${transient.length} heroflagged=${heroFlagged} galleryremoved=${galleryRemoved} outage=${outage ? 1 : 0}`);
