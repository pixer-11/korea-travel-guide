#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  DISCOVER current EVENTS + new HOTSPOTS (web search) → timely posts
//  For each ACTIVE country, uses Claude's web-search tool to find:
//   • upcoming events (big concerts/tours, major sports, festivals, exhibitions)
//   • newly-opened / trending restaurants, cafés, bars, and hotspots
//  and writes a deep guide for each NEW one. Complements the fixed seasonal
//  calendar (data/events.json) and the Places-driven daily cron.
//
//  Web-sourced + time-sensitive, so posts tell readers to confirm details on
//  official sources. Deduped via data/published.json.
//  Usage:  node scripts/discover-events.mjs
//          COUNTRY=Japan node scripts/discover-events.mjs
// ─────────────────────────────────────────────────────────────
import './lib/env.mjs';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import './lib/claude-meter.mjs'; // counts this file's Claude spend into the cost ledger
import { makeTitle } from './lib/titles.mjs';
import matter from 'gray-matter';
import { topicKey } from './lib/topic-key.mjs';
import { keyToken, tokens as nameTokens, performerCategoryPhotos, eventCategoryPhotos } from './lib/commons.mjs';
import { isUsedImage, markUsedImage } from './lib/hero-url.mjs';
import { eventKey, isEventTwin } from './lib/event-twin.mjs';
import { eventProperName, eventAcronym } from '../src/lib/eventName.mjs';
import { normalizeOffer, normalizePerformer } from '../src/lib/eventOffers.mjs';
import yaml from 'js-yaml';
import { slugify } from './lib/slugify.mjs';
import { clip } from './lib/serp.mjs';
import { bracketsBalanced, endsInAbbreviation } from '../src/lib/sentence-boundary.mjs';
import { writeArticle, writerRequest } from './lib/writer.mjs';
import { runBatch, batchWaitMin } from './lib/claude-batch.mjs';
import { resolveHero, loadUsedImageUrls, eventTopic } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';
import { verifyHeroImage, recordHeroVerdict } from './lib/vision-check.mjs';
import { foreignInFilename, geoTokens } from './lib/event-file-identity.mjs';
import { loadWorld } from './lib/commons-identity.mjs';
import { ownCountry } from './lib/country-of-city.mjs';
import { isPastEvent } from './lib/event-past.mjs';

// Place-name tokens for the filename identity audit (a past host city in a
// file name is WHERE an edition was held, not another act).
const WORLD_GEO = geoTokens(await loadWorld().catch(() => null));

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const COUNTRIES_FILE = join(ROOT, 'data', 'countries.json');
const PUBLISHED_FILE = join(ROOT, 'data', 'published.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 6 });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
// How many candidates one search may return. Raising it costs nothing per run.
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES ?? 8);
// Measured 2026-08-08..09-04, per published page: events rank at position 24 with
// 1.15% CTR, the best of any category we make; generic attractions sit at 58 with
// 0.06%. Events also come from this weekly web search rather than the Places text
// quota, so they cost nothing that the daily publish needs. Two per country was
// the tightest cap on our best-performing page type; four is not a volume push,
// it is the mix following the numbers.
const EVENTS_PER_COUNTRY = Number(process.env.EVENTS_PER_COUNTRY ?? 4);
// OFF since 2026-10-06 (owner: halve the Claude bill to ~$400/month). Raised
// on 2026-09-09 when Bing gave trendy 0.57 clicks per page against events
// 0.42; a month later, over every published post, it is event 0.68 against
// trendy 0.055 — a twelfth. A hotspot costs what an event costs (search,
// writer, four translations), and each run wrote ~50 of them beside ~50
// events. At 0 the hotspot web search is skipped too, not just its posts.
// Set HOTSPOTS_PER_COUNTRY to bring them back.
const HOTSPOTS_PER_COUNTRY = Number(process.env.HOTSPOTS_PER_COUNTRY ?? 0);

