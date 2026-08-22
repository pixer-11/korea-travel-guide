#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EVENT VENUE BACKFILL — stamps `eventVenue` on event posts written before
//  discover-events started asking for the venue (2026-08-22).
//
//  Why: the photo pipeline's second search key is the venue. Seventeen live
//  events sat photoless for a week because their names are all generic words
//  ("Formula 1 Italian Grand Prix") — no act anchor, so the act search never
//  ran — while their venues (Autodromo Nazionale Monza, Stade de France, the
//  Hue citadel) are all over Commons. The article body almost always names
//  the venue; this asks the model to READ IT OUT, never to guess. No web
//  search, no invention: a body that does not name a venue stores nothing.
//
//  Env: ANTHROPIC_API_KEY. DRY=1, LIMIT, PHOTOLESS=1 (only posts with no hero).
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import { eventSchemaName } from '../src/lib/eventName.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const PHOTOLESS_ONLY = process.env.PHOTOLESS === '1';

const tool = {
  name: 'submit_venue',
  description: 'Report the venue this article names, exactly as written, or null',
  input_schema: {
    type: 'object',
    properties: {
      venue: { type: ['string', 'null'], description: 'the specific venue (stadium, arena, circuit, park, hall, square) EXACTLY as the article names it, or null if the article names none' },
      quote: { type: ['string', 'null'], description: 'the short passage of the article that names it (proof), or null' },
    },
    required: ['venue', 'quote'],
  },
};

async function readVenue(name, city, country, body) {
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 300, tools: [tool], tool_choice: { type: 'tool', name: 'submit_venue' },
    messages: [{ role: 'user', content:
      `Article about the event "${name}" in ${city}, ${country}. Which specific VENUE does the article itself name as where it takes place — a stadium, arena, circuit, park, hall or square? ` +
      `Answer ONLY from the text below. Copy the venue name as written. If the text names no specific venue (only the city, or "various locations"), answer null. Do not guess.\n\n${body.slice(0, 6000)}` }],
  });
  const b = msg.content.find((x) => x.type === 'tool_use' && x.name === 'submit_venue');
  return b?.input ?? { venue: null, quote: null };
}

const files = (await readdir(POSTS)).filter((f) => f.endsWith('.md'));
const todo = [];
for (const f of files) {
  const raw = await readFile(join(POSTS, f), 'utf8');
  let parsed; try { parsed = matter(raw); } catch { continue; }
  const d = parsed.data;
  if (d.category !== 'event' || d.draft === true || d.eventVenue) continue;
  if (PHOTOLESS_ONLY && d.heroImage?.url) continue;
  todo.push({ f, raw, parsed });
}
console.log(`\n🏟️  Event venue — ${todo.length} post(s) without eventVenue${PHOTOLESS_ONLY ? ' (photoless only)' : ''}${DRY ? ' (DRY)' : ''}\n`);

let stamped = 0, none = 0, failed = 0;
for (const { f, raw, parsed } of todo.slice(0, LIMIT)) {
  const d = parsed.data;
  const name = eventSchemaName(d.title);
  try {
    const a = await readVenue(name, d.region, d.country ?? '', parsed.content);
    const v = typeof a.venue === 'string' ? a.venue.trim() : '';
    // A venue is a proper name, short, and must actually appear in the body.
    const inBody = v && parsed.content.toLowerCase().includes(v.toLowerCase().slice(0, Math.min(v.length, 12)));
    if (!v || v.length < 3 || v.length > 80 || !inBody || /various|multiple|tbd|tba/i.test(v)) {
      none++; console.log(`  ? ${f}: no venue named${v ? ` (rejected "${v.slice(0, 40)}")` : ''}`); continue;
    }
    stamped++;
    console.log(`  ✓ ${f}: ${v} — "${String(a.quote || '').slice(0, 60)}"`);
    if (DRY) continue;
    parsed.data.eventVenue = v;
    let out = matter.stringify(parsed.content, parsed.data);
    if (raw.includes('\r\n')) out = out.replace(/\r?\n/g, '\r\n');
    await writeFile(join(POSTS, f), out, 'utf8');
  } catch (e) { failed++; console.log(`  ⚠️  ${f}: ${String(e.message).slice(0, 80)}`); }
}
console.log(`\nEVENT_VENUE_SUMMARY stamped=${stamped} none=${none} failed=${failed}${DRY ? ' (DRY)' : ''}`);
