#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  REPAIR INVENTED OUTCOMES — undo a prediction that became a result
//
//  Two commits on 2026-09-02 (695f6ccd, 4939abc5) ran fix-ended-event-tense
//  over the ended event guides. The promise sentences went, as intended. But
//  the model, told to "shift the tense", also promoted plans and advice into
//  history: "expect fans to fly in" → "Fans flew in from across the Gulf";
//  "the shuttle runs on event days" → "the shuttle ran … the option most
//  concertgoers used"; "the peloton will roll into Paris" → "rolled into
//  Paris". Nobody verified any of it. The guard measured length, headings and
//  the promise regexes and had no notion of an outcome, so it all shipped.
//
//  This tool puts the two texts side by side — what the guide said BEFORE the
//  rewrite and what it says NOW — and asks for a version that keeps the tense
//  fix but asserts nothing the original never stated. Then a mechanical check
//  (scripts/lib/invented-outcomes.mjs) reads the answer against the original;
//  a field that still claims an outcome is refused, logged, and left for a
//  human. Only fields the two commits actually changed are touched, and body
//  edits go paragraph by paragraph so the diff stays the size of the fault.
//
//   DRY=1 node scripts/repair-invented-outcomes.mjs     # show, write nothing
//   node scripts/repair-invented-outcomes.mjs           # apply
//   COMMITS="695f6ccd 4939abc5" ONLY=tokyo-formula-e … # narrow the run
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { endsMidThought } from '../src/lib/rewrite-guard.mjs';
import { OFFENDING_CLAIM } from '../src/lib/ended-event-claims.mjs';
import { inventedOutcomes } from './lib/invented-outcomes.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DRY = process.env.DRY === '1';
const COMMITS = (process.env.COMMITS || '695f6ccd 4939abc5').split(/\s+/).filter(Boolean);
const ONLY = process.env.ONLY || '';
// Same model and the same thinking-off reasoning as the tense tool: this is
// clerical, both texts are in the prompt, and Sonnet 5's default reasoning
// eats the output budget before the answer starts (measured 2026-08-30).
const MODEL = 'claude-sonnet-5';
const DELETE = '[DELETE]';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

// The pre-rewrite text is the parent of the FIRST commit; every file the two
// commits touched is compared against that.
const BASE = `${COMMITS[0]}^`;
const files = [...new Set(git('show', '--name-only', '--format=', ...COMMITS)
  .split(/\r?\n/).filter((p) => p.startsWith('src/content/posts/') && p.endsWith('.md')))]
  .filter((p) => !ONLY || p.includes(ONLY)).sort();

function parse(raw) {
  const cut = raw.indexOf('\n---', 3);
  const fmText = raw.slice(4, cut);
  return { fm: yaml.load(fmText), fmText, body: raw.slice(cut + 4) };
}

