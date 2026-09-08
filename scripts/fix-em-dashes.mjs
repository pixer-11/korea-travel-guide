#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EM DASHES OUT OF THE ENGLISH PROSE
//
//  The em dash is the single loudest machine-writing tell in this site's guides,
//  and it is the one the writer prompt already bans. Measured 2026-09-08:
//
//      published in July    11.30 per 1,000 words
//      published in August  11.87
//      published in September   0.00   (52 guides, not one dash)
//
//  So the prompt ban works and nothing new is leaking. What is left is 9,551
//  dashes in the guides written before it, spread over 1,370 posts.
//
//  This replaces them WITHOUT an LLM. Rewriting 946,000 words through a model to
//  remove punctuation would cost more than the punctuation, and a model rewriting
//  prose is how good paragraphs get shaved (this repo has the scars).
//
//  The rule is not one substitution. Reading 20 real sentences first: roughly
//  three in five have an INDEPENDENT CLAUSE after the dash, where a comma would
//  be a splice —
//
//      "…isn't the postcard version — it's better, in a scruffier way."
//      "…run directly to Aberdeen — journey is roughly 20-30 minutes."
//
//  and the rest have a fragment or an appositive, where a full stop would leave
//  a sentence fragment —
//
//      "…quirky sculptures and benches — some curved like waves."
//      "…opposite an ADIB bank branch — a handy landmark for a taxi driver."
//
//  So: independent clause takes a full stop and a capital, everything else takes
//  a comma. A PAIR of dashes inside one sentence is a parenthetical and both
//  become commas.
//
//  Nothing but punctuation changes. The word sequence is compared before and
//  after and any post whose words move is left untouched.
//
//    node scripts/fix-em-dashes.mjs            # report, change nothing
//    node scripts/fix-em-dashes.mjs --apply
//    node scripts/fix-em-dashes.mjs --sample=30   # show before/after pairs
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/content/posts';
const APPLY = process.argv.includes('--apply');
const SAMPLE = Number((process.argv.find((a) => a.startsWith('--sample=')) || '').slice(9) || 0);

// A clause that could stand alone starts with a subject the reader can see, or
// with a bare imperative. Both lists were drawn from the corpus, not invented.
// The contraction has no space in it: "it's fast" is one token, and requiring
// `it` + space + `'s` missed every one of them — the first dry run turned
// "The MTR is the move — it's fast" into a comma splice.
const SUBJECTS = /^(?:it|they|there|this|that|these|those|he|she|we|you|i)(?:'(?:s|ll|ve|re|d)|\s+(?:is|are|was|were|has|have|had|will|would|can|could|should|do|does|did|don't|doesn't|didn't|won't|can't|isn't|aren't|wasn't|weren't))/i;
const IMPERATIVE = /^(?:expect|ride|bring|book|check|plan|budget|allow|aim|arrive|avoid|go|take|walk|head|skip|wear|pack|ask|look|try|leave|start|keep|stick|note|remember|don't|do)\b/i;
// "the train line can mean…", "most vendors don't take cards", "racks are provided"
const DET_SUBJECT = /^(?:the|a|an|most|some|each|every|both|all|many|few|one|two|three|weekends?|weekdays?|mornings?|evenings?|prices?|entry|staff|tickets?)\b[^,.;:]{0,40}?\s(?:'s|is|are|was|were|has|have|had|will|would|can|could|should|do|does|don't|doesn't|means?|runs?|costs?|takes?|opens?|closes?|starts?|sits?|stays?|gets?|comes?|goes?)\b/i;

const isIndependent = (s) => SUBJECTS.test(s) || IMPERATIVE.test(s) || DET_SUBJECT.test(s);

/** Words, ignoring punctuation and spacing — the invariant this repair must keep. */
const wordsOf = (s) => s.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim().split(' ');

export function fixEmDashes(body) {
  const pairs = [];
  const out = body.split('\n').map((line) => {
    // Leave code fences, link targets and tables alone.
    if (/^\s*(?:```|\||<)/.test(line) || !line.includes('—')) return line;

    const dashes = (line.match(/\s—\s/g) || []).length;

    // Two dashes in one line bracket a parenthetical: both become commas.
    if (dashes >= 2) {
      // Commas around a bracketed LIST produce a row of commas that reads as
      // one long enumeration: "Every surface, pillars, ceilings, archways, is
      // covered…". Parentheses keep the aside an aside.
      const next = line.replace(/\s—\s([^—]*?)\s—\s/g, (m, inner) =>
        (inner.includes(',') ? ` (${inner}) ` : `, ${inner}, `))
        .replace(/\s—\s/g, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/\s+([,.)])/g, '$1')
        .replace(/\(\s+/g, '(')
        // The second dash often carried the comma of a relative clause:
        // "…the emirate — 39,000 ratings — which is…". Once the aside is in
        // brackets, the clause still needs its comma.
        .replace(/\)\s+(which|who|whose|where|and|but|so)\b/gi, '), $1');
      if (next !== line) pairs.push([line, next]);
      return next;
    }

    const next = line.replace(/(\S)\s*—\s*(\S)/g, (m, before, after, offset, whole) => {
      const rest = whole.slice(offset + m.length - 1);
      if (isIndependent(rest)) return `${before}. ${after.toUpperCase()}`;
      return `${before}, ${after}`;
    });
    if (next !== line) pairs.push([line, next]);
    return next;
  }).join('\n');

  return { text: out, pairs };
}

let posts = 0, changed = 0, dashes = 0, refused = 0;
const samples = [];

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  const i = raw.indexOf('\n---', 3);
  if (i < 0) continue;
  const head = raw.slice(0, i + 4);
  const body = raw.slice(i + 4);
  if (!body.includes('—')) continue;
  posts++;

  const n = (body.match(/—/g) || []).length;
  const { text, pairs } = fixEmDashes(body);

  // The words must not move. Punctuation and one capital letter is the whole
  // permitted change; anything else means the repair is doing something it was
  // not asked to do, and this repo has been bitten by exactly that.
  if (wordsOf(text).join(' ') !== wordsOf(body).join(' ')) {
    console.log(`  ⚠️ ${f}: the words moved — left untouched`);
    refused++;
    continue;
  }
  if (text.includes('—')) {
    // A dash that survived is one this rule did not understand (no spaces
    // around it, inside a table). Report rather than half-fix.
    console.log(`  · ${f}: ${(text.match(/—/g) || []).length} dash(es) left as they are`);
  }

  dashes += n;
  changed++;
  if (samples.length < SAMPLE) samples.push(...pairs.slice(0, 2));
  if (APPLY) writeFileSync(join(DIR, f), head + text, 'utf8');
}

for (const [a, b] of samples.slice(0, SAMPLE)) {
  console.log(`\n  전: ${a.trim().slice(0, 150)}`);
  console.log(`  후: ${b.trim().slice(0, 150)}`);
}

console.log(`\nEM_DASH_FIX posts=${changed}/${posts} dashes=${dashes} refused=${refused}${APPLY ? '' : ' (dry run — --apply to write)'}`);
