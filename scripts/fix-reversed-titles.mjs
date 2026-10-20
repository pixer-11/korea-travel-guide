// Turn round translated titles that put the city in front of the colon:
// 「호찌민 여행 가이드: 야키우오 이시카와」 → 「야키우오 이시카와: 호찌민 여행 가이드」.
// The linker and every list read the head as the place (lib/placeLabel.mjs).
//
//   node scripts/fix-reversed-titles.mjs          # dry run
//   node scripts/fix-reversed-titles.mjs --write
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import matter from 'gray-matter';
import { guideTitleRegion, regionNamesFor, unreverseGuideTitle } from '../src/lib/placeLabel.mjs';
import { editFrontmatter } from './lib/frontmatter-edit.mjs';

const WRITE = process.argv.includes('--write');
const PLACES = JSON.parse(readFileSync('src/i18n/places.json', 'utf8'));
const POSTS = 'src/content/posts';
const regionOf = new Map();
for (const f of readdirSync(POSTS)) {
  if (!f.endsWith('.md')) continue;
  regionOf.set(f.slice(0, -3), String(matter(readFileSync(`${POSTS}/${f}`, 'utf8')).data.region ?? ''));
}

let fixed = 0;
for (const lang of ['ko', 'ja', 'zh', 'es']) {
  const dir = `src/content/i18n/${lang}`;
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const titles = new Map(files.map((f) => [f.slice(0, -3), String(matter(readFileSync(`${dir}/${f}`, 'utf8')).data.title ?? '')]));
  // Every city name this language's guides use, per English region.
  const tails = new Map();
  for (const [slug, t] of titles) {
    const r = regionOf.get(slug); const c = guideTitleRegion(t, lang);
    if (!r || !c) continue;
    if (!tails.has(r)) tails.set(r, new Map());
    tails.get(r).set(c, (tails.get(r).get(c) ?? 0) + 1);
  }
  for (const [slug, t] of titles) {
    const r = regionOf.get(slug);
    if (!r) continue;
    const seen = tails.get(r) ?? new Map();
    const names = regionNamesFor([r, PLACES[r]?.[lang], ...seen.keys()]);
    const label = [...seen.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? PLACES[r]?.[lang] ?? r;
    const next = unreverseGuideTitle(t, lang, names, label);
    if (!next || next === t) continue;
    fixed++;
    console.log(`${lang} ${slug}\n   ${t}\n → ${next}`);
    if (WRITE) {
      const p = `${dir}/${slug}.md`;
      writeFileSync(p, editFrontmatter(readFileSync(p, 'utf8'), { title: next }));
    }
  }
}
console.log(`\n${fixed} title(s) ${WRITE ? 'fixed' : 'to fix (dry run)'}`);
