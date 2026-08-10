#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  ENDED-EVENT TENSE REPAIR
//
//  An event guide is written before the event. Once it is over, the sentences
//  that were helpful ("check the official page closer to the date", "the full
//  lineup will drop in the months before") become instructions a reader cannot
//  act on — and they sit in the Quick Answer box and the FAQ, which is also
//  serialised into FAQPage schema. On 2026-08-05, 11 of 11 ended events were
//  live with at least one, while the validator reported zero because it only
//  read the body.
//
//  This rewrites ONLY the offending fields, and only for events that have
//  ended. The model is given the existing text and told to keep every fact,
//  change nothing else, and shift the tense — it may not invent an outcome
//  ("the festival was a success"), because nobody here knows what happened.
//
//   DRY=1 node scripts/fix-ended-event-tense.mjs    # show the rewrites
//   node scripts/fix-ended-event-tense.mjs          # apply
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { isSentenceEnd } from '../src/lib/sentence-boundary.mjs';
import { preservesSubstance } from '../src/lib/rewrite-guard.mjs';

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const DRY = process.env.DRY === '1';
const TODAY = new Date().toISOString().slice(0, 10);
const MODEL = 'claude-sonnet-5';

// Same shapes validate-content.mjs flags — keep the two in step.
const FUTURE_PROMISE = /\b(tickets\s+(?:go|will go)\s+on\s+sale|(?:the\s+)?(?:full\s+)?lineup\s+(?:will|has yet to|have yet to)\b|will\s+be\s+(?:announced|confirmed|revealed|published|released)|is\s+expected\s+to\s+be\s+(?:announced|confirmed)|once\s+(?:released|published|announced|confirmed)|closer\s+to\s+the\s+(?:event|date|festival|show)|(?:haven'?t|hasn'?t|weren'?t|wasn'?t)\s+been\s+(?:announced|confirmed|released)|yet\s+to\s+be\s+(?:announced|confirmed|released)|expect\s+(?:the\s+)?(?:full\s+)?(?:lineup|set times|schedule)[^.]{0,40}\bto\s+drop\b)/i;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

async function rewrite(kind, text, title, endedOn, residue = null) {
  const msg = await client.messages.create({
    model: MODEL,
    // A 4,000-character body is ~1,200 tokens BEFORE the rewrite adds a word,
    // so the old flat 1,200 cap cut the answer off mid-word and the code wrote
    // the stump: jakarta-the-sounds-project-vol-9 shipped ending "…the decent
    // walk from par" on 2026-08-10. Budget from the input, with headroom.
    max_tokens: Math.min(8192, Math.max(1200, Math.ceil(text.length / 2) + 600)),
    messages: [{
      role: 'user',
      content: `This is the ${kind} of a travel guide for "${title}", an event that ENDED on ${endedOn}. It was written before the event, so it still points readers at things that will happen.
${residue ? `\nA previous attempt left this phrasing in place: "${residue}". That exact phrasing must not survive — rewrite or delete the sentence containing it.\n` : ''}

Rewrite it so it reads correctly AFTER the event, following these rules exactly:
- Keep every concrete fact (dates, venue, city, names, prices, numbers) exactly as written.
- Change forward-looking guidance into past or neutral phrasing. "Check the official site closer to the date" → drop it or make it "Ticket and set-time details were published on the official site." "The lineup will be announced" → "The lineup was announced closer to the event."
- NEVER invent what happened. You do not know attendance, weather, who played, or whether it went well. Do not add any outcome.
- Do not add a sentence saying the event has ended — the page already shows that.
- Keep the same language, register and roughly the same length.
- If a sentence is ONLY forward-looking advice with no fact in it, delete that sentence.

Reply with ONLY the rewritten ${kind}, no preamble, no quotes around it.

${text}`,
    }],
  });
  // The authoritative truncation signal. Everything else here is a backstop.
  if (msg.stop_reason === 'max_tokens') {
    console.log(`   ⚠️  ${kind} response hit the token ceiling — discarded unread`);
    return '';
  }
  return (msg.content.find((c) => c.type === 'text')?.text || '').trim();
}

// One bad sentence used to discard a whole good rewrite. jakarta-the-sounds-
// project-vol-9 sat in the warning list every evening because its body kept
// coming back with "If organizers announce a shuttle service closer to the
// date…" — a conditional, so the model read it as a fact worth keeping — and
// the all-or-nothing check then threw away the rest of the corrected text.
// Same lesson fix-hours-claims learned on 2026-08-08: tell the model WHICH
// phrase failed, and try again.
async function rewriteUntilClean(kind, text, title, endedOn, tries = 3) {
  let best = null, residue = null;
  for (let i = 0; i < tries; i++) {
    const out = await rewrite(kind, text, title, endedOn, residue);
    if (!out) continue;
    if (!keptSubstance(text, out, kind)) {
      console.log(`   ⚠️  attempt ${i + 1} came back short or cut off — discarded`);
      continue;
    }
    if (!FUTURE_PROMISE.test(out)) return out;
    best = out;
    residue = out.match(FUTURE_PROMISE)?.[0] ?? null;
  }
  // Fall back from the ORIGINAL text, not from a rejected attempt: the
  // sentence pass edits in place, so it inherits whatever it is handed.
  return await sentenceLevelPass(kind, text, title, endedOn);
}

// The brief is "shift the tense", not "shorten the article" — and not "stop
// halfway". Both happened on 2026-08-10; the rules now live in
// src/lib/rewrite-guard.mjs so any other repair tool can hold itself to them.
const keptSubstance = (before, after, kind) =>
  preservesSubstance(before, after, { headings: kind.startsWith('article body') });

