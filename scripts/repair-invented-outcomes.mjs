#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  REPAIR INVENTED OUTCOMES — a guide written before the event may not
//  say what happened at it
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
//  The first repair (09-03, f90b60d0) compared each touched field with its
//  pre-rewrite text and neutralised what the rewrite had added. That left the
//  article contradicting itself: "was scheduled for" in the Quick Answer,
//  "took place" in the FAQ under it — because the FAQ claim pre-dated the
//  rewrite, and a claim that pre-dates the rewrite is unverified all the same.
//  EVERY event guide is written before the event. So this tool now reads the
//  whole article of every ENDED event, field by field (Quick Answer, each FAQ
//  answer, each body paragraph), and neutralises any sentence that states an
//  outcome of the event's own edition — leaving prior editions ("the 2025
//  edition sold out"), history ("has hosted") and habit ("typically") alone.
//  Only fields the mechanical detector (scripts/lib/invented-outcomes.mjs)
//  flags are sent to the model; the answer is held to the promise regexes,
//  the same detector, a no-new-outcome check against the current text, a
//  growth cap and structure checks, and a field that still fails is refused,
//  logged and left for a human. A whole-article check runs last, so no field
//  can assert an outcome while another says "was scheduled".
//
//   DRY=1 node scripts/repair-invented-outcomes.mjs     # show, write nothing
//   node scripts/repair-invented-outcomes.mjs           # apply
//   ONLY=tokyo-formula-e node scripts/repair-invented-outcomes.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { endsMidThought } from '../src/lib/rewrite-guard.mjs';
import { OFFENDING_CLAIM } from '../src/lib/ended-event-claims.mjs';
import { inventedOutcomes, ownEditionOutcomes } from './lib/invented-outcomes.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const DRY = process.env.DRY === '1';
const ONLY = process.env.ONLY || '';
const TODAY = new Date().toISOString().slice(0, 10);
// Same model and the same thinking-off reasoning as the tense tool: this is
// clerical, the whole text is in the prompt, and Sonnet 5's default reasoning
// eats the output budget before the answer starts (measured 2026-08-30).
const MODEL = 'claude-sonnet-5';
const DELETE = '[DELETE]';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The validator's reading of a date field: YAML hands back a Date for an
// unquoted 2026-08-15, and String(date) is never < TODAY.
const isoDay = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '');

function parse(raw) {
  const cut = raw.indexOf('\n---', 3);
  const fmText = raw.slice(4, cut);
  return { fm: yaml.load(fmText), fmText, body: raw.slice(cut + 4) };
}

