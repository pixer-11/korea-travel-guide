#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ENGLISH WORDS LEFT IN A CJK TRANSLATION.
//
//  The gate in translate-posts.mjs stops new ones. This finds the ones already
//  published — 2026-09-07..09 the model emitted the English gloss instead of
//  the word (観光 → "observation", 建立 → "completion", 금박 → "golded"), and
//  it reached <title>, meta description and JSON-LD on the languages Bing sends
//  most of our traffic from.
//
//  Prints the count EXAMINED as well as the count found, and fails when it
//  examined nothing — a checker that scanned zero files reporting "clean" is
//  the defect this repo has been bitten by most.
//
//    node scripts/audit-latin-drops.mjs            # report, exit 1 on findings
//    node scripts/audit-latin-drops.mjs --list     # slugs only, for a repair run
// ─────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { latinDrops, CJK_LANGS } from './lib/latin-drop.mjs';
import { requireExamined } from './lib/examined.mjs';

const ROOTS = ['src/content/i18n', 'src/content/itineraries-i18n', 'src/content/essentials-i18n'];
const LIST = process.argv.includes('--list');

let examined = 0;
const findings = [];

for (const root of ROOTS) {
  for (const lang of CJK_LANGS) {
    const dir = join(root, lang);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      const path = join(dir, file);
      examined++;
      const drops = latinDrops(readFileSync(path, 'utf8'), lang);
      if (drops.length) findings.push({ path, lang, slug: file.replace(/\.md$/, ''), drops });
    }
  }
}

if (LIST) {
  for (const f of findings) console.log(`LATIN-DROP: ${f.lang}/${f.slug}`);
  process.exit(0);
}

console.log(`🈳 ${examined} CJK translation(s) examined — ${findings.length} with an English word where a translated word belongs`);
for (const f of findings.slice(0, 40)) {
  console.log(`LATIN-DROP: ${f.lang}/${f.slug} — ${f.drops.slice(0, 4).join(' · ')}`);
}
if (findings.length > 40) console.log(`  … and ${findings.length - 40} more`);

// A run that read nothing is not a clean run.
requireExamined(examined, 100, 'audit-latin-drops');
if (findings.length) process.exit(1);
console.log('✓ no English words left standing in a CJK translation.');
