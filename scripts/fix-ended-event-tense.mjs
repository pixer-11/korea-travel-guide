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

const POSTS = fileURLToPath(new URL('../src/content/posts/', import.meta.url));
const DRY = process.env.DRY === '1';
const TODAY = new Date().toISOString().slice(0, 10);
const MODEL = 'claude-sonnet-5';

// Same shapes validate-content.mjs flags — keep the two in step.
const FUTURE_PROMISE = /\b(tickets\s+(?:go|will go)\s+on\s+sale|(?:the\s+)?(?:full\s+)?lineup\s+(?:will|has yet to|have yet to)\b|will\s+be\s+(?:announced|confirmed|revealed|published|released)|is\s+expected\s+to\s+be\s+(?:announced|confirmed)|once\s+(?:released|published|announced|confirmed)|closer\s+to\s+the\s+(?:event|date|festival|show)|(?:haven'?t|hasn'?t|weren'?t|wasn'?t)\s+been\s+(?:announced|confirmed|released)|yet\s+to\s+be\s+(?:announced|confirmed|released)|expect\s+(?:the\s+)?(?:full\s+)?(?:lineup|set times|schedule)[^.]{0,40}\bto\s+drop\b)/i;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }

async function rewrite(kind, text, title, endedOn) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `This is the ${kind} of a travel guide for "${title}", an event that ENDED on ${endedOn}. It was written before the event, so it still points readers at things that will happen.

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
  return (msg.content.find((c) => c.type === 'text')?.text || '').trim();
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
    const out = await rewrite('Quick Answer', fm.quickAnswer, fm.title, end);
    if (out && !FUTURE_PROMISE.test(out)) { nextFm.quickAnswer = out; console.log(`   quickAnswer → ${out.slice(0, 100)}…`); }
    else console.log('   ⚠️  quickAnswer rewrite still forward-looking — left alone');
  }
  if (hits.includes('faq')) {
    nextFm.faq = [];
    for (const item of fm.faq) {
      if (!FUTURE_PROMISE.test(String(item?.a || ''))) { nextFm.faq.push(item); continue; }
      const out = await rewrite('FAQ answer', item.a, fm.title, end);
      nextFm.faq.push(out && !FUTURE_PROMISE.test(out) ? { ...item, a: out } : item);
    }
    console.log('   faq → rewritten');
  }
  if (hits.includes('body')) {
    const out = await rewrite('article body (markdown)', body.trim(), fm.title, end);
    if (out && !FUTURE_PROMISE.test(out)) { nextBody = `\n${out}\n`; console.log('   body → rewritten'); }
    else console.log('   ⚠️  body rewrite still forward-looking — left alone');
  }

  if (DRY) continue;
  await writeFile(join(POSTS, f),
    `---\n${yaml.dump(nextFm, { lineWidth: -1, noRefs: true, sortKeys: false })}---${nextBody}`, 'utf8');
  fixed++;
}

console.log(`\n📦 ended events scanned ${scanned} · rewritten ${fixed}${DRY ? ' (DRY)' : ''}`);
console.log(`ENDED_EVENT_TENSE_SUMMARY scanned=${scanned} fixed=${fixed}`);