async function neutralise(kind, title, endedOn, year, current, feedback = null) {
  const msg = await client.messages.create({
    model: MODEL,
    thinking: { type: 'disabled' },
    max_tokens: Math.min(16000, Math.max(1200, Math.ceil(current.length / 2) + 600)),
    messages: [{
      role: 'user',
      content: `Below is the ${kind} of a travel guide for "${title}", the ${year} edition of an event that ENDED on ${endedOn}. The guide was written BEFORE the event and nobody has verified what happened at it.

Rule: a sentence that states what happened at THIS edition — that it took place, was held, ran, drew or attracted a crowd, sold out, kicked off, wrapped up, who played, how the crowd behaved, what attendees did — is an unverified claim and must not stand. Change each such sentence to what was known beforehand: "was scheduled to", "was scheduled for", "was announced as", "organisers planned", "the published plan was", "was expected to", a timeless present for a standing fact ("the shuttle runs on event days", "the venue sits north of the city"), or delete the sentence.

What is NOT an outcome of this edition, and must be copied back exactly as it is: a fact about a PRIOR edition or history ("the 2025 edition sold out", "last year the race ran on a Sunday", "the venue has hosted the Commonwealth Games"); a generic description of how such events usually work ("typically", "usually", "tend to"); a standing fact about the venue, city or transit; a fact the guide could know beforehand (dates, venue, prices, names, the announced lineup); an ordinary past tense that carries no claim about the event ("## Why this show mattered", "the tour was his latest victory lap").

Produce a corrected ${kind} that:
(a) contains no future promise (no "will be announced", "check closer to the date", "once tickets go on sale", "TBA", "to be confirmed");
(b) asserts no outcome of this edition;
(c) keeps every verifiable fact (dates, venues, prices, names, numbers) and every prior-edition fact exactly;
(d) changes nothing else — same structure, same markdown, same language, roughly the same length. Copy every sentence that already satisfies (a)–(c) word for word. Do not add hedges, disclaimers or commentary that were not there ("treat this as a framework", "details weren't available"). Do not add a sentence saying the event has ended.
${feedback ? `\nYour previous answer was rejected: ${feedback}. Fix exactly that and change nothing else.\n` : ''}
Reply with ONLY the corrected ${kind} text, no preamble, no label, no quotes around it.${kind.startsWith('body') ? ` If the whole passage should be deleted, reply with exactly ${DELETE}.` : ' A Quick Answer or FAQ answer must not be deleted — rephrase it.'}

${current}`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') { console.log(`   ⚠️  ${kind}: response hit the token ceiling — discarded unread`); return null; }
  const text = (msg.content.find((c) => c.type === 'text')?.text || '').trim();
  return text === DELETE ? '' : text;
}

const refused = [];   // { file, field, sentence, verb }
let scanned = 0, fieldsSeen = 0, fieldsChanged = 0, filesChanged = 0;

/**
 * Ask for a neutral version and hold it to the rules mechanically.
 * Returns the accepted text (possibly '' for "delete"), or null to keep the
 * current text untouched.
 */
async function repairField(file, field, title, endedOn, year, current, { headings = false, tries = 2 } = {}) {
  fieldsSeen++;
  const already = ownEditionOutcomes(current, year);
  let out = null, problems = [], flagged = [], feedback = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    out = await neutralise(field, title, endedOn, year, current, feedback);
    if (out === null) return null;
    if (out === current) { console.log(`   ${field}: unchanged by the model — ⚠️  still carries "${already[0]?.verb}"`); refuse(file, field, already); return null; }
    problems = [];
    // Same jury as the tense tool and the validator: a promise may not survive.
    if (OFFENDING_CLAIM.test(out)) problems.push(`future promise survived: "${out.match(OFFENDING_CLAIM)?.[0]}"`);
    // The point of the exercise: no outcome of this edition may remain…
    flagged = ownEditionOutcomes(out, year);
    if (flagged.length) problems.push(`outcome of this edition survived: "${flagged[0].sentence}"`);
    // …and none may be introduced that the current text did not carry.
    const added = inventedOutcomes(current, out);
    if (added.length) { problems.push(`invented outcome: "${added[0].sentence}"`); flagged = added; }
    if (out && endsMidThought(out)) problems.push('ends mid-thought');
    // On 2026-09-03 one answer came back headed "=== CORRECTED ===" and the
    // label was written into Tokyo's body.
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
    if (out && out.length > current.length * 1.2 + 80) problems.push(`grew (${out.length}/${current.length}) — added text that was not there`);
    if (!problems.length) break;
    feedback = problems.join('; ');
    if (attempt + 1 < tries) console.log(`   ↻ ${field}: attempt ${attempt + 1} rejected (${feedback.slice(0, 140)}) — retrying`);
  }
  if (problems.length) {
    console.log(`   ⚠️  ${field}: REFUSED — ${problems.join('; ')}`);
    refuse(file, field, flagged.length ? flagged : already);
    return null;
  }
  fieldsChanged++;
  console.log(`   ${field}: neutralised "${already.map((h) => h.verb).join('", "')}"`);
  if (DRY) {
    console.log(`      before: ${current.replace(/\s+/g, ' ').slice(0, 260)}`);
    console.log(`      after : ${(out || '(deleted)').replace(/\s+/g, ' ').slice(0, 260)}`);
  }
  return out;
}

function refuse(file, field, hits) {
  for (const h of (hits.length ? hits : [{ sentence: '(see log)', verb: '' }])) refused.push({ file, field, ...h });
}

const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md') && (!ONLY || f.includes(ONLY))).sort();
const remaining = [];   // whole-article check, after repair

for (const file of files) {
  const abs = join(POSTS, file);
  // core.autocrlf=true: the checkout is CRLF, the index is LF. Work in LF and
  // write back in whatever the file had, so the working copy stays one thing.
  const curDisk = await readFile(abs, 'utf8');
  const EOL = /\r\n/.test(curDisk) ? '\r\n' : '\n';
  const curRaw = curDisk.replace(/\r\n/g, '\n');
  let cur; try { cur = parse(curRaw); } catch { continue; }
  if (!cur.fm || cur.fm.category !== 'event') continue;
  const end = isoDay(cur.fm.eventEndDate || cur.fm.eventStartDate);
  if (!end || end >= TODAY) continue;
  scanned++;
  const year = end.slice(0, 4);
  const title = cur.fm.title;

  const hitsIn = (s) => ownEditionOutcomes(String(s || ''), year);
  const bodyParas = cur.body.split(/\n{2,}/);
  const anyHit = hitsIn(cur.fm.quickAnswer).length
    || (Array.isArray(cur.fm.faq) && cur.fm.faq.some((x) => hitsIn(x?.a).length))
    || bodyParas.some((p) => hitsIn(p).length);
  if (!anyHit) continue;

  console.log(`\n📝 ${file} (ended ${end})`);
  let nextFm = { ...cur.fm }, fmChanged = false, bodyChanged = false;

  if (hitsIn(cur.fm.quickAnswer).length) {
    const out = await repairField(file, 'Quick Answer', title, end, year, cur.fm.quickAnswer);
    if (out) { nextFm.quickAnswer = out; fmChanged = true; }
  }
  if (Array.isArray(cur.fm.faq)) {
    const faq = [];
    for (let k = 0; k < cur.fm.faq.length; k++) {
      const item = cur.fm.faq[k];
      if (!hitsIn(item?.a).length) { faq.push(item); continue; }
      const out = await repairField(file, `FAQ answer #${k + 1}`, title, end, year, item.a);
      faq.push(out ? { ...item, a: out } : item);
      if (out) fmChanged = true;
    }
    nextFm.faq = faq;
  }

  // Body: paragraph by paragraph; the separators between them are kept as
  // they are so the diff is the size of the fault. Headings, list blocks and
  // tables are structure, not prose — they go through as one paragraph each.
  const tokens = cur.body.split(/(\n{2,})/);
  const curParas = tokens.filter((_, k) => k % 2 === 0);
  const replacements = [];
  for (let i = 0; i < curParas.length; i++) {
    const p = curParas[i];
    if (!p.trim() || !hitsIn(p).length) continue;
    const out = await repairField(file, `body ¶${i + 1}`, title, end, year, p.trim(), { headings: true });
    if (out !== null) replacements.push({ index: i, out });
  }
  let nextBody = cur.body;
  if (replacements.length) {
    const outParas = curParas.slice();
    for (const r of replacements.sort((x, y) => y.index - x.index)) {
      outParas.splice(r.index, 1, ...(r.out ? [r.out.replace(/\r\n/g, '\n')] : []));
    }
    // The body starts with the newline after `---` and ends with one; both
    // came through the split as empty edge paragraphs and are put back here.
    const inner = outParas.filter((p, k) => !(p === '' && (k === 0 || k === outParas.length - 1)));
    bodyChanged = true;
    nextBody = `\n${inner.join('\n\n')}\n`;
  }

  // Whole-article consistency: what would the article say after this run?
  const after = [nextFm.quickAnswer, ...(nextFm.faq || []).map((x) => x?.a), nextBody].map((s) => String(s || '')).join('\n\n');
  for (const h of ownEditionOutcomes(after, year)) remaining.push({ file, ...h });

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

console.log(`\n📦 ended events scanned ${scanned} · fields examined ${fieldsSeen} · neutralised ${fieldsChanged} in ${filesChanged} files · refused ${refused.length}${DRY ? ' (DRY)' : ''}`);
if (refused.length) {
  console.log('\n✋ left for hand repair (the model still asserted an outcome of this edition):');
  for (const r of refused) console.log(`   ${r.file} · ${r.field} · "${r.verb}" · ${r.sentence.slice(0, 160)}`);
}
if (remaining.length) {
  console.log('\n🔎 whole-article check — outcome of this edition still present after this run:');
  for (const r of remaining) console.log(`   ${r.file} · "${r.verb}" · ${r.sentence.slice(0, 160)}`);
}
console.log(`INVENTED_OUTCOMES_SUMMARY scanned=${scanned} files=${filesChanged} fields=${fieldsChanged} refused=${refused.length} remaining=${remaining.length}`);
