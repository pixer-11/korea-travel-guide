// One-off/idempotent: regenerate meta `description` for existing posts so none
// end mid-clause with a dangling "…". New posts already use the sentence-boundary
// clip in generate.mjs; this backfills the rest from their quickAnswer.
//   node scripts/backfill-descriptions.mjs           # dry-run
//   node scripts/backfill-descriptions.mjs --apply
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const APPLY = process.argv.includes('--apply');

// Same clip as generate.mjs: end on a full sentence within the limit.
const clip = (s, n = 158) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastPunct = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastPunct >= 60) return cut.slice(0, lastPunct + 1).trim();
  return cut.replace(/\s+\S*$/, '').replace(/[\s,;:.\-–—]+$/, '').trim();
};

const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
let changed = 0, skip = 0;
for (const f of files) {
  const p = join(DIR, f);
  const t = await readFile(p, 'utf8');
  const qaRaw = t.match(/^quickAnswer:[ \t]*(.+)/m)?.[1];
  if (!qaRaw) { skip++; continue; } // no quickAnswer → keep templated description
  const qa = qaRaw.replace(/[\r\n]+$/, '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  if (!qa) { skip++; continue; }
  const newDesc = clip(qa);
  const out = t.replace(/^description:[ \t]*.+/m, `description: ${JSON.stringify(newDesc)}`);
  if (out === t) { skip++; continue; }
  changed++;
  if (changed <= 4) console.log(`  ✓ ${f}\n     → ${newDesc}`);
  if (APPLY) await writeFile(p, out, 'utf8');
}
console.log(`\n${changed} descriptions rewritten, ${skip} unchanged (${APPLY ? 'APPLIED' : 'dry-run'}).`);
