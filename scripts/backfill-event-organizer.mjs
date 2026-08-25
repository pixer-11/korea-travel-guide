#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EVENT ORGANIZER BACKFILL — stamps `eventOrganizer` on event posts written
//  before discover-events.mjs started asking who actually runs the event.
//
//  Event schema wants an organizer. We once declared Wander Atlas the
//  organizer of every festival on the site (removed 2026-08-07); since then
//  new posts store the REAL host when the discovery search names one, and the
//  ~90 older posts carry nothing — which GSC flags as a (non-critical) gap.
//
//  The answer to that gap is verified data, never a placeholder: this asks the
//  web who the official organizing body is and writes the field ONLY when the
//  search names it clearly. An unsettled post keeps no organizer, which is
//  strictly better than a wrong one in machine-readable form. Never touches a
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

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

const submitTool = {
  name: 'submit_organizer',
  description: 'Report the official organizing body of this event, if the search clearly names one',
  input_schema: {
    type: 'object',
    properties: {
      organizer: { type: ['string', 'null'], description: 'the official organizing body EXACTLY as the sources name it (city government, festival committee, federation, promoter), or null' },
      organizerUrl: { type: ['string', 'null'], description: 'its official website (https://...) if the sources show it, else null' },
      confident: { type: 'boolean', description: 'true only if at least one authoritative source (official site, city/government page, major press) explicitly names this body as the organizer' },
      basis: { type: 'string', description: 'one short phrase naming the source that settled it' },
    },
    required: ['organizer', 'organizerUrl', 'confident', 'basis'],
  },
};

// Names that mean the model guessed rather than found — never worth storing.
const REJECT = /wander\s*atlas|unknown|n\/a|not (?:specified|available|found)|various|multiple|local (?:authorities|organizers)|^the (?:city|organizers?)$/i;

async function askOrganizer(name, city, country) {
  const msg = await client.messages.create({
    model: MODEL,
    // 900 truncated 2 of 15 replies on 2026-08-25 — a web_search answer carries
    // the search results into the response budget, so the tool call at the end
    // is what gets cut. Same failure the translation judge had at 600 (08-16).
    max_tokens: 1600,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, submitTool],
    messages: [{
      role: 'user',
      content:
        `Who is the official organizing body of "${name}" in ${city}, ${country}?\n\n` +
        `Search the web, then call submit_organizer.\n` +
        `- organizer must be the body that actually runs the event, named EXACTLY as an authoritative source names it ` +
        `(e.g. "Kyoto City Tourism Association", "Comic Market Preparatory Committee", "Formula One Management").\n` +
        `- A venue is not an organizer. A sponsor is not an organizer. A ticket seller is not an organizer. A travel guide is never an organizer.\n` +
        `- If the sources do not clearly and explicitly name the organizing body, set organizer=null and confident=false. Never guess or infer.\n` +
        `- organizerUrl only if the sources show that body's own official site; else null.`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('response truncated');
  const b = msg.content.find((x) => x.type === 'tool_use' && x.name === 'submit_organizer');
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
  if (d.eventOrganizer && typeof d.eventOrganizer.name === 'string') continue; // already answered
  if (d.draft === true) continue; // parked/retired posts get nothing until they come back
  todo.push({ f, raw, parsed });
}

console.log(`\n🏛️  Event organizer — ${todo.length} live post(s) with no stored organizer${DRY ? ' (DRY)' : ''}\n`);
const queue = todo.slice(0, LIMIT);
let stamped = 0, unsure = 0, failed = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const { f, raw, parsed } = item;
    const d = parsed.data;
    const name = eventSchemaName(d.title);
    try {
      const a = await askOrganizer(name, d.region, d.country ?? '');
      const org = typeof a.organizer === 'string' ? a.organizer.trim() : '';
      if (!a.confident || !org || org.length > 120 || REJECT.test(org)) {
        unsure++;
        console.log(`  ? ${name} — unsettled${org ? ` (rejected "${org.slice(0, 50)}")` : ''}, storing nothing`);
        continue;
      }
      const url = typeof a.organizerUrl === 'string' && /^https?:\/\/\S+$/.test(a.organizerUrl.trim()) ? a.organizerUrl.trim() : null;
      stamped++;
      console.log(`  ✓ ${name}: ${org}${url ? ` <${url}>` : ''} — ${String(a.basis).slice(0, 70)}`);
      if (DRY) continue;
      parsed.data.eventOrganizer = { name: org, ...(url && { url }) };
      let out = matter.stringify(parsed.content, parsed.data);
      if (raw.includes('\r\n')) out = out.replace(/\r?\n/g, '\r\n'); // keep the file's own line endings
      await writeFile(join(POSTS, f), out, 'utf8');
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${name}: ${String(e.message).slice(0, 80)}`);
    }
  }
}));

console.log(`\n📦 ${stamped} stamped · ${unsure} unsettled (nothing written) · ${failed} failed${DRY ? ' (DRY — nothing written)' : ''}`);
