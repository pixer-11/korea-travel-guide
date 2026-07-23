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
import yaml from 'js-yaml';
import { slugify } from './lib/slugify.mjs';
import { writeArticle } from './lib/writer.mjs';
import { resolveHero, loadUsedImageUrls, eventTopic } from './lib/images.mjs';
import { isImageAllowed } from './lib/guardrails.mjs';

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
      max_tokens: 1600,
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
    `Respond with ONLY a JSON array (no prose, no code fence) of up to 4 items: ` +
    `[{"name":"...","city":"...","date":"human-readable e.g. August 1-9, 2026","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD (same as startDate if one day; last day if multi-day)","category":"event","summary":"1-2 factual sentences: what, where, when"}]. ` +
    `startDate/endDate MUST be valid ISO dates; omit them only if the exact date is genuinely unknown. If nothing notable, return [].`
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
  const { country, kind, existing, done } = ctx;
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

  const title = kind === 'event'
    ? `${item.name}: What to Know${item.city ? ` (${item.city})` : ''}`
    : `${item.name} in ${item.city}: A Visitor's Guide`;
  const facts = {
    name: item.name, city: item.city, date: item.date, country, summary: item.summary,
    guidance:
      kind === 'event'
        ? 'Time-sensitive event discovered via web search. Use the given facts, state the date as announced, and ALWAYS tell readers to confirm exact dates, venue, and tickets on the official source. Do not invent lineup, prices, or times.'
        : 'Recently-opened / trending spot discovered via web search. Use the given facts; describe what it is, where, and why it stands out. Tell readers to confirm hours and reservations before visiting. Do not invent a menu, prices, or exact hours you were not given.',
  };
  const { body, quickAnswer, faq } = await writeArticle({ title, region: item.city, country, category: cat, facts });
  if (!body || body.length < 300) return false;

  // Try the event/venue's own imagery first (a concert's performer photo is fine
  // for the ARTICLE hero) — the destination TILE already excludes events via
  // pickRepHeroUrl, so an artist shot never stands in for the place. Pass `used`
  // so no two posts share the same photo (id-level de-dupe), falling back to
  // city/country imagery only when nothing specific is found.
  const hero = await resolveHero({
    namedVenue: item.name,
    region: item.city,
    // Events: try the specific act/fighter (namedVenue) first, then fall back to
    // the event TYPE (MMA, racing, concert…) rather than the raw name, so a hero
    // is at least on-topic. Hotspots keep their venue name as the topic.
    topic: cat === 'event' ? eventTopic(item.name) : item.name,
    country,
    used: ctx.usedImages,
    preferTopic: cat === 'event',
    eventMode: cat === 'event',
  });
  const heroImage = isImageAllowed(hero)
    ? { url: hero.url, credit: hero.credit, license: hero.license, source: hero.source } : undefined;

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
    heroImage, gallery: [],
    tags: [item.city.toLowerCase(), kind === 'event' ? 'event' : 'new & trending'],
    quickAnswer, faq, aiGenerated: true, draft: false,
  };
  const src = kind === 'event'
    ? 'Editor-reviewed, AI-assisted, using current web sources. Event dates and tickets change — always confirm on the official site.'
    : 'Editor-reviewed, AI-assisted, using current web sources. Hours and details change — confirm before you go.';
  const disclosure = `> **How this guide was made:** ${src} See our [editorial policy](/about).\n\n`;
  await writeFile(join(POSTS_DIR, `${slug}.md`), frontmatter(data) + disclosure + body + '\n', 'utf8');
  existing.add(slug); done.add(key);
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
  // Site-wide set of hero images already in use (URL + photo-id) → no dupes.
  const usedImages = await loadUsedImageUrls(POSTS_DIR);

  console.log(`\n📡  Discovering events + hotspots — ${active.map((c) => c.name).join(', ')}\n`);
  let total = 0;

  for (const c of active) {
    const ctx = { country: c.name, existing, done, usedImages };
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
