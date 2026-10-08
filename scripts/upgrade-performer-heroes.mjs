// A singer's guide wears the singer (픽서님, 2026-10-06 and again 10-08).
//
// Discovery used to give a concert guide whatever the text search answered
// with — usually the arena (BABYMONSTER Bangkok → IMPACT Arena, Khalid Paris →
// Salle Pleyel) — and the night patrol never revisits a live guide that has a
// photo, so the act's own photos in its Commons category never got a turn.
// Discovery now tries the act's category first (discover-events.mjs); this
// walks the guides born before that, and any a later run still misses.
//
// For every live event with a performer whose hero is not the performer's
// (no category proof, filename does not name the act): try the act's Commons
// category, vision-check up to two, and swap the hero for the first that
// passes. Nothing passes → the current photo stays. Each (guide, hero) pair is
// tried ONCE and remembered in data/performer-upgrade-tried.json, so a guide
// whose act has no usable photo costs nothing on the following nights.
//
//   node scripts/upgrade-performer-heroes.mjs          # swap
//   node scripts/upgrade-performer-heroes.mjs --dry    # list what it would try
import './lib/env.mjs';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import matter from 'gray-matter';
import { performerCategoryPhotos } from './lib/commons.mjs';
import { fileNamesPerformer } from './lib/event-file-identity.mjs';
import { verifyHeroImage, recordHeroVerdict } from './lib/vision-check.mjs';
import { editFrontmatter } from './lib/frontmatter-edit.mjs';
import { isUsedImage, markUsedImage, unmarkUsedImage } from './lib/hero-url.mjs';

const DIR = 'src/content/posts';
const DRY = process.argv.includes('--dry');
const PROOF = 'data/performer-category-heroes.json';
const TRIED = 'data/performer-upgrade-tried.json';
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});
const proof = readJson(PROOF);
const tried = readJson(TRIED);

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
if (!files.length) { console.log(`${DIR} 가 비어 있다`); process.exit(1); }
const used = new Set();
const posts = [];
for (const f of files) {
  const raw = readFileSync(`${DIR}/${f}`, 'utf8');
  let data;
  try { ({ data } = matter(raw)); } catch { continue; }
  if (data.heroImage?.url) markUsedImage(used, data.heroImage.url);
  posts.push({ f, slug: f.replace(/\.md$/, ''), raw, data });
}

let swapped = 0, kept = 0, skipped = 0;
for (const { f, slug, raw, data } of posts) {
  const act = data.eventPerformer?.name;
  if (data.category !== 'event' || data.draft === true || !act) continue;
  const cur = data.heroImage?.url || '';
  if (cur && (proof[slug]?.url === cur || fileNamesPerformer(cur, act))) continue; // already the act
  if (!cur) continue; // a photoless guide is the photo patrol's — it tries the act first now
  if (tried[slug] === cur) { skipped++; continue; }
  let cands = [];
  try { cands = await performerCategoryPhotos(act, { limit: 8 }); } catch {}
  cands = cands.filter((c) => !isUsedImage(used, c.url)).slice(0, 2);
  if (DRY) { console.log(`  · ${slug} (${act}): ${cands.length} candidate(s) from Category:${cands[0]?.category ?? '—'}`); continue; }
  let won = null, vis = null;
  for (const c of cands) {
    vis = await verifyHeroImage({ url: c.url, name: data.title, category: 'event', region: data.region, country: data.country, eventMode: true, venue: data.eventVenue || '' });
    if (vis.ok) { won = c; break; }
    console.log(`   ${slug}: ${String(c.title).slice(0, 50)} rejected (${vis.reason})`);
  }
  tried[slug] = cur;
  if (!won) { kept++; console.log(`  = ${slug}: no passing photo of ${act} — current photo stays`); continue; }
  const hero = { url: won.url, credit: won.credit, license: won.license, source: won.source, ...(vis.focus ? { focus: vis.focus } : {}) };
  writeFileSync(`${DIR}/${f}`, editFrontmatter(raw, { heroImage: hero }));
  unmarkUsedImage(used, cur); markUsedImage(used, won.url);
  proof[slug] = { url: won.url, category: won.category, at: new Date().toISOString() };
  await recordHeroVerdict(slug, won.url, 'MATCH', `performer upgrade: ${String(vis.reason || 'approved').slice(0, 150)}`);
  delete tried[slug];
  swapped++;
  console.log(`  ✓ ${slug}: ${act} from Category:${won.category}`);
}
if (!DRY) {
  writeFileSync(PROOF, JSON.stringify(proof, null, 1) + '\n');
  writeFileSync(TRIED, JSON.stringify(tried, null, 1) + '\n');
}
console.log(`PERFORMER_UPGRADE swapped=${swapped} kept=${kept} skipped=${skipped}`);
