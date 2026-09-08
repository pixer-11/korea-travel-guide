#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  THE PHRASES THAT MAKE A GUIDE READ AS MACHINE-WRITTEN
//
//  The owner asked for the writing to stop smelling of AI. There is no skill for
//  it, so the first thing was to find out whether the problem was real. Measured
//  2026-09-08 across 1,422 published English guides (946,275 words):
//
//      in the heart of       54     iconic          21
//      isn't just X, it's Y  48     hidden gem      16
//      must-visit/must-see   33     not just…but    13
//      whether you're X or Y 24     bustling         8
//
//      231 in total — 0.2 per thousand words, and 85% of guides have none.
//
//  So it is a narrow problem, not a pervasive one: six phrases carry most of it.
//  Two things follow from that, and only the first one really matters:
//
//   1. lib/writer.mjs now bans them by name, with those counts as the reason.
//      A phrase the generator never writes needs no repair pass. This is the
//      part that scales.
//   2. this audit measures what is already published, so the number can be seen
//      moving instead of guessed at.
//
//  It REPORTS. It does not hold a post back and it does not rewrite prose:
//  quarantining a guide over the word "iconic" would cost more than the word,
//  and a machine rewriting sentences is how good paragraphs get shaved.
//
//    node scripts/audit-ai-tells.mjs           # summary
//    node scripts/audit-ai-tells.mjs --list    # every post, worst first
// ─────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/content/posts';
const LIST = process.argv.includes('--list');

// Each entry was counted in the corpus before it was added. A phrase nobody
// writes is not worth a rule, and a phrase people legitimately write is worth
// leaving alone.
export const TELLS = {
  'in the heart of': /\bin the heart of\b/gi,
  "isn't just…it's": /\b(?:isn't|is not) just\b[^.]{0,60}\bit(?:'s| is)\b/gi,
  'must-visit/see': /\bmust[- ](?:visit|see|try|do)\b/gi,
  'whether you…or': /\bwhether you(?:'re| are)?\b[^.]{0,80}\bor\b/gi,
  iconic: /\biconic\b/gi,
  'hidden gem': /\bhidden gems?\b/gi,
  'not just…but': /\bnot just\b[^.]{0,60}\bbut\b/gi,
  bustling: /\bbustling\b/gi,
  nestled: /\bnestled\b/gi,
  unwind: /\bunwind\b/gi,
  vibrant: /\bvibrant\b/gi,
  tapestry: /\btapestry\b/gi,
  'testament to': /\btestament to\b/gi,
  delve: /\bdelve\b/gi,
  'a myriad of': /\ba myriad of\b/gi,
  plethora: /\bplethora\b/gi,
  breathtaking: /\bbreathtaking\b/gi,
  'immerse yourself': /\bimmerse yourself\b/gi,
  'when it comes to': /\bwhen it comes to\b/gi,
  'in conclusion': /\bin conclusion\b/gi,
  "it's worth noting": /\bit(?:'s| is) worth noting\b/gi,
  'rich history/culture': /\brich (?:history|culture|heritage)\b/gi,
  'foodie paradise': /\b(?:foodie|shopper's|traveller?'s) (?:paradise|haven|dream)\b/gi,
};

/** Count the tells in one article body. Exported for the test. */
export function countTells(body) {
  const found = {};
  for (const [name, re] of Object.entries(TELLS)) {
    const n = (body.match(re) || []).length;
    if (n) found[name] = n;
  }
  return found;
}

const totals = {};
const perPost = [];
let posts = 0;
let words = 0;

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  if (/^draft:\s*true\s*$/m.test(raw)) continue;
  const i = raw.indexOf('\n---', 3);
  if (i < 0) continue;
  const body = raw.slice(i + 4);
  posts++;
  words += body.split(/\s+/).filter(Boolean).length;
  const found = countTells(body);
  const hits = Object.values(found).reduce((a, b) => a + b, 0);
  if (hits) {
    perPost.push({ slug: f.replace(/\.md$/, ''), hits, found });
    for (const [k, n] of Object.entries(found)) totals[k] = (totals[k] || 0) + n;
  }
}

// Reading nothing is not reading clean — the lesson from every other gate here.
if (!posts) {
  console.log('AI-TELLS: no published post was read at all — the content path must have changed.');
  process.exit(1);
}

const total = Object.values(totals).reduce((a, b) => a + b, 0);
const per1k = ((total / words) * 1000).toFixed(2);
console.log(`${posts} published guide(s), ${words.toLocaleString()} words — ${total} machine-sounding phrase(s), ${per1k} per 1,000 words`);
console.log(`${posts - perPost.length} guide(s) carry none (${(((posts - perPost.length) / posts) * 100).toFixed(0)}%)`);

for (const [name, n] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}

perPost.sort((a, b) => b.hits - a.hits);
for (const p of (LIST ? perPost : perPost.slice(0, 10))) {
  console.log(`AI-TELL: ${p.slug} — ${Object.entries(p.found).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ')}`);
}
if (!LIST && perPost.length > 10) console.log(`… and ${perPost.length - 10} more (--list for all)`);

// Always exits 0. This is a measurement, not a gate: the generator prompt is
// where the phrases are prevented, and holding a live guide over one adjective
// would cost more than the adjective.
console.log(`\nAI_TELLS total=${total} per1k=${per1k} posts=${perPost.length}/${posts}`);
