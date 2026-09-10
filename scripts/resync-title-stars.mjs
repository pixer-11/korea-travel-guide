#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  THE STAR IN THE TITLE MUST BE THE STAR IN THE FACT BOX.
//
//  resync-rating-badges.mjs keeps the DESCRIPTION in step with place.rating,
//  in English and in all four translations — its header says so. Nothing kept
//  the TITLE in step, so a page could read
//
//    <h1>Place de la Bourse: Bordeaux Travel Guide (4.6★)</h1>
//    <meta name="description" … "4.7★ (20,285 reviews)">
//
//  on the same screen, and the translated titles carried the stale figure too
//  (2026-09-10: 7 English titles, plus their ko/ja/zh/es copies).
//
//  This edits the number only. The words around it are untouched, so no
//  translation is re-run and no srcHash changes — a rating is a fact that moved,
//  not a sentence that needs rewriting.
//
//    node scripts/resync-title-stars.mjs          # report
//    node scripts/resync-title-stars.mjs --apply
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const POSTS = 'src/content/posts';
const I18N = 'src/content/i18n';
const LANGS = ['ko', 'ja', 'es', 'zh'];
const APPLY = process.argv.includes('--apply');

// The star as it is written in a title, in either bracket width, with the
// rating right before the symbol: (4.6★) （評価4.6★） （4.6星）
const STAR_IN_TITLE = /(\d\.\d)(\s*(?:★|星))/;

const frontmatter = (raw) => raw.match(/^---([\s\S]*?)^---/m);

let checked = 0;
const changes = [];

for (const file of readdirSync(POSTS).filter((f) => f.endsWith('.md'))) {
  const path = join(POSTS, file);
  const raw = readFileSync(path, 'utf8');
  const fm = frontmatter(raw);
  if (!fm) continue;
  let data;
  try { data = yaml.load(fm[1]); } catch { continue; }
  const rating = data?.place?.rating;
  if (rating == null || data.draft === true) continue;
  checked++;

  const want = Number(rating).toFixed(1);
  const slug = file.replace(/\.md$/, '');

  // English, then every translation that carries a star in its title.
  const targets = [path, ...LANGS.map((l) => join(I18N, l, file))].filter((p) => existsSync(p));
  for (const target of targets) {
    const text = readFileSync(target, 'utf8');
    const titleLine = text.match(/^title:.*$/m);
    if (!titleLine) continue;
    const hit = titleLine[0].match(STAR_IN_TITLE);
    if (!hit || hit[1] === want) continue;
    const fixed = titleLine[0].replace(STAR_IN_TITLE, `${want}$2`);
    changes.push({ target, slug, from: hit[1], to: want, before: titleLine[0], after: fixed });
    if (APPLY) writeFileSync(target, text.replace(titleLine[0], fixed), 'utf8');
  }
}

console.log(`⭐ ${checked} rated post(s) examined — ${changes.length} title(s) out of step with place.rating`);
for (const c of changes.slice(0, 30)) {
  console.log(`  ${c.from} -> ${c.to}  ${c.target.split(String.fromCharCode(92)).join('/')}`);
}
if (changes.length > 30) console.log(`  … and ${changes.length - 30} more`);
if (!checked) { console.log('\n❌ NOTHING-EXAMINED: no rated posts read.'); process.exit(1); }
if (!APPLY) { console.log('\n(report only — pass --apply to write)'); process.exit(changes.length ? 1 : 0); }
console.log(`\nwrote ${changes.length} title(s).`);
