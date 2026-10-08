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
import { thinkingOff } from './lib/thinking.mjs'; // reasoning off for a mechanical call (2026-10-05)
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { eventSchemaName } from '../src/lib/eventName.mjs';
import { editFrontmatter } from './lib/frontmatter-edit.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });
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

// URL-only pass (2026-10-08): 60 live events carried a verified organizer
// NAME with no url — the loop below skipped them as "already answered", and
// GSC flagged organizer.url on the ones it crawled. This asks only for the
// named body's own site; the answer is stored only if it is confident, not a
// ticket seller / encyclopedia / social profile, and actually answers HTTP.
const urlTool = {
  name: 'submit_organizer_url',
  description: "Report the official website of the named organizing body",
  input_schema: {
    type: 'object',
    properties: {
      url: { type: ['string', 'null'], description: "the body's own official website (https://...), or null" },
      confident: { type: 'boolean', description: "true only if an authoritative source shows this is that body's own site" },
      basis: { type: 'string', description: 'one short phrase naming the source' },
    },
    required: ['url', 'confident', 'basis'],
  },
};
const NOT_AN_ORG_SITE = /(?:^|\.)(?:wikipedia\.org|wikidata\.org|facebook\.com|instagram\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|linkedin\.com|ticketmaster\.[a-z.]+|klook\.com|kkday\.com|trip\.com|axs\.com|eventbrite\.[a-z.]+|stubhub\.[a-z.]+|viagogo\.[a-z.]+|google\.[a-z.]+|wanderatlasguides\.com)$/i;

async function askOrganizerUrl(org, name, city, country) {
  const msg = await client.messages.create({
    model: MODEL, ...thinkingOff(MODEL),
    max_tokens: 1600,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, urlTool],
    messages: [{
      role: 'user',
      content:
        `What is the official website of "${org}", the organizer of "${name}" in ${city}, ${country}?\n\n` +
        `Search the web, then call submit_organizer_url.\n` +
        `- The url must be that body's OWN site (its homepage or the event's official site it runs) — not a ticket seller, encyclopedia, news article or social profile.\n` +
        `- If the sources do not clearly show it, url=null and confident=false. Never guess a domain.`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('response truncated');
  const b = msg.content.find((x) => x.type === 'tool_use' && x.name === 'submit_organizer_url');
  if (!b) throw new Error('no tool call');
  return b.input;
}

async function answers(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' } });
      if (r.status < 400) return true; // a HEAD refused (403/405) still gets a GET
    } catch { /* try next */ }
  }
  return false;
}

// Names that mean the model guessed rather than found — never worth storing.
const REJECT = /wander\s*atlas|unknown|n\/a|not (?:specified|available|found)|various|multiple|local (?:authorities|organizers)|^the (?:city|organizers?)$/i;

async function askOrganizer(name, city, country) {
  const msg = await client.messages.create({
    model: MODEL, ...thinkingOff(MODEL),
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

if (process.env.URL_ONLY === '1') {
  const want = [];
  for (const f of (await readdir(POSTS)).filter((x) => x.endsWith('.md'))) {
    const raw = await readFile(join(POSTS, f), 'utf8');
    let parsed;
    try { parsed = matter(raw); } catch { continue; }
    const d = parsed.data;
    if (d.category !== 'event' || d.draft === true) continue;
    if (!d.eventOrganizer || typeof d.eventOrganizer.name !== 'string' || d.eventOrganizer.url) continue;
    // SINCE_DAYS (workflow use): only recent posts, so the few that never
    // settle are not re-asked — and re-billed — on every run.
    if (process.env.SINCE_DAYS && (d.pubDate instanceof Date ? d.pubDate.toISOString() : String(d.pubDate ?? '')).slice(0, 10) <new Date(Date.now() - Number(process.env.SINCE_DAYS) * 864e5).toISOString().slice(0, 10)) continue;
    want.push({ f, raw, parsed });
  }
  console.log(`\n🔗 Organizer url — ${want.length} live event(s) with a named organizer and no url${DRY ? ' (DRY)' : ''}\n`);
  const q = want.slice(0, LIMIT);
  let got = 0, none = 0, bad = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let item; (item = q.shift());) {
      const { f, raw, parsed } = item;
      const d = parsed.data;
      const org = d.eventOrganizer.name;
      try {
        const a = await askOrganizerUrl(org, eventSchemaName(d.title), d.region, d.country ?? '');
        const url = typeof a.url === 'string' ? a.url.trim() : '';
        let host = '';
        try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* not a url */ }
        if (!a.confident || !/^https?:\/\//.test(url) || !host) { none++; console.log(`  ? ${org} — unsettled, storing nothing`); continue; }
        if (NOT_AN_ORG_SITE.test(host)) { bad++; console.log(`  ✗ ${org} — ${host} is not an organizer's own site`); continue; }
        if (!(await answers(url))) { bad++; console.log(`  ✗ ${org} — ${url} does not answer`); continue; }
        got++;
        console.log(`  ✓ ${org} <${url}> — ${String(a.basis).slice(0, 60)}`);
        if (DRY) continue;
        // lib/frontmatter-edit: only this key's lines change; body byte-identical.
        await writeFile(join(POSTS, f), editFrontmatter(raw, { eventOrganizer: { ...d.eventOrganizer, url } }), 'utf8');
      } catch (e) {
        bad++;
        console.log(`  ⚠️  ${org}: ${String(e.message).slice(0, 80)}`);
      }
    }
  }));
  console.log(`\n📦 ${got} url stored · ${none} unsettled · ${bad} rejected/failed${DRY ? ' (DRY — nothing written)' : ''}`);
  process.exit(0);
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
