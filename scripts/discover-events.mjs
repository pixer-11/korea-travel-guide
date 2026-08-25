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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { makeTitle } from './lib/titles.mjs';
import matter from 'gray-matter';
import { topicKey } from './lib/topic-key.mjs';
import { keyToken, tokens as nameTokens, ANCHOR_STOP } from './lib/commons.mjs';
import { eventSchemaName } from '../src/lib/eventName.mjs';
import { normalizeOffer, normalizePerformer } from '../src/lib/eventOffers.mjs';
import yaml from 'js-yaml';
import { slugify } from './lib/slugify.mjs';
import { writeArticle } from './lib/writer.mjs';
import { resolveHero, loadUsedImageUrls, eventTopic } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';
import { verifyHeroImage, recordHeroVerdict } from './lib/vision-check.mjs';
import { foreignInFilename, geoTokens } from './lib/event-file-identity.mjs';
import { loadWorld } from './lib/commons-identity.mjs';

// Place-name tokens for the filename identity audit (a past host city in a
// file name is WHERE an edition was held, not another act).
const WORLD_GEO = geoTokens(await loadWorld().catch(() => null));

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const POSTS_DIR = join(ROOT, 'src', 'content', 'posts');
const COUNTRIES_FILE = join(ROOT, 'data', 'countries.json');
const PUBLISHED_FILE = join(ROOT, 'data', 'published.json');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.WRITER_MODEL || 'claude-sonnet-5';
const EVENTS_PER_COUNTRY = Number(process.env.EVENTS_PER_COUNTRY ?? 2);
const HOTSPOTS_PER_COUNTRY = Number(process.env.HOTSPOTS_PER_COUNTRY ?? 2);

