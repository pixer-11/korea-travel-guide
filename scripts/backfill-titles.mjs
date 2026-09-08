// One-off/idempotent: shorten existing post titles to match the new rules in
// lib/titles.mjs — venue-first, no "A Visitor's Guide" filler, no city echo.
// New posts already use these via generate.mjs; this rewrites the back catalogue.
//   node scripts/backfill-titles.mjs                       # dry-run
//   node scripts/backfill-titles.mjs --apply
//   node scripts/backfill-titles.mjs --only=slug-a,slug-b  # limit to these slugs
// Event posts (category: event) are left untouched — their titles come from
// discover-events.mjs. Placeless posts just shed the trailing filler clause.
// Venue posts pass their stored Google rating into makeTitle, which may append
// the honest "(4.9★)" review-intent badge when the title stays within 60 chars.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { editFrontmatter, DELETE } from './lib/frontmatter-edit.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTitle } from './lib/titles.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '')
  .replace('--only=', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

const files = (await readdir(DIR)).filter(
  (f) => f.endsWith('.md') && (!ONLY.length || ONLY.includes(f.replace(/\.md$/, '')))
);
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
    // Stored Google rating (never invented) → makeTitle may append "(4.9★)".
    const place = {
      rating: afterPlace.match(/\n[ \t]+rating:[ \t]*([\d.]+)/)?.[1],
      userRatingsTotal: afterPlace.match(/\n[ \t]+userRatingsTotal:[ \t]*(\d+)/)?.[1],
    };
    newTitle = makeTitle(name, { category, region }, place);
  } else {
    // Event OR placeless post — keep the name, strip only the trailing
    // "A Visitor's Guide[ in <region>]" filler. Events from discover-events say
    // "…: What to Know (City)" (no filler) and are left unchanged. Never rebuild
    // an event via makeTitle — its "Travel Guide" suffix is wrong for a festival.
    newTitle = oldTitle
      .replace(/:\s*A Visitor'?s Guide(?:\s+in\s+.+?)?\s*$/i, '')
      .replace(/\s*[-–—]\s*A Visitor'?s Guide(?:\s+in\s+.+?)?\s*$/i, '')
      .trim();
    // Collapse "Suncheon Bay in Suncheon" → "Suncheon Bay": if the name already
    // contains the city, the trailing " in <city>" is a redundant echo.
    const reg = region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const echo = newTitle.match(new RegExp(`^(.*?)\\s+in\\s+${reg}$`, 'i'));
    if (echo && new RegExp(`\\b${reg}\\b`, 'i').test(echo[1])) newTitle = echo[1].trim();
  }

  if (!newTitle || newTitle === oldTitle) { skip++; continue; }
  // JSON 따옴표는 YAML 따옴표가 아니다. 백슬래시 이스케이프 규칙이 다르고, 제목에
  // 콜론이나 따옴표가 들어오면 프론트매터가 깨진다. 공용 편집기가 js-yaml 으로
  // 직렬화하고, 쓴 결과를 다시 읽어 본문과 나머지 필드까지 대조한다.
  let out;
  try { out = editFrontmatter(t, { title: newTitle }); }
  catch (err) { console.log(`  ⚠️ ${p}: 제목을 안전하게 못 바꿈 — ${err.message}`); skip++; continue; }
  if (out === t) { skip++; continue; }
  changed++;
  if (samples.length < 8) samples.push(`  ${oldTitle}\n   → ${newTitle}`);
  if (APPLY) await writeFile(p, out, 'utf8');
}
console.log(samples.join('\n'));
console.log(`\n${changed} titles rewritten, ${skip} unchanged (${APPLY ? 'APPLIED' : 'dry-run'}).`);
