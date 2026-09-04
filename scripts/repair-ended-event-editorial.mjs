#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ENDED-EVENT EDITORIAL REPAIR — the whole article, every field, one brief
//
//  Three mechanical repairs (fix-ended-event-tense, repair-invented-outcomes
//  ×2) each fixed the regex they were built for and left the page reading
//  like three different people had edited three different fields. An editorial
//  read-through on 2026-09-03 (15 of the ended events, 13 "wrong", 0 "fine")
//  found: descriptions and FAQ answers still telling the reader to "always
//  confirm before booking" and "watch official channels" next to a Quick
//  Answer saying "was scheduled"; paragraphs stacked with "was scheduled to…
//  was expected to… was meant to… attendees were advised to consider" until
//  they read like a legal notice; and outcome claims still standing ("rates
//  climbed", "performed at", "marked the first time").
//
//  So: one model call per post, with the description, the Quick Answer, every
//  FAQ answer and the body together, and one editorial brief — the event is
//  over, the article is a record of what was announced, say the plan once
//  and plainly, keep evergreen facts in the present, never say what happened.
//  The answer is then held to every mechanical rule this class has taught us
//  (promise, fabricated past, own-edition outcome, no new outcome, stale
//  advice, hedge density, structure, FAQ shape), retried once with the
//  failures named, and otherwise logged for a human. Nothing is written that
//  did not pass.
//
//   DRY=1 node scripts/repair-ended-event-editorial.mjs
//   SLUGS=tokyo-formula-e,paris-2026 DRY=1 node scripts/repair-ended-event-editorial.mjs
//   node scripts/repair-ended-event-editorial.mjs          # apply
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { endsMidThought } from '../src/lib/rewrite-guard.mjs';
import { OFFENDING_CLAIM, ADVICE_IMPERATIVE } from '../src/lib/ended-event-claims.mjs';
import { inventedOutcomes, ownEditionOutcomes } from './lib/invented-outcomes.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const DRY = process.env.DRY === '1';
const SLUGS = (process.env.SLUGS || '').split(',').map((s) => s.trim()).filter(Boolean);
const TODAY = new Date().toISOString().slice(0, 10);
// An editorial rewrite of a whole article, not a clerical tense shift: the
// brief asks for judgement about which sentence is a plan, which is history and
// which is evergreen. Opus, with its default adaptive thinking, does that in
// one pass; the cheaper model is what produced the hedge stacks.
const MODEL = process.env.MODEL || 'claude-opus-5';

if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// The validator's reading of a date field: YAML hands back a Date for an
// unquoted 2026-08-15, and String(date) is never < TODAY.
const isoDay = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '');
const words = (s) => (String(s || '').match(/\S+/g) || []).length;
const HEDGE = /\b(?:was|were)\s+(?:scheduled|expected|set|planned|meant|advised|promised)\b/gi;
const hedgeDensity = (s) => (words(s) ? ((String(s).match(HEDGE) || []).length / words(s)) * 100 : 0);
const headings = (s) => (String(s).match(/^#{2,6}\s+.*/gm) || []).length;

function parse(raw) {
  const cut = raw.indexOf('\n---', 3);
  const fmText = raw.slice(4, cut);
  return { fm: yaml.load(fmText), fmText, body: raw.slice(cut + 4) };
}

// The article goes to the model as one labelled document and comes back the
// same way. Questions are sent for context and never taken from the answer.
const MARK = (name) => `=== ${name} ===`;
function pack(fm, body) {
  const parts = [MARK('DESCRIPTION'), fm.description || '', MARK('QUICK ANSWER'), fm.quickAnswer || ''];
  (fm.faq || []).forEach((x, i) => parts.push(MARK(`FAQ ${i + 1}`), `Q: ${x?.q || ''}`, `A: ${x?.a || ''}`));
  parts.push(MARK('BODY'), body.trim());
  return parts.join('\n');
}
function unpack(text, faqCount) {
  const out = { faq: [] };
  const re = /^=== (DESCRIPTION|QUICK ANSWER|FAQ (\d+)|BODY) ===\s*$/gm;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ name: m[1], n: m[2], start: m.index, end: m.index + m[0].length });
  for (let i = 0; i < marks.length; i++) {
    const chunk = text.slice(marks[i].end, marks[i + 1]?.start ?? text.length).trim();
    const k = marks[i];
    if (k.name === 'DESCRIPTION') out.description = chunk;
    else if (k.name === 'QUICK ANSWER') out.quickAnswer = chunk;
    else if (k.name === 'BODY') out.body = chunk;
    else if (k.n) out.faq[Number(k.n) - 1] = chunk.replace(/^Q:.*\n?/, '').replace(/^A:\s*/, '').trim();
  }
  if (out.description === undefined || out.quickAnswer === undefined || out.body === undefined) return null;
  if (out.faq.length !== faqCount || out.faq.some((a) => a === undefined)) return null;
  return out;
}

