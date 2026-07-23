// One-off/idempotent: shorten existing post titles to match the new rules in
// lib/titles.mjs — venue-first, no "A Visitor's Guide" filler, no city echo.
// New posts already use these via generate.mjs; this rewrites the back catalogue.
//   node scripts/backfill-titles.mjs           # dry-run
//   node scripts/backfill-titles.mjs --apply
// Event posts (category: event) are left untouched — their titles come from
// discover-events.mjs. Placeless posts just shed the trailing filler clause.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTitle } from './lib/titles.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');

const field = (fm, key) => {
  // Single-quoted YAML escapes an apostrophe as '' — match those so a title like
  // 'X: A Visitor''s Guide' isn't truncated at the first inner quote (which left
  // 77 placeless titles with the filler clause un-stripped).
  const m = new RegExp(`(?:^|\\n)${key}:[ \\t]*(?:"([^"]*)"|'((?:[^']|'')*)'|([^\\n]+))`).exec(fm);
  if (!m) return '';
  if (m[1] != null) return m[1].trim();
  if (m[2] != null) return m[2].replace(/''/g, "'").trim();
  return (m[3] ?? '').trim();
};

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
let changed = 0, skip = 0;
const samples = [];
for (const f of files) {
  const p = join(DIR, f);
  const t = await readFile(p, 'utf8');
  const fm = t.split('---')[1] || '';
  const category = field(fm, 'category');
  const region = field(fm, 'region');
  const oldTitle = field(fm, 'title');
  if (!oldTitle || !region) { skip++; continue; }

  let newTitle;
  const placeIdx = fm.indexOf('\nplace:');
  if (category !== 'event' && placeIdx >= 0) {
    // Real (non-event) venue post — rebuild from the Google place name.
    const afterPlace = fm.slice(placeIdx);
    const nm = /\n[ \t]+name:[ \t]*(?:"([^"]*)"|'((?:[^']|'')*)'|([^\n]+))/.exec(afterPlace);
    const name = nm ? (nm[1] ?? nm[2]?.replace(/''/g, "'") ?? nm[3] ?? '').trim() : '';
    if (!name) { skip++; continue; }
    newTitle = makeTitle(name, { category, region });
  } else {
    // Event OR placeless post — keep the name, strip only the trailing
    // "A Visitor's Guide[ in <region>]" filler. Events from discover-events say
    // "…: What to Know (City)" (no filler) and are left unchanged. Never rebuild
    // an event via makeTitle — its "Travel Guide" suffix is wrong for a festival.
    newTitle = oldTitle
      .replace(/:\s*A Visitor'?s Guide(?:\s+in\s+.+?)?\s*$/i, '')
      .replace(/\s*[-–—]\s*A Visitor'?s Guide(?:\s+in\s+.+?)?\s*$/i, '')
      .trim();
  }

  if (!newTitle || newTitle === oldTitle) { skip++; continue; }
  const out = t.replace(/^title:[ \t]*.+/m, `title: ${JSON.stringify(newTitle)}`);
  if (out === t) { skip++; continue; }
  changed++;
  if (samples.length < 8) samples.push(`  ${oldTitle}\n   → ${newTitle}`);
  if (APPLY) await writeFile(p, out, 'utf8');
}
console.log(samples.join('\n'));
console.log(`\n${changed} titles rewritten, ${skip} unchanged (${APPLY ? 'APPLIED' : 'dry-run'}).`);
