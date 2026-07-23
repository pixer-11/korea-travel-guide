// One-off: parse eventStartDate/eventEndDate for EXISTING event posts from their
// prose (title/description/quickAnswer), where the date was only ever human text.
// New posts get ISO dates directly from discover-events; this backfills the rest.
// Unparseable posts are left alone (they stay "upcoming"). Idempotent.
//
//   node scripts/backfill-event-dates.mjs          # dry-run
//   node scripts/backfill-event-dates.mjs --apply
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');

const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
const iso = (y, mo, d) => `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

function parseDates(text) {
  // "August 1–9, 2026" | "July 25-26, 2026" | "August 1, 2026"
  let m = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?(?:,)?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const mo = MONTHS[m[1].toLowerCase()], d1 = +m[2], d2 = m[3] ? +m[3] : +m[2], y = +m[4];
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) return { start: iso(y,mo,d1), end: iso(y,mo,Math.max(d1,d2)) };
  }
  // "1–9 August 2026" | "25 July 2026"
  m = text.match(/\b(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (m && MONTHS[m[3].toLowerCase()]) {
    const mo = MONTHS[m[3].toLowerCase()], d1 = +m[1], d2 = m[2] ? +m[2] : +m[1], y = +m[4];
    if (d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31) return { start: iso(y,mo,d1), end: iso(y,mo,Math.max(d1,d2)) };
  }
  return null;
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
let done = 0, skip = 0, already = 0;
for (const f of files) {
  const p = join(DIR, f);
  const t = await readFile(p, 'utf8');
  const fmEnd = t.indexOf('\n---', 3);
  const fm = t.slice(0, fmEnd);
  if (!/^category:\s*["']?event/m.test(fm)) continue;
  if (/^eventEndDate:/m.test(fm)) { already++; continue; }
  const title = fm.match(/^title:\s*(.+)$/m)?.[1] || '';
  const desc = fm.match(/^description:\s*(.+)$/m)?.[1] || '';
  const qa = fm.match(/^quickAnswer:\s*(.+)$/m)?.[1] || '';
  const d = parseDates(desc) || parseDates(title) || parseDates(qa);
  if (!d) { skip++; console.log(`  ✗ no date: ${f}`); continue; }
  done++;
  console.log(`  ✓ ${d.start}${d.end !== d.start ? '→' + d.end : ''}  ${f}`);
  if (APPLY) {
    const inject = `\neventStartDate: '${d.start}'\neventEndDate: '${d.end}'`;
    const out = t.replace(/^(pubDate:.*)$/m, `$1${inject}`);
    if (out !== t) await writeFile(p, out, 'utf8');
  }
}
console.log(`\n${done} dated, ${skip} unparseable, ${already} already had dates (${APPLY ? 'APPLIED' : 'dry-run'}).`);
