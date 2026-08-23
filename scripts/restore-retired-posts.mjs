#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  RESTORE RETIRED POSTS AS PHOTO-HELD DRAFTS
//
//  2026-07-26 retired 92 "photo-unfixable" venues: files deleted, old URLs
//  301'd to their region hubs. Four weeks later Google still ranks 23 of
//  those URLs in its top 10 (Vandal Lombok at #2, Yemeni Corner Ajman #9,
//  Haesong Ssambap #5.5 …) and 46 of them drew 248 impressions — 8% of every
//  post impression the site got — each click landing on a city hub instead
//  of the restaurant the searcher typed (found 2026-08-23 while hunting
//  "top-10 pages with 0 clicks": they had 0 clicks because they were gone).
//
//  The photo pipeline that failed them predates Foursquare venue photos
//  (08-07), the phrase/venue searches and the nine gate repairs of 08-23. So:
//  put the post back from the commit before retirement, as a DRAFT with no
//  hold reason — exactly the shape the nightly photo patrol targets — with
//  its four translations, and take it off the retired list (a draft's URL
//  still 301s to the hub via astro.config's drafts loop, so nothing 404s).
//  The night the patrol finds a photo, the page is live again at the URL
//  Google already ranks.
//
//    node scripts/restore-retired-posts.mjs slug-a,slug-b [--from=0a3bf776^] [--dry]
// ─────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const FROM = arg('from') || '0a3bf776^';
const DRY = process.argv.includes('--dry');
const slugs = (process.argv[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!slugs.length) { console.error('usage: node scripts/restore-retired-posts.mjs slug-a,slug-b [--from=REV] [--dry]'); process.exit(1); }

const show = (path) => {
  try { return execFileSync('git', ['show', `${FROM}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); }
  catch { return null; }
};
/** The file as it was, with draft forced true and no hold reason: a photo patrol target. */
export function asPhotoHeldDraft(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  let out = src.replace(/^heldReason:.*\r?\n/m, '');
  if (/^draft:\s*\S+/m.test(out)) out = out.replace(/^draft:\s*\S+.*$/m, 'draft: true');
  else out = out.replace(/^(pubDate:.*)(\r?\n)/m, (m, a, b) => `${a}${b}draft: true${eol}`);
  return out;
}

const RETIRED = join(ROOT, 'data', 'retired-posts.json');
const RETRY = join(ROOT, 'data', 'photo-retry.json');
const retired = JSON.parse(readFileSync(RETIRED, 'utf8'));
const retry = existsSync(RETRY) ? JSON.parse(readFileSync(RETRY, 'utf8')) : {};
let restored = 0, translations = 0, skipped = 0;
const keep = [];
for (const slug of slugs) {
  const en = show(`src/content/posts/${slug}.md`);
  if (!en) { console.log(`  ✗ ${slug}: not in ${FROM}`); skipped++; continue; }
  const dest = join(ROOT, 'src', 'content', 'posts', `${slug}.md`);
  if (existsSync(dest)) { console.log(`  · ${slug}: already on disk`); skipped++; continue; }
  let tl = 0;
  const files = [[dest, asPhotoHeldDraft(en)]];
  for (const lang of ['ko', 'ja', 'es', 'zh']) {
    const t = show(`src/content/i18n/${lang}/${slug}.md`);
    if (t) { files.push([join(ROOT, 'src', 'content', 'i18n', lang, `${slug}.md`), t]); tl++; }
  }
  if (!DRY) {
    for (const [p, body] of files) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body, 'utf8'); }
    delete retry[slug];
  }
  restored++; translations += tl;
  console.log(`  ✓ ${slug}: draft restored + ${tl} translations${retired.some((r) => r.slug === slug) ? ', off the retired list' : ''}`);
}
if (!DRY) {
  const wanted = new Set(slugs);
  writeFileSync(RETIRED, JSON.stringify(retired.filter((r) => !wanted.has(r.slug)), null, 1) + '\n');
  writeFileSync(RETRY, JSON.stringify(retry, null, 1) + '\n');
}
console.log(`\nRESTORE_SUMMARY restored=${restored} translations=${translations} skipped=${skipped}${DRY ? ' (dry)' : ''}`);