// Sonnet 5 reasons unless told not to, and the reasoning is drawn from
// max_tokens before a word of the answer: on 10-05, 11 of 20 country searches
// ended at max_tokens — four with ZERO characters of text — and each was read
// as "no events". The UK and Mexico had never had an event post. Off where the
// model allows it (Opus 5.5 / Fable cannot turn it off, so they get headroom
// instead), and a reply that is still cut is retried once with twice the room.
const CAN_DISABLE_THINKING = !/opus-5-5|fable-5|mythos-5/.test(MODEL);
const searchParams = (prompt, maxTokens) => ({
  model: MODEL,
  max_tokens: maxTokens,
  ...(CAN_DISABLE_THINKING ? { thinking: { type: 'disabled' } } : {}),
  tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
  messages: [{ role: 'user', content: prompt }],
});
const listIn = (text) => {
  // From the first [ to the last ] — prose before or after the list is not the list.
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b <= a) return null;
  try { const arr = JSON.parse(text.slice(a, b + 1).replace(/```/g, '')); return Array.isArray(arr) ? arr : null; } catch { return null; }
};

// `pre`: the reply to searchParams(prompt, maxTokens) a batch already fetched.
async function searchJson(prompt, maxTokens = 12000, retried = false, pre = null) {
  let msg;
  try {
    // 1600 → 4000 (09-24, eight ~15-field items) → 12000 (10-05): a ceiling,
    // not a spend — only the tokens written are billed.
    msg = pre || await client.messages.create(searchParams(prompt, maxTokens));
  } catch (e) {
    // Thrown on, not swallowed: an API failure returned [] here, so with every
    // search down (529s) each country read "0 found", the run's failure guard
    // saw no failure and reported success (Codex review, 10-01). The caller's
    // attempt() logs it, skips the country and fails the run if nothing came.
    console.log(`  ⚠️  search failed: ${e.message}`);
    throw e;
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  // Eight, not four, since 2026-09-09. The list costs one search whatever its
  // length, and by now most countries' first four are events we already cover —
  // the run log is a column of "already covered; skipping". A longer list is
  // free candidates, and the write path still gates every one of them.
  const arr = listIn(text);
  if (arr) return arr.slice(0, MAX_CANDIDATES);
  // A cut or unparseable reply is NOT "no events". It used to return [] here,
  // so attempt() counted a success and the run ended green with half the
  // countries silently skipped. Retry once with more room, then fail loudly.
  console.log(`  ⚠️  search reply was not a JSON list (${msg.stop_reason}, ${text.length} chars)${retried ? '' : ' — retrying with more room'}`);
  if (!retried) return searchJson(prompt, maxTokens * 2, true);
  throw new Error(`search reply unusable twice (${msg.stop_reason}, ${text.length} chars)`);
}

const discoverEvents = (country, pre = null) => searchJson(eventsPrompt(country), 12000, false, pre);
const eventsPrompt = (country) => (
    `Search the web for NOTABLE, currently-UPCOMING events in ${country} over the next ~12 weeks that would draw international visitors: ` +
    // Famous-only was the wrong filter, and the file already knew it: the CTR
    // note above records events at position 24 with 1.15% CTR against generic
    // attractions at 58 with 0.06%, and trendy converting at 19% against a
    // famous landmark's 1.3% — because a small show is a query nobody else
    // answers while the Olympics belong to every outlet on earth. The caps
    // were raised on 2026-09-09; this string was still doing the filtering.
    `concerts and tours (globally famous artists AND regional or touring acts), sports events (majors, and also national league finals, marathons and city races), festivals of any size including local and seasonal ones, and special exhibitions. ` +
    `Small and regional events count and are often the better answer — prefer one with a confirmed date and city over a famous one without. ` +
    // Who actually finds these pages (Bing, 2026-10-05): event guides earn 3.8%
    // CTR against 0.4% for landmarks, and the week's top six were all read in
    // Chinese or Japanese — China Open tennis, the Arc for Chinese visitors,
    // Shanghai Masters, BIGBANG in Hanoi, snooker in Xi'an. Lean the pick
    // toward events with a big East Asian following; the count is unchanged.
    `Give priority to events that draw fans from China, Japan, Korea, Taiwan and Hong Kong: tours by Asian pop acts (K-pop, J-pop, Mandopop/C-pop), and international sports with a large East Asian following (tennis, snooker, Formula 1, MotoGP, badminton, table tennis, chess, esports, big-city marathons). ` +
    `Only REAL, CONFIRMED, upcoming events with a known date and city. ` +
    // The Bangkok F4 lesson (2026-08-07): the official branding was "F✦FOREVER
    // 1st World Tour" but every live search query said "f4 concert bangkok" —
    // the page ranked 4-6 with 0 clicks because the searched-for name appeared
    // nowhere in the title. Ask for the searched-for name up front.
    `"name" must be the name people actually SEARCH for: include the widely-used short form or act name when one exists (e.g. "F4 (Meteor Garden) Reunion World Tour", not only the official branding "F✦FOREVER 1st World Tour"). ` +
    // MAX_CANDIDATES, not a literal: the slice was raised to 8 on 2026-09-09 but
    // this sentence still said 4, so the model never sent more than 4 (09-24).
    `Respond with ONLY a JSON array (no prose, no code fence) of up to ${MAX_CANDIDATES} items: ` +
    `[{"name":"...","city":"...","date":"human-readable e.g. August 1-9, 2026","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD (same as startDate if one day; last day if multi-day)","category":"event","recurring":true,"organizer":"official organizing body, or null","organizerUrl":"its official site, or null","venue":"the named venue where it takes place (stadium, arena, circuit, park, hall) as the sources name it, or null","ticketUrl":"the official ticket or registration page on the event's own site, or null","free":true or false or null,"currency":"ISO 4217 code of the country's currency when free is true, else null","performer":"the named act when the event IS that act performing, else null","performerKind":"person or group, else null","summary":"1-2 factual sentences: what, where, when"}]. ` +
    `startDate/endDate MUST be valid ISO dates; omit them only if the exact date is genuinely unknown. ` +
    // Recurrence decides whether the page stays indexed once the date passes
    // and whether it advertises a yearly cadence in schema. It used to be
    // guessed from words in the title, which silently failed for every annual
    // event whose NAME says nothing — Lollapalooza, Tour de France and
    // ChinaJoy all read as one-offs. The search is already happening; ask.
    `"recurring" is true ONLY for an event held on a regular yearly (or near-yearly) cycle — an annual festival, a championship round, a race that returns each year. ` +
    `A concert, a tour stop, a one-time exhibition or a one-off match is false. When unsure, use false. ` +
    // Google Event schema wants an organizer, but only the REAL one is worth
    // stating (we once stamped ourselves as organizer of every festival — a
    // machine-readable false claim, removed 2026-08-07). The search results
    // usually name the host; capture it when they do, never guess.
    `"organizer" is the official organizing body EXACTLY as the search results name it (city government, festival committee, promoter). null when the results do not clearly name one — never guess or infer. "organizerUrl" only if the results show its official site; else null. ` +
    // Offers and performer are the other two properties Google names for
    // Event, and they follow the organizer's rule exactly. Asking here costs
    // nothing — the search is already running — and it is the difference
    // between a page that is born complete and one a backfill has to revisit.
    `"ticketUrl" must be the event's or organiser's OWN ticketing/registration page; a resale site, a listing aggregator, a Wikipedia article or a Facebook event is not it — null if the results do not show an official one. ` +
    `"free" is true only if the results say entry is free, false if there is a ticket price, null if unclear; never report a price, because prices change and tier out. ` +
    `"performer" ONLY when the event IS a named act performing (a concert or tour stop): "Coldplay Bangkok 2026" has one, "Songkran Festival" does not. A festival line-up is NOT a performer — null even when announced. ` +
    // "Multiple cities" once became a REGION PAGE titled "여러 도시" (La Vuelta,
    // caught by the owner 2026-08-09). A traveling race still anchors somewhere.
    `"city" must be ONE real city. For a multi-city race or tour, use the finish city (or the start city if the finish is unknown) — NEVER "Multiple cities", "Various", "Nationwide" or similar. ` +
    `If nothing notable, return [].`
  );

const discoverHotspots = (country) =>
  searchJson(
    `Search the web for newly-opened or currently TRENDING, buzzworthy restaurants, cafés, bars, or hotspots across ${country}'s major cities in 2026 — places travelers and locals are talking about right now. ` +
    `Only REAL, currently-open venues (not permanently closed). ` +
    `Respond with ONLY a JSON array (no prose, no code fence) of up to 4 items: ` +
    `[{"name":"...","city":"...","category":"restaurant","summary":"1-2 factual sentences: what it is, where, why it's notable"}] ` +
    `where category is one of "restaurant","trendy","hidden-gem". If nothing notable, return [].`
  );

// Validate AND round-trip: Date.parse rolls "2026-02-30" over to Mar 2, so a
// malformed model date would be stored then silently shift everywhere (and could
// even make z.coerce.date() throw at build). Require Y-M-D to survive a round trip.
const isIsoDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function frontmatter(data) {
  return `---\n${yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n\n`;
}

async function loadDone() {
  try { const { done } = JSON.parse(await readFile(PUBLISHED_FILE, 'utf8')); return new Set(done ?? []); }
  catch { return new Set(); }
}

// Everything decided about a candidate BEFORE the writer is paid: the checks
// that refuse it, and the title and facts the writer is given. Pure — nothing
// in ctx is changed — so main() can run it ahead of time to pick the guides
// whose first writer request goes out in one half-price batch (2026-10-10).
// null = not written.
function planDiscovered(item, ctx, log = console.log) {
  const { kind, existing, done, existingTopics, eventAnchors } = ctx;
  if (!item?.name || !item?.city) return null;
  // Multi-stage events can come back with a messy "city" like
  // "Nice (finish) / various French stages". A "/" there becomes the post's
  // region and breaks the /regions/[region] route on a clean build, so reduce it
  // to the primary city (drop anything after a "/", "(", ";" or ",").
  item.city = String(item.city).split(/\s*[/(;]/)[0].split(',')[0].trim() || item.city;
  // The city decides the country, not the search that found it: China's search
  // returned a Hong Kong restaurant on 2026-10-05 and it was filed under China
  // (lib/country-of-city — an exact region match in one other country only).
  const country = ownCountry(item.city, ctx.country, ctx.countries || []);
  if (country !== ctx.country) log(`   ${item.city}: filed under ${country}, not ${ctx.country}`);
  const cat = kind === 'event' ? 'event'
    : ['restaurant', 'trendy', 'hidden-gem'].includes(item.category) ? item.category : 'trendy';
  const key = `${kind}:${slugify(`${country}-${item.name}`)}`;
  const slug = slugify(`${item.city}-${item.name}`);
  if (done.has(key) || existing.has(slug)) return null;
  if (kind === 'event' && isPastEvent(item)) {
    log(`    ⏭️  "${item.name}" — already over (${item.endDate || item.startDate}); not writing a new guide`);
    return null;
  }

  // "Dates, Tickets & Venue" replaced "What to Know" on 2026-08-07: GSC showed
  // event pages ranked 4-10 with CTR at half of expectation (EuroVolley: 449
  // impressions, 0.9%), and the live queries were all dates/tickets/venue
  // intent the old suffix never answered. Every suffix-stripping consumer
  // (topic-key, eventName.mjs, the ics/md feeds, reresolve-images) matches
  // BOTH suffixes, so the back catalogue and the new form coexist.
  const title = kind === 'event'
    ? `${item.name}: Dates, Tickets & Venue${item.city ? ` (${item.city})` : ''}`
    : makeTitle(item.name, { region: item.city, category: cat });
  // Near-duplicate guard: skip if a same-topic post already exists. Catches name
  // variants ("ChinaJoy" vs "ChinaJoy 2026") that pass the exact-slug check above
  // but collapse to the same normalized topic key that validate-content uses.
  const tkey = topicKey(title, item.city);
  if (existingTopics.has(tkey)) return null;
  // Duplicate coverage, decided BEFORE any spend (writer + hero + vision + four
  // translations went to five rephrased twins on 2026-08-20). Same event =
  // same country, overlapping dates, and either the same anchor word, shared
  // name tokens, or a same-city pair where one title is all generic words —
  // "Formula 1 Italian Grand Prix" has NO distinctive token (every word is an
  // anchor stop-word), which is exactly how the Monza twin slipped both the
  // topicKey equality here and validate's anchor rule.
  // The rule lives in lib/event-twin.mjs, shared with validate-content (it
  // gained a venue match and a 10-day window on 2026-10-05: four live twins
  // slipped the city-string and 3-day assumptions).
  const candKey = kind === 'event' ? eventKey({
    title, country, region: item.city,
    start: isIsoDate(item.startDate) ? item.startDate : '',
    end: isIsoDate(item.endDate) ? item.endDate : '',
    venue: typeof item.venue === 'string' ? item.venue : '',
  }) : null;
  if (kind === 'event' && eventAnchors) {
    const twin = eventAnchors.find((ev) => isEventTwin(candKey, ev));
    if (twin) {
      log(`    ↩︎  "${item.name}" — already covered (${twin.anchor || 'same city+dates'}); skipping before generation`);
      return null;
    }
  }
  const facts = {
    name: item.name, city: item.city, date: item.date, country, summary: item.summary,
    guidance:
      kind === 'event'
        // 2026-10-06: this used to ask for the standing instruction "Confirm
        // timing and tickets on the official site" — the sentence the
        // ended-event ADVICE check flags, so 162 of 166 upcoming guides were
        // due a rewrite the day they ended. Say where the facts live, as a fact.
        ? 'Time-sensitive event discovered via web search. Use the given facts and state the date as announced. The page stays online after the event, so every sentence must still be true the day after it ends: say where dates, venue and tickets are published as a FACT ("The organiser publishes the dates and ticket links on its official site"), naming the organiser or ticketing platform when the facts name it, and give practical tips as what attendees usually do ("Fans typically arrive an hour before doors"), never as an instruction to the reader. NEVER write "confirm/check/verify ... before", "book ahead", "arrive early", "closer to the date/event", "will be announced/confirmed", "have not been confirmed yet", "tickets go on sale", "lineup has yet to", or "once released". Do not invent lineup, prices, or times.'
        : 'Recently-opened / trending spot discovered via web search. Use the given facts; describe what it is, where, and why it stands out. Tell readers to confirm hours and reservations before visiting. Do not invent a menu, prices, or exact hours you were not given.',
  };
  return { country, cat, key, slug, title, tkey, candKey, facts };
}

async function writeDiscovered(item, ctx) {
  const { kind, existing, done, existingTopics, eventAnchors } = ctx;
  const plan = planDiscovered(item, ctx);
  if (!plan) return false;
  const { country, cat, key, slug, title, tkey, candKey, facts } = plan;
  const args = { title, region: item.city, country, category: cat, facts };
  const pw = ctx.prewritten?.get(slug);
  ctx.prewritten?.delete(slug);
  const pre = pw && pw.prompt === writerRequest(args).messages[0].content ? pw.msg : null;
  const { body, quickAnswer, faq } = await writeArticle({ ...args, pre });
  if (!body || body.length < 300) return false;

  // Try the event/venue's own imagery first (a concert's performer photo is fine
  // for the ARTICLE hero) — the destination TILE already excludes events via
  // pickRepHeroUrl, so an artist shot never stands in for the place. Pass `used`
  // so no two posts share the same photo (id-level de-dupe), falling back to
  // city/country imagery only when nothing specific is found.
  const eventVenue = cat === 'event' && typeof item.venue === 'string' ? item.venue.trim() : '';
  // AT BIRTH, the same filename identity audit the night patrol applies
  // (lib/event-file-identity.mjs). Vision cannot tell acts apart, so without
  // this a venue find of ANOTHER band at the same hall ("Mayday Taipei Dome
  // Concert" for a HIGE DANDism guide) would pass the gate and go live, and
  // only the patrol — a night later, at a second vision cost — could catch
  // it. A refused file costs nothing (no vision call) and is marked used, so
  // the next turn surfaces a different one.
  const knownTok = new Set([
    ...nameTokens(item.name), ...nameTokens(eventTopic(item.name)),
    ...nameTokens(item.city || ''), ...nameTokens(country || ''), ...nameTokens(eventVenue),
  ]);
  const anchor = cat === 'event' ? keyToken(item.name, `${item.city || ''} ${country || ''}`) : '';
  let hero = null;
  // Category photos FIRST, at birth (2026-10-08). A singer's guide used to be
  // born wearing the arena (BABYMONSTER Bangkok → IMPACT Arena) because the
  // text search answers with the venue, and the night patrol never revisits a
  // live guide that has a photo — so the act's own photos, sitting in
  // Category:Babymonster, never got a turn. The act's category, then the
  // event's own (past editions), each vision-checked here; the first that
  // passes is the hero, and its category is recorded as the identity proof
  // audit-event-hero-identity reads. Nothing passes → the search below.
  let preVerified = null;
  if (cat === 'event') {
    const performer = typeof item.performer === 'string' ? item.performer.trim() : '';
    const pool = [];
    try { if (performer) pool.push(...await performerCategoryPhotos(performer, { limit: 6 })); } catch {}
    try { pool.push(...await eventCategoryPhotos(item.name, { region: item.city || '', limit: 6 })); } catch {}
    let tried = 0;
    for (const c of pool) {
      if (tried >= 3) break;
      if (isUsedImage(ctx.usedImages, c.url)) continue;
      tried++;
      const vis = await verifyHeroImage({ url: c.url, name: item.name, category: cat, region: item.city, country, eventMode: true, venue: eventVenue });
      if (!vis.ok) { console.log(`   ${item.name}: category photo rejected (${vis.reason})`); continue; }
      // Reserve it now: two cities' guides for one act would otherwise both take
      // the act's first passing photo in the same run (Codex, 10-09).
      hero = c; preVerified = vis; markUsedImage(ctx.usedImages, c.url);
      console.log(`   ${item.name}: hero from Category:${c.category}`);
      break;
    }
  }
  for (let turn = 0; !preVerified && turn < (cat === 'event' ? 8 : 1); turn++) {
    const pick = await resolveHero({
      namedVenue: item.name,
      venue: eventVenue,
      region: item.city,
      // Events: try the specific act/fighter (namedVenue) first, then fall back to
      // the event TYPE (MMA, racing, concert…) rather than the raw name, so a hero
      // is at least on-topic. Hotspots keep their venue name as the topic.
      topic: cat === 'event' ? eventTopic(item.name) : item.name,
      country,
      used: ctx.usedImages,
      preferTopic: cat === 'event',
      eventMode: cat === 'event',
      // Stock photography can't tell one act from another — a generic Unsplash
      // concert crowd would pass event-mode vision under any performer's name.
      // Events may publish photoless by policy, so refusing stock costs nothing
      // (backfill-photos-alt already bans this class; the two paths now agree).
      allowUnsplash: false,
    });
    if (cat === 'event' && pick?.url && pick.license === 'wikimedia') {
      const foreign = foreignInFilename(pick.url, { known: knownTok, anchor, via: pick.via, geo: WORLD_GEO, name: eventProperName(item.name), acronym: eventAcronym(item.name), performer: typeof item.performer === 'string' ? item.performer : '', country, region: item.city || '' });
      if (foreign) { console.log(`   ${item.name}: file names another act (${foreign}) — next`); continue; }
    }
    hero = pick;
    break;
  }
  let heroImage = isImageAllowed(hero)
    ? { url: hero.url, credit: hero.credit, license: hero.license, source: hero.source } : undefined;
  // This was the LAST publish path with no vision gate — the 07-29 event batch
  // it produced shipped a radio-software screenshot for the Airtime festival
  // and a cycling team for a dance tour, and because the nightly patrol skips
  // live events, nothing ever re-checked them (24 quarantined 2026-08-01).
  // Owner's absolute rule: no photo reaches a page unverified — a photoless
  // event post is a fine outcome, a wrong photo is not. Fail closed: an
  // unverifiable image (API down) is treated as unverified and dropped.
  if (heroImage) {
    const vis = preVerified ?? await verifyHeroImage({
      url: heroImage.url, name: item.name, category: cat,
      region: item.city, country, eventMode: cat === 'event',
      venue: cat === 'event' && typeof item.venue === 'string' ? item.venue.trim() : '',
    });
    if (!vis.ok) {
      console.log(`    ✗ hero rejected by vision (${vis.reason}) — publishing without hero`);
      heroImage = undefined;
    } else {
      // Write the gate's verdict into the store validate-content trusts.
      // Without this, every gate-approved event hero read as never-checked —
      // 51 of them by 2026-08-07, closed by a one-off back-audit that this
      // line makes unnecessary for everything published after it.
      await recordHeroVerdict(slug, heroImage.url, 'MATCH', `event publish gate: ${vis.reason || 'approved'}`);
      // Keep the focus point the gate just reported. generate.mjs has done
      // this since 08-15; here the same verdict was thrown away, so the first
      // discovery run after the gate learned NO-FOCUS (08-20) built 12 event
      // posts that were all held back at publish — a full generation each,
      // paid and shelved, for a field the vision call had already returned.
      if (vis.focus) heroImage = { ...heroImage, focus: vis.focus };
      if (preVerified && hero?.category) {
        try {
          const p = 'data/performer-category-heroes.json';
          const proof = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
          proof[slug] = { url: heroImage.url, category: hero.category, at: new Date().toISOString() };
          writeFileSync(p, JSON.stringify(proof, null, 1) + String.fromCharCode(10));
        } catch {}
      }
    }
  }

  // The meta description is the answer-first summary, clipped on a sentence —
  // the rule generate.mjs has used for every place guide since 08-01
  // (lib/serp.mjs). Until 2026-09-29 events got a fixed template instead:
  // 83 live descriptions ended in the same "What it is, when and where, and how
  // to plan around it.", a signpost that says nothing, reads as machine-written
  // in every language it was translated into, and spends half the snippet.
  // The template stays only as the fallback for an empty summary.
  // Only a clip that ends as a sentence: a summary like "Seoul Jazz Festival
  // tickets and lineup for September 2026" has no full stop, and validate-content
  // would hold the post as TRUNCATED-DESCRIPTION (Codex, 2026-09-29). Same
  // health test backfill-descriptions.mjs applies to the back catalogue.
  const qaClip = clip(String(quickAnswer || '').trim().replace(/\s+/g, ' '));
  const qaDesc = qaClip && /[.!?…](['"”’)\]]*)?$/.test(qaClip) && bracketsBalanced(qaClip) && !endsInAbbreviation(qaClip)
    ? qaClip : '';
  const data = {
    title,
    description: qaDesc
      ? qaDesc
      : kind === 'event'
      ? `${item.name} in ${item.city}, ${country}${item.date ? ` — ${item.date}` : ''}. What it is, when and where, and how to plan around it.`
      : `${item.name} in ${item.city}, ${country} — a new/trending spot: what it is, where it is, and how to visit.`,
    country, region: item.city, category: cat,
    pubDate: new Date().toISOString().slice(0, 10),
    // Structured event dates (ISO) drive upcoming/ended state, hub sorting, Event
    // schema. Only stored when the model returned a valid date.
    ...(cat === 'event' && isIsoDate(item.startDate) && { eventStartDate: item.startDate }),
    ...(cat === 'event' && isIsoDate(item.endDate || item.startDate) && { eventEndDate: item.endDate || item.startDate }),
    // Recurrence as a FACT from the search, not a guess from the title. Only
    // stored when the model actually answered — an absent field falls back to
    // the title heuristic, which is what the 110 posts written before today
    // still rely on.
    ...(cat === 'event' && typeof item.recurring === 'boolean' && { eventRecurring: item.recurring }),
    // Only when the discovery search clearly named the real host — the field
    // feeds Event schema's organizer, where a guess is a false claim.
    // The venue, as the sources name it — the photo pipeline's second key.
    ...(cat === 'event' && typeof item.venue === 'string' && item.venue.trim().length >= 3 && { eventVenue: item.venue.trim().slice(0, 120) }),
    ...(cat === 'event' && typeof item.organizer === 'string' && item.organizer.trim() && {
      eventOrganizer: {
        name: item.organizer.trim(),
        ...(typeof item.organizerUrl === 'string' && /^https?:\/\//.test(item.organizerUrl) && { url: item.organizerUrl.trim() }),
      },
    }),
    // Offer and performer, judged by the SAME rule the backfill uses
    // (src/lib/eventOffers.mjs) so the two paths cannot drift apart.
    ...(cat === 'event' && (() => {
      const offer = normalizeOffer({ url: item.ticketUrl, free: item.free, currency: item.currency });
      return offer ? { eventOffers: offer } : {};
    })()),
    ...(cat === 'event' && (() => {
      const performer = normalizePerformer({ name: item.performer, kind: item.performerKind });
      return performer ? { eventPerformer: performer } : {};
    })()),
    // The discovery search has now been asked; the backfill skips this post.
    ...(cat === 'event' && { eventFactsAsked: true }),
    heroImage, gallery: [],
    tags: [item.city.toLowerCase(), kind === 'event' ? 'event' : 'new & trending'],
    quickAnswer, faq, aiGenerated: true,
    // A VENUE post with no hero starts life PARKED: a café guide with no
    // picture of the café is a weak page, and the alt-photo patrol publishes
    // it the night it finds a hero that clears the vision gate. (It used to
    // publish as draft:false and be quarantined moments later for the same
    // reason — 42 posts on 2026-08-06, reported as "콘텐츠 검증 실패", which
    // reads like broken content rather than "no photo we trust yet".)
    //
    // An EVENT ships regardless. No free source carries a photo of most
    // concerts, so parking them meant they never appeared at all: 132 posts
    // sat unpublished and 68 were days from automatic deletion — while events
    // were the site's strongest pages in Search Console (top page by
    // impressions, positions 3-8 and 25-100% CTR on event queries). Someone
    // searching "comiket 108" wants the date, the venue and the ticket link,
    // and those are on the page with or without a picture. The rule that does
    // not move: a WRONG photo never ships (2026-08-07).
    draft: cat === 'event' ? false : !heroImage,
  };
  const src = kind === 'event'
    ? 'Editor-reviewed, AI-assisted, using current web sources. Event dates and tickets change — always confirm on the official site.'
    : 'Editor-reviewed, AI-assisted, using current web sources. Hours and details change — confirm before you go.';
  // Disclosure now lives in the page chrome (collapsed <details> next to the fact
  // box), not the body — the inline blockquote duplicated it on every post.
  // A bare ~ is GFM strikethrough syntax and the writer reaches for it as
  // "about" ("~30 min"). generate.mjs escapes it at the source since 08-11;
  // this writer didn't, and nagoya-asian-games shipped struck-through text
  // (validate warning, 08-20). Same fix, same place: where the file is written.
  const safeBody = String(body).replace(/(^|[^\\])~/g, '$1\\~');
  await writeFile(join(POSTS_DIR, `${slug}.md`), frontmatter(data) + safeBody + '\n', 'utf8');
  existing.add(slug); done.add(key); existingTopics.add(tkey);
  if (kind === 'event' && eventAnchors) eventAnchors.push(candKey);
  console.log(`    ✅ [${kind}] ${slug}`);
  return true;
}

async function main() {
  if (!existsSync(POSTS_DIR)) await mkdir(POSTS_DIR, { recursive: true });
  const { countries } = JSON.parse(await readFile(COUNTRIES_FILE, 'utf8'));
  const only = process.env.COUNTRY;
  const active = countries.filter((c) => c.active && (!only || c.name === only));
  const done = await loadDone();
  const existing = new Set((await readdir(POSTS_DIR)).map((f) => f.replace(/\.md$/, '')));
  // Normalized topic keys of existing posts → generation-time near-dup prevention
  // (same rule validate-content uses to detect them after the fact).
  const existingTopics = new Set();
  for (const f of (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'))) {
    try {
      const { data } = matter(await readFile(join(POSTS_DIR, f), 'utf8'));
      if (data.title && data.region) existingTopics.add(topicKey(data.title, data.region));
    } catch {}
  }
  // Anchor tokens of existing EVENT posts per country — validate-content's own
  // duplicate rule (keyToken + country + overlapping dates), applied BEFORE a
  // full article + hero + vision + four translations are paid for. The weaker
  // topicKey equality above let five rephrased twins through on 2026-08-20
  // ("BIGBANG 20/26" vs "BIGBANG 2026-2027 XX COSMOS"): each was fully built,
  // translated 4x, then held back by the gate that runs the strict rule.
  const eventAnchors = []; // [{country, region, anchor, toks, start, end}]
  for (const f of (await readdir(POSTS_DIR)).filter((f) => f.endsWith('.md'))) {
    try {
      const { data } = matter(await readFile(join(POSTS_DIR, f), 'utf8'));
      if (data.category !== 'event' || !data.title) continue;
      // eventKey reads a Date as a date — String(Date).slice(0, 10) gave
      // "Sat Oct 03" for every unquoted YAML date.
      eventAnchors.push(eventKey({ title: data.title, country: data.country, region: data.region,
        start: data.eventStartDate, end: data.eventEndDate, venue: data.eventVenue }));
    } catch {}
  }
  // Site-wide set of hero images already in use (URL + photo-id) → no dupes.
  const usedImages = await loadUsedImageUrls(POSTS_DIR);

  console.log(`\n📡  Discovering events + hotspots — ${active.map((c) => c.name).join(', ')}\n`);
  let total = 0;

  // One failure costs one item, not the run. 2026-10-01: after 30 minutes of
  // writing events, one 529 Overloaded threw out of here, the job failed, the
  // commit step was skipped and every event already written was lost. Now an
  // item or a country that fails is logged and skipped; the run fails only if
  // something failed and nothing was published (an outage still alerts).
  const failures = [];
  const attempt = async (what, fn, fallback) => {
    try { return await fn(); } catch (e) {
      const why = `${e?.status ?? ''} ${String(e?.message ?? e).slice(0, 160)}`.trim();
      failures.push(`${what}: ${why}`);
      console.log(`    ⚠️ ${what} failed — skipped (${why})`);
      return fallback;
    }
  };
  // ── half price: first requests through the Message Batches API ──
  // 2026-10-10: the country searches and the writer's first draft went out at
  // full price one by one, ~$75 a month that the batch API halves (the request
  // is byte-for-byte the same; lib/claude-batch). Batches usually end in 3-10
  // minutes but have taken two hours (10-01), so each wait is capped and
  // whatever is not back by then is asked directly, exactly as before — the
  // cap only bounds the delay; it can never cost a guide. DISCOVER_BATCH=0 is
  // the old path.
  // The wait is re-read before each batch: it shrinks as the job runs on.
  const useBatch = process.env.DISCOVER_BATCH !== '0';
  const waitMin = () => (useBatch ? batchWaitMin(Number(process.env.DISCOVER_BATCH_WAIT_MIN || 25)) : 0);
  let wait = waitMin();
  const searched = wait
    ? await runBatch(client, active.map((c) => ({ id: c.name, params: searchParams(eventsPrompt(c.name), 12000) })), { waitMin: wait })
    : new Map();
  // Every country's list first (a batched reply, else a direct search), then
  // the guides each list would get, picked by the same checks writeDiscovered
  // applies — on copies, so the real run below still decides everything.
  const lists = new Map();
  for (const c of active) {
    lists.set(c.name, await attempt(`${c.name} event discovery`, () => discoverEvents(c.name, searched.get(c.name) ?? null), []));
  }
  // slug -> { msg, prompt }. The prompt is the request the reply answers; a
  // candidate only takes a reply whose prompt is exactly its own, once — two
  // list entries can share a slug, and the second must not wear the first's
  // prose (Codex review, 10-10).
  const prewritten = new Map();
  wait = waitMin();
  if (wait) {
    const shadow = {
      countries, existing: new Set(existing), done: new Set(done),
      existingTopics: new Set(existingTopics), eventAnchors: [...eventAnchors], kind: 'event',
    };
    const asks = [];
    for (const c of active) {
      let n = 0;
      for (const item of lists.get(c.name)) {
        if (n >= EVENTS_PER_COUNTRY) break;
        const it = { ...item };
        const plan = planDiscovered(it, { ...shadow, country: c.name }, () => {});
        if (!plan) continue;
        n++;
        shadow.existing.add(plan.slug); shadow.done.add(plan.key); shadow.existingTopics.add(plan.tkey);
        if (plan.candKey) shadow.eventAnchors.push(plan.candKey);
        asks.push({ id: plan.slug, params: writerRequest({ title: plan.title, region: it.city, country: plan.country, category: plan.cat, facts: plan.facts }) });
      }
    }
    const promptOf = new Map(asks.map((a) => [a.id, a.params.messages[0].content]));
    for (const [id, msg] of await runBatch(client, asks, { waitMin: wait })) prewritten.set(id, { msg, prompt: promptOf.get(id) });
  }

  for (const c of active) {
    const ctx = { country: c.name, countries, existing, done, existingTopics, usedImages, eventAnchors, prewritten };
    let ev = 0, hs = 0;
    for (const item of lists.get(c.name)) {
      if (ev >= EVENTS_PER_COUNTRY) break;
      if (await attempt(`${c.name} event "${item?.name ?? '?'}"`, () => writeDiscovered(item, { ...ctx, kind: 'event' }), false)) { ev++; total++; }
    }
    const hotspots = HOTSPOTS_PER_COUNTRY > 0 ? await attempt(`${c.name} hotspot discovery`, () => discoverHotspots(c.name), []) : [];
    for (const item of hotspots) {
      if (hs >= HOTSPOTS_PER_COUNTRY) break;
      if (await attempt(`${c.name} hotspot "${item?.name ?? '?'}"`, () => writeDiscovered(item, { ...ctx, kind: 'hotspot' }), false)) { hs++; total++; }
    }
    console.log(`  ${c.flag} ${c.name}: ${ev} event(s), ${hs} hotspot(s)`);
  }

  await writeFile(PUBLISHED_FILE, JSON.stringify({ done: [...done] }, null, 2) + '\n', 'utf8');
  console.log(`\n📦  ${total} post(s) published.\n`);
  if (failures.length) {
    console.log(`⚠️  ${failures.length} item(s) failed and were skipped:\n${failures.map((f) => `   - ${f}`).join('\n')}\n`);
    if (!total) throw new Error(`every attempt failed (${failures.length}) — nothing published`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