async function neutralise(kind, title, original, current, feedback = null) {
  const msg = await client.messages.create({
    model: MODEL,
    thinking: { type: 'disabled' },
    max_tokens: Math.min(16000, Math.max(1200, Math.ceil(current.length / 2) + 600)),
    messages: [{
      role: 'user',
      content: `Below are two versions of the ${kind} of a travel guide for "${title}", an event that has ENDED.

ORIGINAL was written before the event. It predicted, planned, or advised.
REWRITE was produced afterwards by a tool that removed future promises — but it also claimed things happened that nobody verified.

Rule: the original predicted or advised; the rewrite must not claim that anything happened, ran, drew, was used, applied, took place, or how the crowd behaved, unless the original already stated it as fact.

What is NOT an outcome, and must be left exactly as REWRITE has it: a standing fact about the venue, city or transit ("the arena sits north of the city", "the shuttle runs on event days"); a generic description of how such events usually work ("typically", "usually", "tend to"); a fact the original already stated ("doors open at 6pm" → "doors opened at 6pm"); and an ordinary past tense that carries no new claim ("## Why this show mattered", "the tour was his latest victory lap"). If REWRITE already satisfies the rule, copy the whole REWRITE text back word for word (the text itself, not the label) — most passages need no change at all, and a needless change is a defect.

Produce a corrected version of REWRITE that:
(a) contains no future promise (no "will be announced", "check closer to the date", "once tickets go on sale", "TBA", "expect the lineup to drop" and the like);
(b) asserts no outcome absent from ORIGINAL — allowed forms are "was scheduled to", "was announced as", "organisers planned", "the published plan was", "was expected to", a timeless present for standing facts ("the shuttle runs on event days", "the venue sits north of the city"), or simply deleting the sentence;
(c) keeps every verifiable fact (dates, venues, prices, names, numbers) from ORIGINAL;
(d) changes nothing else — same structure, same markdown, same language, roughly the same length. Prefer the smallest edit: copy every sentence of REWRITE that already satisfies (a)–(c) verbatim. Do not add hedges, disclaimers or commentary that appear in neither version ("treat this as a framework", "weren't detailed here"). Do not add a sentence saying the event has ended.
${feedback ? `\nYour previous answer was rejected: ${feedback}. Fix exactly that and change nothing else.\n` : ''}
Reply with ONLY the corrected ${kind}, no preamble, no quotes around it.${kind.startsWith('body') ? ` If the whole passage should be deleted, reply with exactly ${DELETE}.` : ' A Quick Answer or FAQ answer must not be deleted — rephrase it.'}

=== ORIGINAL ===
${original}

=== REWRITE ===
${current}`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') { console.log(`   ⚠️  ${kind}: response hit the token ceiling — discarded unread`); return null; }
  const text = (msg.content.find((c) => c.type === 'text')?.text || '').trim();
  return text === DELETE ? '' : text;
}

const refused = [];   // { file, field, sentence, verb }
let fieldsSeen = 0, fieldsChanged = 0, filesChanged = 0;

/**
 * Ask for a neutral version and hold it to the four rules mechanically.
 * Returns the accepted text (possibly '' for "delete"), or null to keep the
 * current text untouched.
 */
async function repairField(file, field, title, original, current, { headings = false, tries = 2 } = {}) {
  fieldsSeen++;
  const already = inventedOutcomes(original, current);
  let out = null, problems = [], invented = [], feedback = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    out = await neutralise(field, title, original, current, feedback);
    if (out === null) return null;
    if (out === current) { console.log(`   ${field}: unchanged by the model${already.length ? ` — ⚠️  still carries "${already[0].verb}"` : ''}`); if (already.length) refuse(file, field, already); return null; }
    problems = [];
    // Same jury as the tense tool and the validator: a promise may not survive.
    if (OFFENDING_CLAIM.test(out)) problems.push(`future promise survived: "${out.match(OFFENDING_CLAIM)?.[0]}"`);
    invented = inventedOutcomes(original, out);
    if (invented.length) problems.push(`invented outcome: "${invented[0].sentence}"`);
    if (out && endsMidThought(out)) problems.push('ends mid-thought');
    // The prompt labels its two inputs; on 2026-09-03 one answer came back
    // headed "=== CORRECTED ===" and the label was written into Tokyo's body.
    if (/^\s*===.*===\s*$/m.test(out) || /^\s*(?:ORIGINAL|REWRITE|CORRECTED)\s*:?\s*$/m.test(out)) problems.push('contains a label line');
    if (headings) {
      const count = (s) => (s.match(/^#{2,6}\s+.*/gm) || []).length;
      if (count(out) < count(current)) problems.push('lost a heading');
    }
    // A Quick Answer or FAQ answer has nowhere to go: an empty answer is a
    // broken FAQPage, not a repair (the first DRY run deleted Kodaline's).
    if (!out && !headings) problems.push('deleted a frontmatter field');
    // Deleting the offending sentences is allowed; deleting the paragraph is
    // not — and neither is padding it with commentary.
    if (out && out.length < current.length * 0.3) problems.push(`too short (${out.length}/${current.length})`);
    if (out && out.length > current.length * 1.2 + 80) problems.push(`grew (${out.length}/${current.length}) — added text that was in neither version`);
    if (!problems.length) break;
    feedback = problems.join('; ');
    if (attempt + 1 < tries) console.log(`   ↻ ${field}: attempt ${attempt + 1} rejected (${feedback.slice(0, 140)}) — retrying`);
  }
  if (problems.length) {
    console.log(`   ⚠️  ${field}: REFUSED — ${problems.join('; ')}`);
    refuse(file, field, invented.length ? invented : already);
    return null;
  }
  fieldsChanged++;
  console.log(`   ${field}: ${already.length ? `neutralised "${already.map((h) => h.verb).join('", "')}"` : 'rewritten'}`);
  if (DRY) {
    console.log(`      before: ${current.replace(/\s+/g, ' ').slice(0, 260)}`);
    console.log(`      after : ${(out || '(deleted)').replace(/\s+/g, ' ').slice(0, 260)}`);
  }
  return out;
}

function refuse(file, field, hits) {
  for (const h of (hits.length ? hits : [{ sentence: '(no outcome verb — see log)', verb: '' }])) refused.push({ file, field, ...h });
}

// Longest common subsequence over paragraph arrays — the changed stretches
// between matching paragraphs are what the tense tool actually rewrote.
function alignGaps(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const gaps = [];
  let i = 0, j = 0, ai = 0, bj = 0;
  const flush = () => { if (ai < i || bj < j) gaps.push({ a: [ai, i], b: [bj, j] }); };
  while (i < n && j < m) {
    if (a[i] === b[j]) { flush(); i++; j++; ai = i; bj = j; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  i = n; j = m; flush();
  return gaps;
}

for (const rel of files) {
  const abs = join(ROOT, rel);
  const file = rel.slice('src/content/posts/'.length);
  let origRaw;
  try { origRaw = git('show', `${BASE}:${rel}`).replace(/\r\n/g, '\n'); } catch { console.log(`\n⏭️  ${file}: not in ${BASE}`); continue; }
  // core.autocrlf=true: the checkout is CRLF, the index is LF. Work in LF and
  // write back in whatever the file had, so the working copy stays one thing.
  const curDisk = await readFile(abs, 'utf8');
  const EOL = /\r\n/.test(curDisk) ? '\r\n' : '\n';
  const curRaw = curDisk.replace(/\r\n/g, '\n');
  if (origRaw === curRaw) continue;
  const orig = parse(origRaw), cur = parse(curRaw);
  if (!cur.fm || cur.fm.category !== 'event') continue;
  console.log(`\n📝 ${file}`);
  const title = cur.fm.title;
  let nextFm = { ...cur.fm }, fmChanged = false, bodyChanged = false;

  if (cur.fm.quickAnswer !== orig.fm.quickAnswer && orig.fm.quickAnswer) {
    const out = await repairField(file, 'Quick Answer', title, orig.fm.quickAnswer, cur.fm.quickAnswer);
    if (out) { nextFm.quickAnswer = out; fmChanged = true; }
  }
  if (Array.isArray(cur.fm.faq)) {
    const origFaq = Array.isArray(orig.fm.faq) ? orig.fm.faq : [];
    const byQ = new Map(origFaq.map((x) => [String(x?.q || ''), x]));
    const faq = [];
    for (let k = 0; k < cur.fm.faq.length; k++) {
      const item = cur.fm.faq[k];
      const before = origFaq[k]?.q === item?.q ? origFaq[k] : byQ.get(String(item?.q || ''));
      if (!before || before.a === item.a) { faq.push(item); continue; }
      const out = await repairField(file, `FAQ answer #${k + 1}`, title, before.a, item.a);
      faq.push(out ? { ...item, a: out } : item);
      if (out) fmChanged = true;
    }
    nextFm.faq = faq;
  }

  // Body: only the changed paragraphs move; the separators between them are
  // kept as they are so the diff is the size of the fault.
  const tokens = cur.body.split(/(\n{2,})/);
  const curParas = tokens.filter((_, k) => k % 2 === 0);
  const origParas = orig.body.split(/\n{2,}/);
  const gaps = alignGaps(origParas.map((p) => p.trim()), curParas.map((p) => p.trim()));
  const replacements = [];
  for (const g of gaps) {
    const before = origParas.slice(...g.a).join('\n\n').trim();
    const now = curParas.slice(...g.b).join('\n\n').trim();
    if (!now) continue;                                  // a deletion — nothing to neutralise
    const out = await repairField(file, `body ¶${g.b[0] + 1}${g.b[1] - g.b[0] > 1 ? `–${g.b[1]}` : ''}`, title, before || '(no counterpart — new paragraph)', now, { headings: true });
    if (out !== null) replacements.push({ range: g.b, out });
  }
  let nextBody = cur.body;
  if (replacements.length) {
    const outParas = curParas.slice();
    for (const r of replacements.sort((x, y) => y.range[0] - x.range[0])) {
      outParas.splice(r.range[0], r.range[1] - r.range[0], ...(r.out ? [r.out.replace(/\r\n/g, '\n')] : []));
    }
    // The body starts with the newline after `---` and ends with one; both
    // came through the split as empty edge paragraphs and are put back here.
    const inner = outParas.filter((p, k) => !(p === '' && (k === 0 || k === outParas.length - 1)));
    bodyChanged = true;
    nextBody = `\n${inner.join('\n\n')}\n`;
  }

  if (!fmChanged && !bodyChanged) continue;
  filesChanged++;
  if (DRY) continue;
  // Same serialisation as fix-ended-event-tense.mjs, so the two diff alike —
  // and untouched frontmatter is copied through, not re-dumped.
  const fmOut = fmChanged
    ? yaml.dump(nextFm, { lineWidth: -1, noRefs: true, sortKeys: false })
    : cur.fmText.replace(/^\n/, '') + '\n';
  await writeFile(abs, `---\n${fmOut}---${nextBody}`.replace(/\n/g, EOL), 'utf8');
}

console.log(`\n📦 files compared ${files.length} · fields examined ${fieldsSeen} · neutralised ${fieldsChanged} in ${filesChanged} files · refused ${refused.length}${DRY ? ' (DRY)' : ''}`);
if (refused.length) {
  console.log('\n✋ left for hand repair (the model still asserted an outcome the original never stated):');
  for (const r of refused) console.log(`   ${r.file} · ${r.field} · "${r.verb}" · ${r.sentence.slice(0, 160)}`);
}
console.log(`INVENTED_OUTCOMES_SUMMARY files=${filesChanged} fields=${fieldsChanged} refused=${refused.length}`);
