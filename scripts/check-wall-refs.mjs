// Every /wall/ thumbnail the BUILT SITE references must actually exist.
//
// The per-post data check cannot catch what this catches: the night the city
// tiles went dark, every post's own thumbnail existed — the defect was a
// template hashing an already-transformed URL, so the PAGES referenced file
// names no pipeline had ever produced. Only the build output knows what the
// pages actually ask for.
//
//   node scripts/check-wall-refs.mjs        (needs dist/ — run after a build)
import { readdirSync, readFileSync, existsSync } from 'fs';

if (!existsSync('dist')) { console.log('dist/ 없음 — 빌드 후 실행'); process.exit(0); }

const refs = new Map(); // name -> first page that references it
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'wall') walk(p); }
    else if (e.name.endsWith('.html')) {
      const s = readFileSync(p, 'utf8');
      for (const m of s.matchAll(/\/wall\/([a-f0-9]{16}\.webp)/g)) {
        if (!refs.has(m[1])) refs.set(m[1], p.replace(/^dist/, ''));
      }
    }
  }
})('dist');

// A tile can also fail by having NO image reference at all — the Philippines
// hub shipped Manila, Quezon City and a duplicate Makati as dark empty boxes,
// and this file's existence check was satisfied because nothing was referenced.
// Every destination/region/country tile must carry a background-image.
const blank = new Map();
(function walk2(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p2 = `${d}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'wall' && e.name !== 'embed') walk2(p2); }
    else if (e.name.endsWith('.html')) {
      const s2 = readFileSync(p2, 'utf8');
      // Token-delimited: dest-tile-inner (the label wrapper INSIDE a tile, which
      // never carries a background) must not read as a dest-tile — it did, and
      // 34 phantom blanks hid the one real report line.
      for (const m of s2.matchAll(/class="(?:[^"]* )?(region-tile|dest-tile|country-photo)(?: [^"]*)?"[^>]*/g)) {
        // `no-photo` is the DELIBERATE fallback (event-only city, no hero
        // anywhere) — a styled gradient tile, not a blank box. A tile with no
        // background and no `no-photo` class is still a real defect and alarms.
        if (/(?:^|[" ])no-photo(?:[" ]|$)/.test(m[0])) continue;
        // Coming-soon tiles (a registered country with zero posts) are also
        // deliberate: a grayscale flag SVG + "Coming soon" pill, no background
        // image by design. The marker sits on the element itself on the home
        // page (dest-tile dest-soon) but on the PARENT card on continent pages
        // (country-card is-soon → plain country-photo child), so for the child
        // case look at the few chars just before the element — the parent tag
        // is immediately adjacent, and 80 chars cannot reach a NEIGHBOURING
        // card (each card carries a >1000-char flag SVG), so a genuinely blank
        // tile next to a soon-card still alarms.
        if (/(?:^|[" ])(?:dest-soon|is-soon)(?:[" ]|$)/.test(m[0])) continue;
        if (m[1] === 'country-photo'
          && s2.slice(Math.max(0, m.index - 80), m.index).includes('country-card is-soon')) continue;
        if (!/background-image:url\(/.test(m[0])) {
          const label = (s2.slice(m.index, m.index + 400).match(/<span[^>]*>([^<]{1,30})/) || [])[1] ?? '?';
          const key = `${m[1]}:${label}`;
          if (!blank.has(key)) blank.set(key, p2.replace(/^dist/, ''));
        }
      }
    }
  }
})('dist');
for (const [what, page] of blank) console.log(`BLANK-TILE ${what} — ${page}`);

const missing = [...refs].filter(([name]) => !existsSync(`dist/wall/${name}`));
for (const [name, page] of missing.slice(0, 10)) console.log(`WALL-REF-MISSING: ${name} — first used on ${page}`);
const bad = missing.length + blank.size;
console.log(bad
  ? `❌ ${missing.length} missing thumbnail(s) + ${blank.size} tile(s) with no image at all.`
  : `✓ ${refs.size} referenced thumbnail(s) all exist, and no tile is blank.`);
process.exit(bad ? 1 : 0);
