#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  EVENT OFFERS + PERFORMER BACKFILL — the two optional Event properties
//  Search Console still names on ~98 live event pages.
//
//  Same contract as backfill-event-organizer.mjs, and for the same reason:
//  the answer to a "missing recommended property" warning is VERIFIED data,
//  never a placeholder. An absent optional property is worth strictly more
//  than a wrong one, because a wrong one is a false statement in
//  machine-readable form on a page nobody re-reads.
//
//  What it stores, and what it deliberately does not:
//   • eventOffers.url — the OFFICIAL ticket or registration page. Resellers
//     (viagogo, StubHub, SeatGeek …) are rejected: they are not the event's
//     own offer, and half of them are dead links a year later.
//   • eventOffers.free — only when a source says entry is free in so many
//     words. Free entry is the common case across this hub, and offers is
//     the property that lets Google state it.
//   • NO PRICE for paid events. Ticket prices move weekly and come in tiers;
//     the eSIM pages already settled that a number which rots is worse than
//     no number. A free event is the one case where the value cannot rot.
//   • eventPerformer — ONLY when the event IS a named act (a concert, a tour
//     stop). Festival line-ups are excluded on purpose: they change every
//     edition, and a recurring event page outlives the line-up printed on
//     it, which turns a true fact into a false one by doing nothing at all.
//
//  Env: ANTHROPIC_API_KEY. DRY=1, LIMIT (default all), CONCURRENCY (default 4).
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import Anthropic from '@anthropic-ai/sdk';
import { eventSchemaName } from '../src/lib/eventName.mjs';
import { normalizeOffer, normalizePerformer } from '../src/lib/eventOffers.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const POSTS = 'src/content/posts';
const DRY = process.env.DRY === '1';
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

const submitTool = {
  name: 'submit_event_facts',
  description: 'Report the official ticket page, whether entry is free, and the named performer — only what the search actually shows',
  input_schema: {
    type: 'object',
    properties: {
      ticketUrl: { type: ['string', 'null'], description: "the OFFICIAL ticket or registration page on the event's or organiser's own site (https://...), or null" },
      ticketConfident: { type: 'boolean', description: 'true only if an authoritative source shows that exact page as the official way to buy or register' },
      free: { type: ['boolean', 'null'], description: 'true only if a source states entry is free; false if it states there is a ticket price; null if unclear' },
      currency: { type: ['string', 'null'], description: "ISO 4217 code of the country's currency (THB, JPY, EUR …) — needed only when free is true" },
      performer: { type: ['string', 'null'], description: 'the named act, ONLY when the event itself is that act performing (a concert or tour stop). null for festivals, markets, parades, fireworks, sports meets and anything with a line-up' },
      performerKind: { type: ['string', 'null'], enum: ['person', 'group', null], description: 'is the performer one person or a band/group' },
      performerConfident: { type: 'boolean', description: 'true only if sources confirm this act headlines this specific event' },
      basis: { type: 'string', description: 'one short phrase naming the source that settled it' },
    },
    required: ['ticketUrl', 'ticketConfident', 'free', 'currency', 'performer', 'performerKind', 'performerConfident', 'basis'],
  },
};

async function askFacts(name, city, country, startDate) {
  const msg = await client.messages.create({
    model: MODEL,
    // 1600 still truncated 3 of 85 on 2026-08-25 — a few festivals return
    // very long search results. 2400 covers those without inviting waste:
    // the reply is a short tool call, so unused budget costs nothing.
    max_tokens: 2400,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }, submitTool],
    messages: [{
      role: 'user',
      content:
        `For the event "${name}" in ${city}, ${country}${startDate ? ` (starting ${startDate})` : ''}:\n\n` +
        `Search the web, then call submit_event_facts.\n` +
        `- ticketUrl must be the event's or organiser's OWN ticketing/registration page. A resale site is not it. ` +
        `A guide, a listing aggregator, a Wikipedia article and a Facebook event are not it. If no official sales page is shown, set ticketUrl=null.\n` +
        `- free=true only if a source says entry is free. If it is a paid event, set free=false and do NOT report a price — prices change and tier out.\n` +
        `- performer ONLY when the event is a named act performing: "Coldplay Bangkok 2026" has a performer, "Songkran Festival" does not. ` +
        `A festival line-up is NOT a performer — leave it null even when the line-up is announced.\n` +
        `- Anything the sources do not clearly show: null, and the matching confident flag false. Never guess.`,
    }],
  });
  if (msg.stop_reason === 'max_tokens') throw new Error('response truncated');
  const b = msg.content.find((x) => x.type === 'tool_use' && x.name === 'submit_event_facts');
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
  if (d.draft === true) continue;
  // Asked once already: the run stamps eventFactsAsked even when it stores
  // nothing, so an unsettled event is never paid for twice.
  if (d.eventFactsAsked) continue;
  // A one-off event that has ENDED is already noindexed (src/lib/eventStatus),
  // so its structured data is not being read by anyone. Paying a search to
  // enrich a page search engines have been told to ignore is the exact cost
  // the automation-discipline rule exists to prevent. Recurring events are
  // asked, because their page stays indexed to win the next edition.
  const ended = d.eventEndDate && new Date(d.eventEndDate) < new Date();
  if (ended && d.eventRecurring !== true) continue;
  todo.push({ f, raw, parsed });
}

console.log(`\n🎟️  Event offers/performer — ${todo.length} live post(s) to ask about${DRY ? ' (DRY)' : ''}\n`);
const queue = todo.slice(0, LIMIT);
let offers = 0, performers = 0, nothing = 0, failed = 0;

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const { f, raw, parsed } = item;
    const d = parsed.data;
    const name = eventSchemaName(d.title);
    try {
      const a = await askFacts(name, d.region, d.country ?? '', d.eventStartDate ? new Date(d.eventStartDate).toISOString().slice(0, 10) : '');

      // The confident flags gate what we even offer to the shared rule; the
      // rule then decides what is storable. Both have to say yes.
      const offer = normalizeOffer({
        url: a.ticketConfident ? a.ticketUrl : null,
        free: a.free,
        currency: a.currency,
      });
      const performer = a.performerConfident
        ? normalizePerformer({ name: a.performer, kind: a.performerKind })
        : null;

      if (offer) offers++;
      if (performer) performers++;
      if (!offer && !performer) {
        nothing++;
        console.log(`  ? ${name} — nothing verifiable, storing nothing`);
      } else {
        console.log(`  ✓ ${name}: ${offer ? (offer.url ? `<${offer.url}>` : `free/${offer.currency}`) : ''}${performer ? ` performer=${performer.name}` : ''} — ${String(a.basis).slice(0, 60)}`);
      }
      if (DRY) continue;
      if (offer) parsed.data.eventOffers = offer;
      if (performer) parsed.data.eventPerformer = performer;
      parsed.data.eventFactsAsked = true;
      let out = matter.stringify(parsed.content, parsed.data);
      if (raw.includes('\r\n')) out = out.replace(/\r?\n/g, '\r\n'); // keep the file's own line endings
      await writeFile(join(POSTS, f), out, 'utf8');
    } catch (e) {
      failed++;
      console.log(`  ⚠️  ${name}: ${String(e.message).slice(0, 80)}`);
    }
  }
}));

console.log(`\n📦 ${offers} offer(s) · ${performers} performer(s) · ${nothing} unsettled (nothing written) · ${failed} failed${DRY ? ' (DRY — nothing written)' : ''}`);
