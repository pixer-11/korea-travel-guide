// A post's URL must name the place the post is actually about.
//
// The 2026-09-10 site diagnosis found the National Museum of Korea living at
// /posts/boryeong-national-museum-of-korea/ and Seoul's Gyeongdong Market at
// /posts/goyang-gyeongdong-market/. Both carry `region: Seoul` in their own
// frontmatter, so the region hubs file them correctly and only the URL lies —
// but the URL is what a reader reads before clicking, what an outreach target
// sees in a pitch, and what every internal link to the post spells out.
//
// The cause is the publish pipeline's two different moments: the slug is built
// from the CITY WE SEARCHED, and `region` is set later from the address Google
// answered with. Search "Boryeong attractions", get a museum in Yongsan, and
// the two disagree forever.
//
// This checks the pipeline's own invariant — slug starts with slugify(region) —
// rather than anyone's opinion about which city a place belongs to. Judging by
// address text instead produced 376 "findings" that were mostly Bangkok's
// addresses saying Krung Thep Maha Nakhon.
//
// The 41 posts that already shipped this way are listed in
// data/slug-region-legacy.json and pass. They are live URLs on a site whose
// indexing has been frozen since 2026-07-25, and re-slugging them would trade
// a cosmetic defect for a real indexing risk. The list is a BASELINE, not a
// permission: nothing may be added to it by hand without a note saying why.
//
//   node scripts/audit-slug-region.mjs
//   node scripts/audit-slug-region.mjs --baseline   # rewrite the legacy list
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { requireExamined } from './lib/examined.mjs';

const DIR = 'src/content/posts';
const LEGACY = 'data/slug-region-legacy.json';
const NL = String.fromCharCode(10);
const WRITE = process.argv.includes('--baseline');

const field = (head, key) => {
  for (const line of head.split(NL)) {
    const t = line.trim();
    if (t.startsWith(key + ':')) return t.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
};

// Must match src/lib/slug.ts — the same fold the routes use.
export const slugifyRegion = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const legacy = new Set(
  existsSync(LEGACY) ? (JSON.parse(readFileSync(LEGACY, 'utf8')).slugs ?? []) : [],
);

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const bad = [];
let checked = 0;
for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const end = raw.indexOf(NL + '---', 3);
  if (end < 0) continue;
  const head = raw.slice(0, end);
  const region = field(head, 'region');
  if (!region) continue;
  checked++;
  const slug = f.replace(/\.md$/, '');
  const r = slugifyRegion(region);
  if (!r || slug === r || slug.startsWith(r + '-')) continue;
  bad.push({ slug, region, legacy: legacy.has(slug) });
}

if (WRITE) {
  const slugs = bad.map((b) => b.slug).sort();
  writeFileSync(
    LEGACY,
    JSON.stringify({
      _comment:
        'Posts published before scripts/audit-slug-region.mjs existed whose slug does not start with their region. Their URLs are live and indexed; they are grandfathered, not approved. Do not add entries by hand.',
      recorded: '2026-09-11',
      slugs,
    }, null, 1) + NL,
    'utf8',
  );
  console.log(`${slugs.length} legacy slug(s) → ${LEGACY}`);
  process.exit(0);
}

const fresh = bad.filter((b) => !b.legacy);
for (const b of fresh) console.log(`SLUG-REGION-MISMATCH: ${b.slug}.md — region 은 ${b.region} 인데 슬러그가 다른 도시로 시작한다`);

requireExamined(checked, 'region 이 있는 글', 'src/content/posts 가 비어 있나?');
console.log(fresh.length
  ? `${NL}❌ ${fresh.length} new post(s) whose URL names a different city than their region. (기존 ${bad.length - fresh.length}편은 베이스라인)`
  : `${NL}✓ ${checked} post(s) — 새로 어긋난 슬러그 없음. (베이스라인 ${bad.length - fresh.length}편)`);
process.exit(fresh.length ? 1 : 0);
