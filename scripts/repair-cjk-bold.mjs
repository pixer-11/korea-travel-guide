#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  CJK BOLD REPAIR — fixes translations whose ** cannot close, so the page
//  shows literal asterisks instead of bold. See lib/cjk-bold.mjs for why the
//  shape occurs. translate-posts.mjs now prevents new ones; this cleans up
//  what shipped before that.
//
//  Only rewrites lines the renderer says are broken, and only when the rewrite
//  renders — a line it cannot fix is reported and left exactly as written.
//
//    node scripts/repair-cjk-bold.mjs
//    DRY=1 node scripts/repair-cjk-bold.mjs
// ─────────────────────────────────────────────────────────────
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixCjkBold, rendersBold } from './lib/cjk-bold.mjs';

const ROOTS = ['src/content/i18n', 'src/content/essentials-i18n', 'src/content/itineraries-i18n', 'src/content/static-pages-i18n', 'src/content/essentials-topics-i18n'];
const DRY = process.env.DRY === '1';

let scanned = 0, fixed = 0, stubborn = [];

for (const root of ROOTS) {
  let langs;
  try { langs = await readdir(root); } catch { continue; }
  for (const lang of langs) {
    let files;
    try { files = (await readdir(join(root, lang))).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      const p = join(root, lang, f);
      const raw = await readFile(p, 'utf8');
      // Body only: frontmatter renders as plain text, and ** there is literal.
      const cut = raw.indexOf('\n---', 3);
      if (cut < 0) continue;
      const head = raw.slice(0, cut + 4);
      const body = raw.slice(cut + 4);
      scanned++;
      if (!body.includes('**')) continue;

      const broken = body.split('\n').filter((l) => l.includes('**') && !rendersBold(l));
      if (!broken.length) continue;

      const repaired = fixCjkBold(body);
      const left = repaired.split('\n').filter((l) => l.includes('**') && !rendersBold(l));
      if (left.length) stubborn.push([p, left[0].trim().slice(0, 100)]);
      if (repaired === body) continue;

      fixed++;
      console.log(`  ✎ ${p} (${broken.length - left.length} line(s))`);
      if (!DRY) await writeFile(p, head + repaired, 'utf8');
    }
  }
}

console.log(`\n🔧 ${scanned} translated file(s) scanned · ${fixed} repaired${DRY ? ' (DRY — nothing written)' : ''}`);
if (stubborn.length) {
  console.log(`⚠️  ${stubborn.length} line(s) still not rendering — left untouched:`);
  stubborn.slice(0, 10).forEach(([p, l]) => console.log(`   ${p}\n     ${l}`));
}
