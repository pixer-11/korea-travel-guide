#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  WIKIMEDIA HERO URL NORMALISER
//
//  Two defects found on 2026-08-04, both invisible in the markdown:
//
//  1. TRACKING QUERY. The Commons API hands back image URLs carrying
//     `?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=…`
//     and 24 posts stored them verbatim. That string then rides into og:image,
//     into the <img src>, and into the sha1 that names the post's wall thumb —
//     so the same picture under two spellings is two cache entries and two
//     thumbnails. It also broke the thumbnail rewrite below, because the query
//     was being treated as part of the filename.
//
//  2. FULL-SIZE ORIGINALS. `iiurlwidth` returns a thumbnail only when the
//     original is wider than the requested width; otherwise the API returns the
//     original and marks it `thumbnail_unscaled`. 63 heroes ended up pointing at
//     originals — mostly harmless, but 26 of them ship 1.5–9.5 MB to every
//     reader, and anything past ~5 MB is too large for the vision gate to fetch,
//     so those heroes could never be checked at all.
//
//  The rewrite is width-aware because Wikimedia refuses to upscale: asking for a
//  1600px thumbnail of a 1281px original is a 400. The width comes from the
//  Commons API, and the largest standard width BELOW the original is chosen,
//  never under Discover's 1200px floor (the hero is the og:image).
//
//  Env: DRY=1 (report only), MAX_BYTES (default 1500000)
//  Usage: node scripts/normalize-wikimedia-heroes.mjs
// ─────────────────────────────────────────────────────────────
import { readdir, readFile, writeFile } from 'node:fs/promises';
import matter from 'gray-matter';
import yaml from 'js-yaml';

const POSTS = 'src/content/posts';
const UA = 'WanderAtlasHeroNormalise/1.0 (pixer.vtm@gmail.com)';
const API = 'https://commons.wikimedia.org/w/api.php';
const DRY = process.env.DRY === '1';
// ONLY_ORIGINALS=1 limits the run to heroes that hotlink an original file —
// the ones Wikimedia now refuses. The tooWide rewrite is a bandwidth saving
// that can wait for a quieter night: rewriting 1,058 URLs at once re-keys a
// thousand verdicts and mirrors in one commit.
const ONLY_ORIGINALS = process.env.ONLY_ORIGINALS === '1';
// Two stores are keyed by the hero URL. Rewriting the URL without moving the
// record would orphan the verdict (so the patrol re-judges the photo, paying
// again and risking a bad night) and the mirror (so og:image falls back to the
// remote file). Carry both across at the moment of the rewrite.
const AUDIT_PATH = 'data/visual-audit.json';
const MIRROR_PATH = 'data/og-mirror.json';
async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
const MAX_BYTES = Number(process.env.MAX_BYTES || 1_500_000);
// A hero wider than this is rewritten even when its byte size looks acceptable.
// 110 posts stored a 3840px render and every visitor downloaded it whole — on
// one measured post two images came to 5.25 MB, displayed at 312 CSS px, four
// to eight seconds of image download on mobile data (2026-08-06).
const MAX_WIDTH = Number(process.env.MAX_WIDTH || 1600);
// Standard widths, largest first. 1200 is the floor — Google Discover wants a
// 1200px+ image and the hero IS the og:image, so we never rewrite below it.
//
// These are REQUESTS, not guesses: Wikimedia serves only the thumbnail widths it
// has rendered for a given file and answers 400 for anything else ("Use
// thumbnail sizes listed on…"). One file here accepts 500, 1280 and 3840 and
// rejects 480, 640, 800, 1024, 1200 and 1920. That is why the width is asked for
// through iiurlwidth, which returns the URL MediaWiki actually serves, and why a
// hand-built srcset across arbitrary widths is not an option.
const WIDTHS = [1600, 1400, 1280, 1200];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One retry on 429, because a rate-limited request is not a missing thumbnail —
// and reporting it as one is how a fixable problem gets recorded as impossible.
async function politeFetch(url, opts = {}, tries = 2) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) } }).catch(() => null);
    if (res && res.status !== 429) return res;
    if (i < tries - 1) await sleep(3000);
  }
  return null;
}

