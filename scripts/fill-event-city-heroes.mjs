// THE THIRD TIER: an event guide with no photo of its own shows its city.
//
// Owner's rule, 2026-09-11: "an act's other photos; failing that a past edition
// of the event; failing that the best photo of the city it is held in." The
// resolver already does the first two. The third had no machinery at all, and
// twelve live guides sat behind the brand card until they were filled by hand.
//
// This is deliberately NOT part of resolveHero. The claim is different: the
// resolver's candidates are answers to "a photo of this event", judged by a
// vision gate that asks exactly that — and a city skyline correctly fails it.
// Here the claim is "a photo of this city", and the test that fits is the
// filename naming the region. So the two never argue.
//
// Safety, in order:
//   1. the region's own verified cover photo (data/region-covers.json) first —
//      already fetched under the identity rules of the photo pipeline;
//   2. otherwise Commons, filename must name the region, wide, big enough, and
//      not a hero anywhere else on the site;
//   3. never a photo a person has rejected for this post;
//   4. whatever it picks lands UNREVIEWED in audit-event-hero-identity, so a
//      person reads it the next morning. Twice on 2026-09-11 that eye was the
//      only thing between the site and a building site in Tangerang.
//
//   node scripts/fill-event-city-heroes.mjs            # fill
//   node scripts/fill-event-city-heroes.mjs --dry      # say what it would do
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { commonsBest, tokens, cleanCommonsUrl } from './lib/commons.mjs';
import { identityRejection } from './lib/photo-verdict.mjs';
import { isUsedImage, markUsedImage } from './lib/hero-url.mjs';

const DIR = 'src/content/posts';
const DRY = process.argv.includes('--dry');
const MIN_WIDTH = 1024;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; } };
const covers = readJson('data/region-covers.json');
const audit = readJson('data/visual-audit.json');

const q = (s) => "'" + String(s).split("'").join("''") + "'";
const fileOf = (url) => { try { return decodeURIComponent(String(url).split('/').pop()); } catch { return String(url).split('/').pop(); } };

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
if (!files.length) { console.log('src/content/posts 가 비어 있다 — 아무것도 하지 않는다'); process.exit(1); }

// Every hero already on the site, so nothing here becomes a duplicate.
const used = new Set();
const targets = [];
for (const f of files) {
  const raw = await readFile(join(DIR, f), 'utf8');
  let data;
  try { ({ data } = matter(raw)); } catch { continue; }
  const url = data.heroImage?.url;
  if (url) { markUsedImage(used, url); continue; }
  if (data.draft === true) continue;
  if (!/^event/.test(String(data.category ?? ''))) continue;
  targets.push({ f, slug: f.replace(/\.md$/, ''), data, raw });
}

console.log(`사진 없는 발행 이벤트 ${targets.length}편 (전체 ${files.length}편 중)`);
if (!targets.length) { console.log('✓ 채울 것이 없다.'); process.exit(0); }

let filled = 0;
const unfilled = [];
for (const t of targets) {
  const region = String(t.data.region ?? '').trim();
  const country = String(t.data.country ?? '').trim();
  if (!region) { unfilled.push(`${t.slug} (region 없음)`); continue; }
  const regionTokens = tokens(region);

  // 1. the region's verified cover, when it is not already someone's hero
  let pick = null;
  const cover = covers[region]?.url;
  if (cover && !isUsedImage(used, cover)) {
    pick = { url: cover, credit: covers[region].credit, source: covers[region].source };
  }

  // 2. otherwise Commons, and the filename has to name the region
  if (!pick) {
    for (const query of [`${region} ${country}`, region]) {
      const hit = await commonsBest(query, {
        used, minWidth: MIN_WIDTH, allowPortrait: false,
        crossCheck: regionTokens, minCross: 1,
      });
      if (!hit?.url) continue;
      const name = fileOf(hit.url).toLowerCase();
      if (!regionTokens.some((tk) => name.includes(tk))) continue;
      if (isUsedImage(used, hit.url)) continue;
      pick = { url: hit.url, credit: hit.credit, source: hit.source };
      break;
    }
  }

  if (!pick?.url) { unfilled.push(`${t.slug} (${region} 사진 없음)`); continue; }
  if (identityRejection(audit, t.slug, pick.url, t.data.category)) {
    unfilled.push(`${t.slug} (사람이 이미 거부한 사진)`);
    continue;
  }

  const url = cleanCommonsUrl(pick.url);
  console.log(`  ${DRY ? '·' : '+'} ${t.slug.slice(0, 46).padEnd(48)}${fileOf(url).slice(0, 44)}`);
  markUsedImage(used, url);
  filled++;
  if (DRY) continue;

  const eol = t.raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = t.raw.split(eol);
  const fmEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  let at = lines.findIndex((l, i) => i < fmEnd && l.startsWith('gallery:'));
  if (at < 0) at = lines.findIndex((l, i) => i < fmEnd && l.startsWith('tags:'));
  if (at < 0) { unfilled.push(`${t.slug} (프론트매터에 넣을 자리 없음)`); filled--; continue; }
  lines.splice(at, 0,
    'heroImage:',
    '  url: ' + q(url),
    '  credit: ' + q(pick.credit || 'Photo: Wikimedia Commons'),
    '  license: wikimedia',
    '  source: ' + q(pick.source || ''));
  await writeFile(join(DIR, t.f), lines.join(eol), 'utf8');
}

for (const u of unfilled) console.log(`  ⚠️  ${u}`);
console.log(`\nCITY_HERO_SUMMARY filled=${filled} unfilled=${unfilled.length} targets=${targets.length}`);