async function rewrite(title, endedOn, year, doc, feedback = null) {
  // DRY=1 means 'show what would be rewritten and touch nothing' — including the
  // API. Before 2026-09-04 the call ran first and only the write was skipped.
  if (DRY) return null;
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are editing a travel guide for "${title}", the ${year} edition of an event that ENDED on ${endedOn}. The guide was written before the event. Below are its meta description, Quick Answer, FAQ answers and body, each under a === LABEL === line.

The brief:
- The event is over. The article is now a record of what was announced, written for someone reading afterwards. It must not tell the reader to check, confirm, verify, watch, book, plan, arrive early, or expect anything; no "before booking/travelling", no "as of this writing", no "this far out", no "at publication time", no "check the official site".
- Say the plan once, plainly: e.g. "The festival was set for August 22–23, 2026 at JIExpo." After that, describe the announced programme in simple past: "The lineup announced X", "Organisers planned two stages", "Tickets were sold through Y", "Doors were listed as 6pm". Use at most ONE hedge phrase ("was scheduled", "was expected", "was set", "was planned", "was meant") per paragraph, and never chain them ("was scheduled to… was expected to… was meant to…"). Prefer a plain statement of the announcement to a hedge.
- Evergreen facts stay in the present tense: the venue and what it is like, how to get there, the neighbourhood, food nearby, weather norms, "the stadium seats 60,000", how such events usually run ("gates typically open two hours before the headliner").
- Never assert what happened at this edition: no crowds, sell-outs, weather on the day, delays, performances, "took place" as a completed fact, "was held" as a completed fact, "marked the first time", "rates climbed", "fans arrived". Facts about prior editions and history stay exactly as they are.
- Keep every fact: dates, venue, prices, names, transit lines, numbers, links. Keep the same headings in the same order. Keep every FAQ question exactly as given and give each a non-empty answer. Keep the description to 160 characters or fewer, one or two sentences, no advice. No markdown (no **, no #, no links) inside the description, Quick Answer or FAQ answers. Keep roughly the same length.
- Do not write that details "were published / announced / confirmed / listed on (or through) the official site or channels" — nobody here verified that, and it is the sentence a previous repair invented fifteen times. Say what was announced, or leave the point out. Avoid "closer to" and "nearer the time" altogether. Do not say the event, the programme or ticket sales "ran" — "ran" states that it happened; write "was set for", "was scheduled to run", "was planned as" or "tickets were sold through" instead.
- Write naturally, as a good editor would: short clear sentences, no legal-notice tone, no disclaimers, no sentence saying the event has ended, no commentary about what this guide does or does not contain.
${feedback ? `\nYour previous answer was rejected for these reasons — fix them and change nothing else:\n${feedback}\n` : ''}
Reply with the whole document in exactly the same format: every === LABEL === line, in the same order, followed by the edited text for that section (for a FAQ section, repeat the "Q:" line unchanged and give the answer on an "A:" line). No preamble, nothing after the body.

${doc}`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') { console.log('   ⚠️  response hit the token ceiling — discarded unread'); return null; }
  if (msg.stop_reason === 'refusal') { console.log('   ⚠️  model declined'); return null; }
  return (msg.content.find((c) => c.type === 'text')?.text || '').trim();
}

/** Every mechanical rule this class has taught us, applied to one field. */
function fieldProblems(name, cur, out, year, { md = false } = {}) {
  const p = [];
  const label = (s) => `${name}: ${s}`;
  if (!out) { p.push(label('empty')); return p; }
  const promise = out.match(OFFENDING_CLAIM);
  if (promise) p.push(label(`still a promise or a fabricated past — "${promise[0]}"`));
  const advice = out.match(ADVICE_IMPERATIVE);
  if (advice) p.push(label(`still advice to a reader who has not gone — "${advice[0]}"`));
  const own = ownEditionOutcomes(out, year);
  if (own.length) p.push(label(`asserts an outcome of this edition — "${own[0].sentence.slice(0, 140)}"`));
  const added = inventedOutcomes(cur, out);
  if (added.length) p.push(label(`introduces an outcome the text did not carry — "${added[0].sentence.slice(0, 140)}"`));
  if (/^\s*===.*===\s*$/m.test(out)) p.push(label('contains a label line'));
  if (!md && /(\*\*|^#|\]\(|^[-*]\s)/m.test(out)) p.push(label('markdown in a frontmatter string'));
  if (endsMidThought(out)) p.push(label('ends mid-thought'));
  return p;
}

const refused = [];
let scanned = 0, fixed = 0;

for (const file of (await readdir(POSTS)).filter((f) => f.endsWith('.md')).sort()) {
  const slug = file.replace(/\.md$/, '');
  if (SLUGS.length && !SLUGS.some((s) => slug.includes(s))) continue;
  const abs = join(POSTS, file);
  const curDisk = await readFile(abs, 'utf8');
  const EOL = /\r\n/.test(curDisk) ? '\r\n' : '\n';
  const curRaw = curDisk.replace(/\r\n/g, '\n');
  let cur; try { cur = parse(curRaw); } catch { continue; }
  if (!cur.fm || cur.fm.category !== 'event') continue;
  const end = isoDay(cur.fm.eventEndDate || cur.fm.eventStartDate);
  if (!end || end >= TODAY) continue;
  scanned++;
  const year = end.slice(0, 4);
  const faq = Array.isArray(cur.fm.faq) ? cur.fm.faq : [];
  const body = cur.body.trim();
  console.log(`\n📝 ${file} (ended ${end}${cur.fm.draft ? ', draft' : ''})`);

  const doc = pack(cur.fm, body);
  if (DRY) { console.log('   (DRY) would be sent to the model — nothing written, no API call'); continue; }
  let out = null, problems = [], feedback = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await rewrite(cur.fm.title, end, year, doc, feedback);
    if (text === null) { problems = ['no usable response']; break; }
    out = unpack(text, faq.length);
    if (!out) { problems = ['reply did not follow the === LABEL === format']; feedback = problems[0]; console.log(`   ↻ attempt ${attempt + 1}: ${problems[0]} — retrying`); continue; }
    problems = [
      ...fieldProblems('description', cur.fm.description || '', out.description, year),
      ...fieldProblems('quickAnswer', cur.fm.quickAnswer || '', out.quickAnswer, year),
      ...faq.flatMap((x, i) => fieldProblems(`FAQ ${i + 1}`, x?.a || '', out.faq[i], year)),
      ...fieldProblems('body', body, out.body, year, { md: true }),
    ];
    if (out.description.length > 160) problems.push(`description: ${out.description.length} chars (limit 160)`);
    if (headings(out.body) !== headings(body)) problems.push(`body: heading count ${headings(out.body)} vs ${headings(body)}`);
    // Heading COUNT and level, not wording: "## How locals approached it" →
    // "## How locals approach it" is the tense fix the brief asks for. An
    // exact-text rule refused nine posts on that alone in the first pass.
    const levels = (s) => (s.match(/^#{2,6}(?=\s)/gm) || []).join('');
    if (levels(out.body) !== levels(body)) problems.push('body: heading levels or order changed');
    if (out.body.length < body.length * 0.72 || out.body.length > body.length * 1.15) problems.push(`body: length ${out.body.length} vs ${body.length} (window 0.72–1.15)`);
    if (out.quickAnswer.length < (cur.fm.quickAnswer || '').length * 0.5 || out.quickAnswer.length > (cur.fm.quickAnswer || '').length * 1.3 + 60) problems.push(`quickAnswer: length ${out.quickAnswer.length} vs ${(cur.fm.quickAnswer || '').length}`);
    const whole = [out.description, out.quickAnswer, ...out.faq, out.body].join('\n\n');
    const dens = hedgeDensity(whole);
    if (dens > 1.5) problems.push(`hedge density ${dens.toFixed(2)} per 100 words (limit 1.5) — say the plan once, plainly`);
    // A paragraph may carry one hedge; a chain is what the read-through found.
    for (const para of out.body.split(/\n{2,}/)) {
      const n = (para.match(HEDGE) || []).length;
      if (n > 1) { problems.push(`body: a paragraph chains ${n} hedges — "${para.slice(0, 100)}"`); break; }
    }
    if (!problems.length) break;
    feedback = problems.map((s) => `- ${s}`).join('\n');
    if (attempt === 0) console.log(`   ↻ attempt 1 rejected:\n${feedback.replace(/^/gm, '      ')}\n     — retrying`);
  }
  if (problems.length || !out) {
    console.log(`   ⚠️  REFUSED — left for hand repair:\n${problems.map((s) => `      - ${s}`).join('\n')}`);
    refused.push({ file, problems });
    continue;
  }

  const changed = out.description !== (cur.fm.description || '') || out.quickAnswer !== (cur.fm.quickAnswer || '')
    || out.faq.some((a, i) => a !== (faq[i]?.a || '')) || out.body !== body;
  if (!changed) { console.log('   unchanged'); continue; }
  fixed++;
  console.log(`   ✓ description ${out.description === cur.fm.description ? 'kept' : 'edited'} · quickAnswer ${out.quickAnswer === cur.fm.quickAnswer ? 'kept' : 'edited'} · FAQ ${out.faq.filter((a, i) => a !== faq[i]?.a).length}/${faq.length} edited · body ${out.body === body ? 'kept' : 'edited'} · hedges ${hedgeDensity([out.description, out.quickAnswer, ...out.faq, out.body].join(' ')).toFixed(2)}/100w`);
  if (DRY) {
    console.log(`      description: ${out.description}`);
    console.log(`      quickAnswer: ${out.quickAnswer}`);
    out.faq.forEach((a, i) => console.log(`      FAQ ${i + 1}: ${a}`));
    console.log(`      body:\n${out.body.replace(/^/gm, '        ')}`);
    continue;
  }
  const nextFm = { ...cur.fm, description: out.description, quickAnswer: out.quickAnswer, faq: faq.map((x, i) => ({ ...x, a: out.faq[i] })) };
  const fmOut = yaml.dump(nextFm, { lineWidth: -1, noRefs: true, sortKeys: false });
  await writeFile(abs, `---\n${fmOut}---\n${out.body}\n`.replace(/\n/g, EOL), 'utf8');
}

console.log(`\n📦 ended events scanned ${scanned} · rewritten ${fixed} · refused ${refused.length}${DRY ? ' (DRY)' : ''}`);
for (const r of refused) console.log(`   ✋ ${r.file}: ${r.problems.join(' | ').slice(0, 300)}`);
console.log(`ENDED_EVENT_EDITORIAL_SUMMARY scanned=${scanned} fixed=${fixed} refused=${refused.length}`);