export const isWikimedia = (u) => /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\//.test(u);
// The API started answering on thumb.wikimedia.org on 2026-08-31; the stored
// URL is folded back onto upload.wikimedia.org (same path, same bytes) so the
// rest of the pipeline keeps one host to reason about.
export const foldHost = (u) => u.replace(/^https:\/\/thumb\.wikimedia\.org\//, 'https://upload.wikimedia.org/');
// Widths Wikimedia actually serves, largest first, for replacing an ORIGINAL.
// 1200 is the Discover floor, so 1280 is the smallest we want; 960 is kept as a
// last resort because since 2026-09-02 an original is not "a bit heavy" — it
// is a 429 ("please use thumbnail images in sizes listed"), i.e. no photo at
// all. A 960px thumb that loads beats a 4000px original that does not.
const ORIGINAL_LADDER = [1920, 1280, 960];
export const stripQuery = (u) => u.split('?')[0];

// Both shapes carry the original filename:
//   /commons/a/bc/NAME            (original)
//   /commons/thumb/a/bc/NAME/…px-NAME   (thumbnail)
export function originalFile(u) {
  const c = stripQuery(u);
  const m = c.match(/\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//) || c.match(/\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)$/);
  return m ? m[1] : null;
}

// Original width + byte size for a batch of Commons filenames.
async function imageInfo(files) {
  const out = new Map();
  for (let i = 0; i < files.length; i += 40) {
    const batch = files.slice(i, i + 40);
    const url = `${API}?action=query&format=json&prop=imageinfo&iiprop=size&origin=*&titles=` +
      batch.map((n) => encodeURIComponent('File:' + decodeURIComponent(n))).join('|');
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const j = await res.json();
    for (const p of Object.values(j?.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (ii) out.set(String(p.title).replace(/^File:/, '').replace(/ /g, '_'), { w: ii.width, size: ii.size });
    }
  }
  return out;
}

// ASK for the thumbnail rather than composing its address. Composing looks
// obvious — /commons/a/bc/NAME → /commons/thumb/a/bc/NAME/1600px-NAME — and it
// worked on exactly one file out of 29: everything else came back 400, because
// the rendered name is not always `<width>px-<original>` (multi-page and some
// JPEG variants differ, and the path can be sharded elsewhere). `iiurlwidth`
// makes MediaWiki render the thumbnail and hand back the URL it actually serves,
// and returns nothing when it will not render one — which is precisely the
// question being asked.
async function thumbFromApi(file, width) {
  const url = `${API}?action=query&format=json&prop=imageinfo&iiprop=url|size&iiurlwidth=${width}&origin=*` +
    `&titles=${encodeURIComponent('File:' + decodeURIComponent(file))}`;
  await sleep(150);
  const res = await politeFetch(url);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null);
  const ii = Object.values(j?.query?.pages || {})[0]?.imageinfo?.[0];
  // No thumburl, or one identical to the original, means "not scaled".
  if (!ii?.thumburl || ii.thumburl === ii.url) return null;
  return { url: ii.thumburl, w: ii.thumbwidth };
}

async function main() {
const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  const { data } = matter(await readFile(`${POSTS}/${f}`, 'utf8'));
  // The hero and every in-body photo: a gallery entry hotlinking an original
  // gets the same 429 the hero does (171 live posts on 2026-09-02), it was
  // just never in this script's scope. `where` says which field to write back.
  const targets = [['hero', data.heroImage?.url]];
  (Array.isArray(data.gallery) ? data.gallery : []).forEach((g, i) => targets.push([`gallery:${i}`, g?.url]));
  for (const [where, u] of targets) {
    const url = String(u || '');
    if (!isWikimedia(url)) continue;
    const file = originalFile(url);
    if (!file) continue;
    posts.push({ f, where, url, file, servingOriginal: !stripQuery(url).includes('/thumb/') });
  }
}

const info = await imageInfo([...new Set(posts.map((p) => p.file))]);

let queryStripped = 0, downsized = 0, skipped = 0;
const audit = DRY ? null : await readJson(AUDIT_PATH);
const mirror = DRY ? null : await readJson(MIRROR_PATH);
let carried = 0, mirrorDirty = false;
for (const p of posts) {
  let next = foldHost(stripQuery(p.url));
  const strippedHere = next !== p.url;

  // Two reasons to rewrite: serving the ORIGINAL file (too big by definition),
  // or serving a thumbnail that is simply too wide. The second case was missed
  // entirely — a 3840px thumbnail is a valid /thumb/ URL, so it looked fine while
  // shipping 1.7 MB per image.
  const storedWidth = Number((stripQuery(p.url).match(/\/(\d+)px-[^/]+$/) || [])[1] || 0);
  const tooWide = storedWidth > MAX_WIDTH;
  const meta = info.get(decodeURIComponent(p.file).replace(/ /g, '_')) || info.get(p.file);
  if (p.servingOriginal) {
    // An original is rewritten regardless of its byte size now. Wikimedia
    // answers hotlinked originals with 429 and points at the thumbnail ladder;
    // 350 live heroes were originals on 2026-09-02, 134 of them with no mirror,
    // and readers on a throttled path got an empty hero. Walk the ladder from
    // the top: the API says whether it will render a width, and a HEAD says
    // whether it serves it — a rewrite happens only when both agree.
    let done = false;
    for (const width of ORIGINAL_LADDER) {
      if (meta?.w && width >= meta.w) continue; // never ask to upscale
      const thumb = await thumbFromApi(p.file, width);
      if (!thumb) continue;
      await sleep(150);
      const head = await politeFetch(thumb.url, { method: 'HEAD' });
      if (!head?.ok) continue;
      next = foldHost(stripQuery(thumb.url));
      downsized++;
      console.log(`  ✓ ${p.f} [${p.where}]: original${meta?.w ? ` (${meta.w}px)` : ''} → ${thumb.w}px thumbnail`);
      done = true;
      break;
    }
    if (!done) { console.log(`  – ${p.f}: original — Commons rendered no thumbnail on the ladder`); skipped++; }
  } else if (tooWide && !ONLY_ORIGINALS) {
    if (meta?.w) {
      const width = WIDTHS.find((w) => w < meta.w);
      if (!width) {
        console.log(`  – ${p.f}: ${(meta.size / 1e6).toFixed(1)}MB at ${meta.w}px — no standard width fits above the 1200px floor`);
        skipped++;
      } else {
        const thumb = await thumbFromApi(p.file, width);
        if (!thumb) {
          console.log(`  – ${p.f}: Commons will not render a ${width}px thumbnail`);
          skipped++;
        } else {
          // Confirm the served bytes really are smaller before rewriting —
          // a broken or heavier hero is worse than the heavy one we have.
          await sleep(150);
          const head = await politeFetch(thumb.url, { method: 'HEAD' });
          const bytes = Number(head?.headers.get('content-length') || 0);
          if (!head?.ok || !bytes) {
            console.log(`  – ${p.f}: thumbnail did not fetch (${head?.status ?? 'no response'})`);
            skipped++;
          } else if (bytes >= meta.size) {
            console.log(`  – ${p.f}: ${width}px thumbnail is no smaller — left alone`);
            skipped++;
          } else {
            next = foldHost(stripQuery(thumb.url));
            downsized++;
            console.log(`  ✓ ${p.f}: ${(meta.size / 1e6).toFixed(1)}MB → ${(bytes / 1e6).toFixed(2)}MB (${meta.w}px → ${thumb.w}px)`);
          }
        }
      }
    }
  }

  if (next === p.url) continue;
  if (strippedHere && next === stripQuery(p.url)) queryStripped++;
  if (DRY) continue;
  const raw = await readFile(`${POSTS}/${p.f}`, 'utf8');
  const { data, content } = matter(raw);
  if (p.where === 'hero') data.heroImage.url = next;
  else data.gallery[Number(p.where.split(':')[1])].url = next;
  await writeFile(`${POSTS}/${p.f}`, `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${content}`, 'utf8');
  if (p.where !== 'hero') continue; // verdicts and mirrors are keyed by the hero only
  const slug = p.f.replace(/\.md$/, '');
  if (audit && audit[`${slug}\u0001${p.url}`] && !audit[`${slug}\u0001${next}`]) {
    audit[`${slug}\u0001${next}`] = audit[`${slug}\u0001${p.url}`];
    carried++;
  }
  // `in`, not truthiness: a null mirror entry means "measured, too narrow to
  // mirror" (BaseLayout.astro) and must travel with the URL like any other.
  if (mirror && (p.url in mirror) && !(next in mirror)) { mirror[next] = mirror[p.url]; mirrorDirty = true; }
}
// A key carrying the Commons tracking query is never a URL this site serves
// (cleanCommonsUrl strips it at the source), so any such record is a
// leftover of an earlier rewrite, not a verdict anyone will look up again.
let auditDirty = carried > 0;
for (const store of [audit, mirror]) {
  if (!store) continue;
  for (const k of Object.keys(store)) {
    if (!k.includes('utm_source=commons.wikimedia.org')) continue;
    delete store[k];
    if (store === audit) auditDirty = true; else mirrorDirty = true;
  }
}
if (audit && auditDirty) await writeFile(AUDIT_PATH, JSON.stringify(audit, null, 2) + '\n', 'utf8');
if (mirror && mirrorDirty) await writeFile(MIRROR_PATH, JSON.stringify(mirror, null, 2) + '\n', 'utf8');

console.log(`\n📎 ${posts.length} wikimedia image(s): ${queryStripped} tracking quer(ies) stripped · ${downsized} downsized · ${skipped} left as-is${DRY ? ' (DRY)' : ''}`);
console.log(`HERO_NORMALISE_SUMMARY total=${posts.length} query_stripped=${queryStripped} downsized=${downsized} skipped=${skipped} verdicts_carried=${carried}`);
}

// ── CLI (only when executed directly, not when imported) ─────
// Without this, importing the helpers for a test would run the whole rewrite —
// network calls and file writes included.
if (process.argv[1]?.endsWith('normalize-wikimedia-heroes.mjs')) await main();
