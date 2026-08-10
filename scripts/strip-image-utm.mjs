// ─────────────────────────────────────────────────────────────
//  STRIP IMAGE UTM — the tracking tail that made 55% of our photos vanish.
//
//  Wikimedia's imageinfo API hands back thumbnail URLs with its own campaign
//  tail attached:
//    …/1920px-Foo.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo
//                     &utm_content=thumbnail
//  We stored that string verbatim, so 477 of 860 guides pointed their hero at a
//  URL carrying utm_source/utm_campaign/utm_content. Content blockers treat
//  those three parameters as tracking and cancel the REQUEST — the image is
//  fine, the server answers 200 to curl, and the reader still sees an empty
//  box. Body photos, which never carried the tail, kept loading on the same
//  page: that split is what identified the cause (2026-08-10, owner reported
//  "사진이 깨지는 곳들이 한두군데가 아니다").
//
//  The tail is decorative — Wikimedia serves the identical file without it —
//  so it is stripped everywhere it was persisted, and commons.mjs now removes
//  it at the source so nothing re-introduces it.
//
//  Two side files key on the image URL, and BOTH must be rewritten in the same
//  pass or the repair quietly costs something:
//    data/visual-audit.json  — "slug\x01url" → photo verdict. Orphaned keys read
//                              as "never checked", so the nightly patrol would
//                              re-roll photos a human already approved (and
//                              MISMATCH verdicts, which exist to STOP a bad
//                              photo coming back, would stop applying).
//    data/og-mirror.json     — original URL → mirrored R2 object. Orphaned keys
//                              mean re-uploading images already in the bucket.
//
//    node scripts/strip-image-utm.mjs          # apply
//    node scripts/strip-image-utm.mjs --dry    # report only
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DRY = process.argv.includes('--dry');

// Both observed variants (…=thumbnail and …=thumbnail_unscaled), and tolerant
// of the parameters arriving in another order or with only some of them
// present. Anchored at the '?' so it can only ever remove a whole query, never
// bite into the path — a half-eaten URL would break the image for everyone
// rather than just for blocker users.
const UTM_RE = /\?utm_source=commons\.wikimedia\.org(?:&utm_[a-z]+=[A-Za-z0-9_.-]*)*/g;

export const stripUtm = (s) => String(s).replace(UTM_RE, '');

let files = 0, hits = 0;

// ── 1) posts ──────────────────────────────────────────────────
const DIR = 'src/content/posts';
for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.md')) continue;
  const p = join(DIR, f);
  const before = readFileSync(p, 'utf8');
  const after = stripUtm(before);
  if (after === before) continue;
  const n = (before.match(UTM_RE) || []).length;
  files++; hits += n;
  if (!DRY) writeFileSync(p, after);
}
console.log(`posts: ${hits} tracking tail(s) removed across ${files} file(s)`);

// ── 2) URL-keyed side files ───────────────────────────────────
// Normalising keys COLLIDES: the same photo was audited twice, once under each
// spelling of its URL, and all 254 collisions in visual-audit.json disagree.
// Picking naively would silently drop verdicts, so two rules decide:
//
//   1. MISMATCH always wins. That verdict exists to keep a wrong photo from
//      being re-applied by the nightly patrol; losing one re-opens the door,
//      while keeping one only costs a re-audit. Asymmetric risk, asymmetric
//      rule.
//   2. Otherwise the newer `at` wins — it saw the photo most recently.
const rank = (v) => (v && v.verdict === 'MISMATCH' ? 1 : 0);
const newer = (a, b) => (Date.parse(b?.at ?? 0) || 0) > (Date.parse(a?.at ?? 0) || 0);
function pick(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  return newer(a, b) ? b : a;
}

// region-covers (the photo behind every region tile) and hero-width-queue are
// plain value stores, so the merge rules above are moot — but they hold the
// same URLs and the same blocked requests, which is why they are in the list.
for (const file of ['data/region-covers.json', 'data/hero-width-queue.json']) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, 'utf8');
  const after = stripUtm(before);
  const n = (before.match(UTM_RE) || []).length;
  console.log(`${file}: ${n} tracking tail(s) removed`);
  if (!DRY && after !== before) writeFileSync(file, after);
}

for (const file of ['data/visual-audit.json', 'data/og-mirror.json']) {
  if (!existsSync(file)) continue;
  const obj = JSON.parse(readFileSync(file, 'utf8'));
  const out = {};
  let moved = 0, merged = 0, mismatchKept = 0;
  for (const [k, v] of Object.entries(obj)) {
    const nk = stripUtm(k);
    if (nk !== k) moved++;
    if (nk in out) {
      merged++;
      const win = pick(out[nk], v);
      if (rank(win)) mismatchKept++;
      out[nk] = win;
    } else {
      out[nk] = v;
    }
  }
  const before = Object.keys(obj).length;
  console.log(`${file}: ${moved} key(s) normalised, ${merged} collision(s) merged (${mismatchKept} resolved as MISMATCH), ${Object.keys(out).length} kept (was ${before})`);
  if (!DRY) writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
}

// A MISMATCH lost here is a wrong photo free to come back, so the count is
// checked rather than trusted.
if (existsSync('data/visual-audit.json')) {
  const before = JSON.parse(readFileSync('data/visual-audit.json', 'utf8'));
  const n = Object.values(before).filter((v) => v?.verdict === 'MISMATCH').length;
  console.log(`MISMATCH verdicts now on file: ${n}`);
}

if (DRY) console.log('(dry run — nothing written)');