// Last resort: stop rewriting the whole field and go after the offending
// sentences one at a time — a single sentence is a much easier ask. Anything
// still forward-looking after that is dropped, which is what the prompt asks
// for anyway ("if a sentence is ONLY forward-looking advice, delete it"). The
// paragraph splitter keeps markdown structure (headings, lists) intact.
async function sentenceLevelPass(kind, text, title, endedOn) {
  // Posts on this checkout are CRLF, so a bare /\n{2,}/ splits nothing —
  // "\r\n\r\n" has no two adjacent newlines in it. That is why this pass
  // reported "nothing to edit" on a post whose body plainly had a paragraph
  // to fix (2026-08-10).
  const NL = /\r\n/.test(text) ? '\r\n' : '\n';
  const paras = text.split(/(?:\r?\n){2,}/);
  let touched = false;
  for (let pi = 0; pi < paras.length; pi++) {
    const para = paras[pi];
    if (!FUTURE_PROMISE.test(para) || /^\s*(#{1,6}\s|[-*]\s|\d+\.\s|\|)/.test(para)) continue;
    const kept = [];
    for (const sentence of splitSentences(para)) {
      if (!FUTURE_PROMISE.test(sentence)) { kept.push(sentence); continue; }
      const fixed = await rewrite('single sentence', sentence.trim(), title, endedOn, sentence.match(FUTURE_PROMISE)?.[0]);
      touched = true;
      if (fixed && !FUTURE_PROMISE.test(fixed) && fixed.length < sentence.length * 3) kept.push(` ${fixed}`);
      // else: dropped
    }
    paras[pi] = kept.join('').replace(/\s+/g, ' ').trim();
  }
  const out = paras.filter((p) => p.length).join(NL + NL);
  if (!touched) { console.log('   ↳ sentence pass found nothing to edit'); return null; }
  if (FUTURE_PROMISE.test(out)) {
    console.log(`   ↳ sentence pass left "${out.match(FUTURE_PROMISE)?.[0]}"`);
    return null;
  }
  // A sentence or two removed from a 4,000-character guide is a small loss; a
  // rewrite that drops whole sections is not (see preservesSubstance). So this
  // pass is held to structure, not length.
  const heads = (s) => (s.match(/^#{2,6}\s+.*/gm) || []).length;
  if (heads(out) < heads(text) || out.length < text.length * 0.9) {
    console.log('   ↳ sentence pass lost too much — discarded');
    return null;
  }
  console.log('   ↳ sentence-level pass cleared it');
  return out;
}

function splitSentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSentenceEnd(text, i)) { out.push(text.slice(start, i + 1)); start = i + 1; }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

let scanned = 0, fixed = 0;
for (const f of (await readdir(POSTS)).filter((x) => x.endsWith('.md'))) {
  const raw = await readFile(join(POSTS, f), 'utf8');
  const cut = raw.indexOf('\n---', 3);
  let fm; try { fm = yaml.load(raw.slice(4, cut)); } catch { continue; }
  if (!fm || fm.category !== 'event') continue;
  const end = String(fm.eventEndDate || fm.eventStartDate || '').slice(0, 10);
  if (!end || end >= TODAY) continue;
  scanned++;

  const body = raw.slice(cut + 4);
  const hits = [];
  if (FUTURE_PROMISE.test(String(fm.quickAnswer || ''))) hits.push('quickAnswer');
  if (Array.isArray(fm.faq) && fm.faq.some((x) => FUTURE_PROMISE.test(String(x?.a || '')))) hits.push('faq');
  if (FUTURE_PROMISE.test(body)) hits.push('body');
  if (!hits.length) continue;

  console.log(`\n📝 ${f} (ended ${end}) — ${hits.join(', ')}`);
  let nextFm = { ...fm };
  let nextBody = body;

  if (hits.includes('quickAnswer')) {
    const out = await rewriteUntilClean('Quick Answer', fm.quickAnswer, fm.title, end);
    if (out) { nextFm.quickAnswer = out; console.log(`   quickAnswer → ${out.slice(0, 100)}…`); }
    else console.log('   ⚠️  quickAnswer rewrite still forward-looking — left alone');
  }
  if (hits.includes('faq')) {
    nextFm.faq = [];
    for (const item of fm.faq) {
      if (!FUTURE_PROMISE.test(String(item?.a || ''))) { nextFm.faq.push(item); continue; }
      const out = await rewriteUntilClean('FAQ answer', item.a, fm.title, end);
      nextFm.faq.push(out ? { ...item, a: out } : item);
    }
    console.log('   faq → rewritten');
  }
  if (hits.includes('body')) {
    const out = await rewriteUntilClean('article body (markdown)', body.trim(), fm.title, end);
    if (out) { nextBody = `\n${out}\n`; console.log('   body → rewritten'); }
    else console.log('   ⚠️  body rewrite still forward-looking — left alone');
  }

  if (DRY) continue;
  await writeFile(join(POSTS, f),
    `---\n${yaml.dump(nextFm, { lineWidth: -1, noRefs: true, sortKeys: false })}---${nextBody}`, 'utf8');
  fixed++;
}

console.log(`\n📦 ended events scanned ${scanned} · rewritten ${fixed}${DRY ? ' (DRY)' : ''}`);
console.log(`ENDED_EVENT_TENSE_SUMMARY scanned=${scanned} fixed=${fixed}`);
