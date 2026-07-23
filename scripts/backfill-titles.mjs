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
  const m = new RegExp(`(?:^|\\n)${key}:[ \\t]*(?:"([^"]*)"|'([^']*)'|([^\\n]+))`).exec(fm);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '').trim() : '';
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
  if (category === 'event') { skip++; continue; } // discover-events owns these

  let newTitle;
  const placeIdx = fm.indexOf('\nplace:');
  if (placeIdx >= 0) {
    // Venue post — rebuild from the real Google place name (has any city echo).
    const afterPlace = fm.slice(placeIdx);
    const nm = /\n[ \t]+name:[ \t]*(?:"([^"]*)"|'([^']*)'|([^\n]+))/.exec(afterPlace);
    const name = nm ? (nm[1] ?? nm[2] ?? nm[3] ?? '').trim() : '';
    if (!name) { skip++; continue; }
    newTitle = makeTitle(name, { category, region });
  } else {
    // Placeless post — new rule is just the old title minus the filler clause.
    newTitle = oldTitle
      .replace(/:\s*A Visitor'?s Guide\s*$/i, '')
      .replace(/\s*[-–—]\s*A Visitor'?s Guide\s*$/i, '')
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