async function searchJson(prompt) {
  let msg;
  try {
    msg = await client.messages.create({
      model: MODEL,
      // Raised from 1600 on 2026-08-25: the prompt now also asks for ticket
      // page, free/paid and performer, and a truncated reply loses the whole
      // discovery batch, not one field.
      max_tokens: 2200,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    console.log(`  ⚠️  search failed: ${e.message}`);
    return [];
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  const jsonStr = text.replace(/^[\s\S]*?(\[)/, '$1').replace(/```/g, '').trim();
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr.slice(0, 4) : []; }
  catch { return []; }
}

const discoverEvents = (country) =>
  searchJson(
    `Search the web for NOTABLE, currently-UPCOMING events in ${country} over the next ~8 weeks that would draw international visitors: ` +
    `big concerts or tours by globally famous artists, major sports events (World Cup, Olympics, Grand Prix, major finals), large festivals, or major special exhibitions. ` +
    `Only REAL, CONFIRMED, upcoming events with a known date and city. ` +
    // The Bangkok F4 lesson (2026-08-07): the official branding was "F✦FOREVER
    // 1st World Tour" but every live search query said "f4 concert bangkok" —
    // the page ranked 4-6 with 0 clicks because the searched-for name appeared
    // nowhere in the title. Ask for the searched-for name up front.
    `"name" must be the name people actually SEARCH for: include the widely-used short form or act name when one exists (e.g. "F4 (Meteor Garden) Reunion World Tour", not only the official branding "F✦FOREVER 1st World Tour"). ` +
    `Respond with ONLY a JSON array (no prose, no code fence) of up to 4 items: ` +
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

async function writeDiscovered(item, ctx) {
  const { country, kind, existing, done, existingTopics, eventAnchors } = ctx;
  if (!item?.name || !item?.city) return false;
  // Multi-stage events can come back with a messy "city" like
  // "Nice (finish) / various French stages". A "/" there becomes the post's
  // region and breaks the /regions/[region] route on a clean build, so reduce it
  // to the primary city (drop anything after a "/", "(", ";" or ",").
  item.city = String(item.city).split(/\s*[/(;]/)[0].split(',')[0].trim() || item.city;
  const cat = kind === 'event' ? 'event'
    : ['restaurant', 'trendy', 'hidden-gem'].includes(item.category) ? item.category : 'trendy';
  const key = `${kind}:${slugify(`${country}-${item.name}`)}`;
  const slug = slugify(`${item.city}-${item.name}`);
  if (done.has(key) || existing.has(slug)) return false;

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
  if (existingTopics.has(tkey)) return false;
  // Duplicate coverage, decided BEFORE any spend (writer + hero + vision + four
  // translations went to five rephrased twins on 2026-08-20). Same event =
  // same country, overlapping dates, and either the same anchor word, shared
  // name tokens, or a same-city pair where one title is all generic words —
  // "Formula 1 Italian Grand Prix" has NO distinctive token (every word is an
  // anchor stop-word), which is exactly how the Monza twin slipped both the
  // topicKey equality here and validate's anchor rule.
  if (kind === 'event' && eventAnchors) {
    const schemaName = eventSchemaName(title);
    const a = keyToken(schemaName, `${item.city} ${country}`) || '';
    const toks = new Set(nameTokens(schemaName).filter((t) => !ANCHOR_STOP.has(t) && !/^(19|20)\d{2}$/.test(t)));
    const s0 = isIsoDate(item.startDate) ? item.startDate : '';
    const e0 = isIsoDate(item.endDate) ? item.endDate : s0;
    const near = (x, y) => x && y && Math.abs(new Date(x) - new Date(y)) <= 3 * 864e5;
    const overlap = (ev) => {
      if (!s0 || !ev.start) return true; // no dates to compare — same name+place is enough
      return near(s0, ev.start) || (s0 <= (ev.end || ev.start) && ev.start <= e0);
    };
    const twin = eventAnchors.find((ev) => {
      if (ev.country !== country || !overlap(ev)) return false;
      if (a && ev.anchor && a === ev.anchor) return true;
      const shared = [...toks].some((t) => ev.toks.has(t));
      if (shared) return ev.region === String(item.city).toLowerCase();
      // generic-title side (no distinctive tokens at all): same city + dates
      if ((!toks.size || !ev.toks.size) && ev.region === String(item.city).toLowerCase()) return true;
      return false;
    });
    if (twin) {
      console.log(`    ↩︎  "${item.name}" — already covered (${twin.anchor || 'same city+dates'}); skipping before generation`);
      return false;
    }
  }
  const facts = {
    name: item.name, city: item.city, date: item.date, country, summary: item.summary,
    guidance:
      kind === 'event'
        ? 'Time-sensitive event discovered via web search. Use the given facts, state the date as announced, and tell readers to confirm exact dates, venue, and tickets on the official source — phrased TIMELESSLY, as a standing instruction ("Confirm timing and tickets on the official site"), never as a date-relative promise. The page stays online after the event, so NEVER write "closer to the date/event", "will be announced/confirmed", "have not been confirmed yet", "tickets go on sale", "lineup has yet to", or "once released". Do not invent lineup, prices, or times.'
        : 'Recently-opened / trending spot discovered via web search. Use the given facts; describe what it is, where, and why it stands out. Tell readers to confirm hours and reservations before visiting. Do not invent a menu, prices, or exact hours you were not given.',
  };
  const { body, quickAnswer, faq } = await writeArticle({ title, region: item.city, country, category: cat, facts });
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
  for (let turn = 0; turn < (cat === 'event' ? 8 : 1); turn++) {
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
      const foreign = foreignInFilename(pick.url, { known: knownTok, anchor, via: pick.via, geo: WORLD_GEO });
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
    const vis = await verifyHeroImage({
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
    }
  }

  const data = {
    title,
    description: kind === 'event'
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
  if (kind === 'event' && eventAnchors) {
    const schemaName = eventSchemaName(title);
    eventAnchors.push({
      country, region: String(item.city).toLowerCase(),
      anchor: keyToken(schemaName, `${item.city} ${country}`) || '',
      toks: new Set(nameTokens(schemaName).filter((t) => !ANCHOR_STOP.has(t) && !/^(19|20)\d{2}$/.test(t))),
      start: isIsoDate(item.startDate) ? item.startDate : '',
      end: isIsoDate(item.endDate) ? item.endDate : (isIsoDate(item.startDate) ? item.startDate : ''),
    });
  }
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
      const schemaName = eventSchemaName(data.title);
      eventAnchors.push({
        country: data.country, region: String(data.region || '').toLowerCase(),
        anchor: keyToken(schemaName, `${data.region || ''} ${data.country || ''}`) || '',
        toks: new Set(nameTokens(schemaName).filter((t) => !ANCHOR_STOP.has(t) && !/^(19|20)\d{2}$/.test(t))),
        start: data.eventStartDate ? String(data.eventStartDate).slice(0, 10) : '',
        end: data.eventEndDate ? String(data.eventEndDate).slice(0, 10) : '',
      });
    } catch {}
  }
  // Site-wide set of hero images already in use (URL + photo-id) → no dupes.
  const usedImages = await loadUsedImageUrls(POSTS_DIR);

  console.log(`\n📡  Discovering events + hotspots — ${active.map((c) => c.name).join(', ')}\n`);
  let total = 0;

  for (const c of active) {
    const ctx = { country: c.name, existing, done, existingTopics, usedImages, eventAnchors };
    let ev = 0, hs = 0;
    for (const item of await discoverEvents(c.name)) {
      if (ev >= EVENTS_PER_COUNTRY) break;
      if (await writeDiscovered(item, { ...ctx, kind: 'event' })) { ev++; total++; }
    }
    for (const item of await discoverHotspots(c.name)) {
      if (hs >= HOTSPOTS_PER_COUNTRY) break;
      if (await writeDiscovered(item, { ...ctx, kind: 'hotspot' })) { hs++; total++; }
    }
    console.log(`  ${c.flag} ${c.name}: ${ev} event(s), ${hs} hotspot(s)`);
  }

  await writeFile(PUBLISHED_FILE, JSON.stringify({ done: [...done] }, null, 2) + '\n', 'utf8');
  console.log(`\n📦  ${total} post(s) published.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
