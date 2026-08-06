#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  LABEL ↔ PHOTO MATCH — does the picture belong to the place named next to it?
//
//  The vision gate checks a POST's hero against that post's venue. It has
//  never looked at the images a COMPONENT assembles: the country tiles, the
//  region tiles, the home page spotlight. Those pick a photo by filtering
//  posts, and nothing verified that the filter and the caption agreed.
//
//  On 2026-08-06 the owner opened the home page and saw the Alhambra, in
//  Granada, captioned "South Korea". The spotlight took its photo from the
//  weekly cover rotation — which draws from every country — while its heading,
//  flag, city links and button were all hard-coded to Korea. It read correctly
//  for as long as the site was Korea-only, and broke silently the week the
//  rotation picked Spain. Three separate photo audits had run that day and
//  none of them could see it, because all three only ever looked at posts.
//
//  This resolves each /wall/<hash>.webp back to the post it came from and
//  compares that post's country/region with the label rendered beside it.
//
//    node scripts/audit-label-photo-match.mjs        # after `npm run build`
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';

const DIST = 'dist';
const POSTS = 'src/content/posts';
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// Two indexes, because the site renders composed images BOTH ways: the
// spotlight uses the /wall/<hash>.webp thumbnail, the country tiles put the
// original URL straight into a background-image. Resolving only the hashed
// form is why the first run of this audit checked one image and reported
// success over the tiles it never looked at.
const byHash = new Map();
const byUrl = new Map();
for (const f of readdirSync(POSTS).filter((x) => x.endsWith('.md'))) {
  let d;
  try { d = matter(readFileSync(join(POSTS, f), 'utf8')).data; } catch { continue; }
  const urls = [d.heroImage?.url, ...(d.gallery ?? []).map((g) => g?.url ?? g)].filter(Boolean);
  const owner = { country: d.country ?? 'South Korea', region: d.region ?? '', title: d.title ?? f };
  for (const u of urls) { byHash.set(hash(u), owner); byUrl.set(String(u), owner); }
}

// HTML attribute escaping has to come back off before a URL can be matched.
const unescape = (s) => String(s).replace(/&#38;/g, '&').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const ownerOf = (src) => {
  const h = /\/wall\/([0-9a-f]{16})\.webp/.exec(src)?.[1];
  if (h) return byHash.get(h) ?? null;
  const u = unescape(src);
  return byUrl.get(u) ?? byUrl.get(u.split('?')[0]) ?? null;
};

// Country tiles and the spotlight render `<img … alt="LABEL">` or a
// background-image with the label in the neighbouring text. Both forms below.
const CHECKS = [
  {
    page: 'index.html',
    what: 'home spotlight',
    find: (html) => {
      const out = [];
      const m = /<div class="spotlight-media">\s*<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"/.exec(html);
      if (m) out.push({ src: m[1], label: m[2] });
      return out;
    },
  },
  {
    page: 'destinations/index.html',
    what: 'country tile',
    find: (html) => {
      const out = [];
      // <div class="country-photo" style="background-image:url(…)"> … <h3>Country</h3>
      // The window is wide because an inline flag SVG sits between the two —
      // 400 chars stopped short of every h3 and matched nothing.
      for (const m of html.matchAll(/background-image:url\(([^)]+)\)[\s\S]{0,3000}?<h3[^>]*>([^<]+)<\/h3>/g)) {
        out.push({ src: m[1], label: m[2].trim() });
      }
      return out;
    },
  },
];

let checked = 0;
const bad = [];
const unresolved = [];
const missing = [];

for (const c of CHECKS) {
  const p = join(DIST, c.page);
  // A page that is not there is a BROKEN RUN, not a clean one. Reporting "✅
  // all good" over an empty result set is the exact shape of failure this
  // audit was written in response to — and the first version of this file did
  // it, on its very first run.
  if (!existsSync(p)) { missing.push(c.page); continue; }
  const html = readFileSync(p, 'utf8');
  for (const { src, label } of c.find(html)) {
    if (/placeholder|\.svg$/.test(src)) continue;   // brand fallback, owns no place
    const owner = ownerOf(src);
    checked++;
    if (!owner) { unresolved.push(`${c.what}: ${label} → ${src}`); continue; }
    // The label is a country or a city; either may legitimately match.
    const ok = owner.country === label || owner.region === label;
    if (!ok) bad.push({ what: c.what, label, owner, src });
  }
}

console.log(`\n🖼  Label ↔ photo: ${checked} composed image(s) checked`);
for (const b of bad) {
  console.log(`❌ ${b.what}: captioned "${b.label}" but the photo belongs to ${b.owner.country}${b.owner.region ? ` / ${b.owner.region}` : ''}`);
  console.log(`      ${b.owner.title}`);
}
unresolved.forEach((u) => console.log(`⚠️  could not resolve: ${u}`));

if (missing.length) {
  console.log(`\n❌ ${missing.length} page(s) not in dist — run \`npm run build\` first: ${missing.join(', ')}`);
  process.exit(1);
}
// Every CHECKS entry names a page that always renders at least one composed
// image. Zero means a selector stopped matching, which would otherwise read
// exactly like a clean site.
if (checked === 0) {
  console.log('\n❌ examined 0 images — a selector no longer matches the built markup.');
  process.exit(1);
}
if (bad.length) { console.log(`\n${bad.length} mismatch(es).`); process.exit(1); }
console.log('✅ every composed image comes from the place it is labelled with.');
