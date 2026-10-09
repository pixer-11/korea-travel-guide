// Put a hero ON a guide by hand — the counterpart of reject-hero.mjs.
//
// A hand pick still goes through the rules a machine pick does: the photo must
// not already be another guide's hero (two 10-09 duplicates came from one-off
// scripts that skipped that check), vision must pass it for this guide, and the
// verdict is recorded where validate-content and the patrol read it. For an
// event the person's reading is also recorded as reviewed, so the identity
// audit does not ask again about a photo a person chose.
//
//   node scripts/set-hero.mjs <slug> "File:Jay Park performing.jpg" [--why="the act on stage"]
import './lib/env.mjs';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import matter from 'gray-matter';
import { commonsFileCandidate } from './lib/commons.mjs';
import { verifyHeroImage, recordHeroVerdict } from './lib/vision-check.mjs';
import { editFrontmatter } from './lib/frontmatter-edit.mjs';
import { isUsedImage, markUsedImage } from './lib/hero-url.mjs';

const [slug, file] = process.argv.slice(2);
const why = (process.argv.find((a) => a.startsWith('--why=')) || '').slice(6) || 'chosen by hand';
if (!slug || !file) { console.log('usage: node scripts/set-hero.mjs <slug> "File:…" [--why="…"]'); process.exit(1); }
const DIR = 'src/content/posts';
const path = `${DIR}/${slug}.md`;
if (!existsSync(path)) { console.log(`✗ no guide ${slug}`); process.exit(1); }

const cand = await commonsFileCandidate(file);
if (!cand) { console.log(`✗ ${file}: not a usable Commons photo`); process.exit(1); }
const used = new Set();
for (const f of readdirSync(DIR)) {
  if (f === `${slug}.md`) continue;
  const u = matter(readFileSync(`${DIR}/${f}`, 'utf8')).data.heroImage?.url;
  if (u) markUsedImage(used, u);
}
if (isUsedImage(used, cand.url)) { console.log(`✗ ${file}: already another guide's hero`); process.exit(1); }
if ((cand.w || 0) < 1200) console.log(`⚠ ${file}: ${cand.w}px wide — under the 1200px Discover bar`);

const raw = readFileSync(path, 'utf8');
const { data } = matter(raw);
const isEvent = data.category === 'event';
const vis = await verifyHeroImage({ url: cand.url, name: data.place?.name || data.title, category: data.category, region: data.region, country: data.country, eventMode: isEvent, venue: data.eventVenue || '' });
if (!vis.ok) { console.log(`✗ vision refused it: ${vis.reason}`); process.exit(1); }

writeFileSync(path, editFrontmatter(raw, { heroImage: { url: cand.url, credit: cand.credit, license: cand.license, source: cand.source, ...(vis.focus ? { focus: vis.focus } : {}) } }));
await recordHeroVerdict(slug, cand.url, 'MATCH', `hand-picked: ${why} — ${String(vis.reason || '').slice(0, 100)}`);
if (isEvent) {
  const R = 'data/event-hero-identity-reviewed.json';
  const reviewed = existsSync(R) ? JSON.parse(readFileSync(R, 'utf8')) : {};
  reviewed[slug] = cand.url;
  writeFileSync(R, JSON.stringify(reviewed, null, 1) + '\n');
}
console.log(`✓ ${slug} ← ${cand.title} (${cand.w}px) · ${vis.reason}`);
