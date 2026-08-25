#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EVENT RECURRENCE BACKFILL — stamps `eventRecurring` on event posts written
//  before discover-events.mjs started asking the question (2026-08-06).
//
//  Until then, recurrence was inferred from words in the title. That can only
//  see what the name says, so every annual event whose name says nothing —
//  Lollapalooza, Tour de France, ChinaJoy — read as a one-off and dropped out
//  of the index the day it ended. Widening the keywords produced the opposite
//  failure (a one-off K-pop night advertising a yearly cadence because its
//  venue is called AsiaWorld-Expo), so this asks the web instead.
//
//  Writes the field ONLY when the answer is confident; an unanswered post keeps
//  the title heuristic, which is exactly what it has today. Never touches a
//  post that already carries the field.
//
//  Env: ANTHROPIC_API_KEY. DRY=1, LIMIT (default all), CONCURRENCY (default 4).
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import { eventSchemaName } from '../src/lib/eventName.mjs';
import { isRecurringEventTitle } from '../src/lib/eventRecurrence.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

const submitTool = {
  name: 'submit_recurrence',
  description: 'Report whether this event runs on a regular yearly cycle',
  input_schema: {
    type: 'object',
    properties: {
      recurring: { type: 'boolean', description: 'true only for an event held on a regular yearly (or near-yearly) cycle' },
      confident: { type: 'boolean', description: 'false if the search did not establish this clearly' },
      basis: { type: 'string', description: 'one short phrase naming what settled it (e.g. "held every August since 1991")' },
    },
    required: ['recurring', 'confident', 'basis'],
  },
};

async function askRecurrence(name, city, country) {
  const msg = await client.messages.create({
    model: MODEL,
    // Same budget lesson as the organizer backfill (2026-08-25): a search-backed
    // reply spends most of the allowance before it reaches the tool call.
    max_tokens: 1600,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, submitTool],
    messages: [{
      role: 'user',
      content:
        `Does "${name}" in ${city}, ${country} run on a regular yearly cycle?\n\n` +
        `recurring = true ONLY for an event that returns each year (or near-yearly): an annual festival, ` +
        `a championship round on a yearly calendar, a race or expo held every year.\n` +
        `recurring = false for a concert, a tour stop, a one-time exhibition, a one-off match.\n` +
        `Note: a tour STOP is false even when the artist tours often. A yearly race is true even when the host city rotates.\n` +
        `Search the web to check, then call submit_recurrence. If the search does not settle it, set confident=false.`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('response truncated');
  const b = msg.content.find((x) => x.type === 'tool_use' && x.name === 'submit_recurrence');
  if (!b) throw new Error('no tool call');
  return b.input;
}

const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const todo = [];
for (const f of files) {
  const raw = await readFile(join(POSTS, f), 'utf8');
  let parsed;
  try { parsed = matter(raw); } catch { continue; }
  const d = parsed.data;
  if (d.category !== 'event') continue;
  if (typeof d.eventRecurring === 'boolean') continue; // already answered
  todo.push({ f, parsed });
}

console.log(`\n🔁 Event recurrence — ${todo.length} post(s) with no stored answer${DRY ? ' (DRY)' : ''}\n`);
const queue = todo.slice(0, LIMIT);
let stamped = 0, unsure = 0, failed = 0, flipped = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const { f, parsed } = item;
    const d = parsed.data;
    const name = eventSchemaName(d.title);
    const guess = isRecurringEventTitle(d.title);
    try {
      const a = await askRecurrence(name, d.region, d.country ?? '');
      if (!a.confident) {
        unsure++;
        console.log(`  ? ${name} — unsettled, keeping the title heuristic (${guess})`);
        continue;
      }
      const changes = a.recurring !== guess;
      if (changes) flipped++;
      stamped++;
      console.log(`  ${changes ? '↻' : '·'} ${name}: ${a.recurring}${changes ? ` (heuristic said ${guess})` : ''} — ${String(a.basis).slice(0, 70)}`);
      if (DRY) continue;
      parsed.data.eventRecurring = a.recurring;
      await writeFile(join(POSTS, f), matter.stringify(parsed.content, parsed.data), 'utf8');
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${name}: ${String(e.message).slice(0, 80)}`);
    }
  }
}));

console.log(`\n📦 ${stamped} stamped (${flipped} disagreed with the title heuristic) · ${unsure} unsettled · ${failed} failed${DRY ? ' (DRY — nothing written)' : ''}`);
