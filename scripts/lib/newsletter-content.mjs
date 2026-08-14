import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { isOffTopicHero } from './offtopic.mjs';

const MAX_STORIES = 4;   // hero + up to 3 more cards
const MAX_EVENTS = 3;

export function loadPosts(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data } = matter(readFileSync(join(dir, f), 'utf8'));
      return { slug: f.replace(/\.md$/, ''), data };
    })
    .filter((p) => !p.data.draft);
}

export function audienceKey(regionSlug, lang) {
  return `${regionSlug || '__global__'}:${lang}`;
}

export function sentSetFor(log, key) {
  const rec = log[key] || {};
  return new Set([...(rec.posts || []), ...(rec.events || [])]);
}

const eq = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const byPubDesc = (a, b) => new Date(b.data.pubDate) - new Date(a.data.pubDate);

// Timing windows (subscriber-growth research 2026-08-14): the reason deal
// newsletters compound is perishable value — a reason to open THIS issue.
// Guides can't be perishable, but timing can: from the same climate normals
// the when-to-go tool renders, surface the countries ENTERING their easiest
// window next month. Comfort formula matches WhenToGoCountry.astro exactly —
// distance of the month's high from a mild 24°C plus its share of annual rain
// — so the email never contradicts the page it links to. "Entering" means
// next month ranks in the country's top-4 months AND improves on this month,
// which is what makes the list rotate through the year instead of repeating
// the same three mild countries.
export function pickTimingCountries({ factsPath, now, count = 3 }) {
  let facts;
  try { facts = JSON.parse(readFileSync(factsPath, 'utf8')).countries || {}; }
  catch { return []; }
  const thisM = now.getUTCMonth() + 1;
  const nextM = (thisM % 12) + 1;
  const out = [];
  for (const [country, f] of Object.entries(facts)) {
    const climate = f?.climate;
    if (!Array.isArray(climate) || climate.length !== 12) continue;
    const totalRain = Math.max(1, climate.reduce((s, c) => s + (c.rain || 0), 0));
    const comfort = (c) => Math.abs(c.hi - 24) + ((c.rain || 0) / totalRain) * 100;
    const ranked = [...climate].sort((a, b) => comfort(a) - comfort(b)).map((c) => c.m);
    const next = climate.find((c) => c.m === nextM);
    const cur = climate.find((c) => c.m === thisM);
    if (!next || !cur) continue;
    if (ranked.indexOf(nextM) < 4 && comfort(next) < comfort(cur)) {
      out.push({ country, score: comfort(next), hi: next.hi, lo: next.lo, rain: next.rain });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, count);
}

// Best-first hero source ranking (spec §4.3): a real self-hosted venue photo,
// then Google Places, then curated Unsplash/KTO, then a Wikimedia keyword-match
// fallback LAST — so a restaurant never shows a wikimedia landscape when any
// better-sourced photo exists. Ties break by newest.
function heroSourceRank(hero) {
  const url = (hero && hero.url) || '';
  const lic = (hero && hero.license) || '';
  if (url.includes('/venue-photos/')) return 0;
  if (lic === 'google-places') return 1;
  if (lic === 'unsplash' || lic === 'kto-open') return 2;
  if (lic === 'wikimedia') return 3;
  return 4;
}
const bySourceThenDate = (a, b) =>
  heroSourceRank(a.data.heroImage) - heroSourceRank(b.data.heroImage) || byPubDesc(a, b);

// What the article is about, for the off-topic guard: a blocked keyword that is
// the post's own subject is not a mismatch.
const subjectOf = (p) => [p.data.title, p.data.place?.name, p.data.region].filter(Boolean).join(' ');

function card(p) {
  return { slug: p.slug, title: p.data.title, category: p.data.category, image: p.data.heroImage, region: p.data.region, dek: p.data.description || '' };
}

// Selection for ONE single-region audience. Pure: takes an already-loaded posts
// array so it is fully unit-testable. `sent` is a Set of slugs to exclude.
export function pickSingleRegionEdition({ posts, region, country, sent, now, minStories = 3 }) {
  const usable = (p) =>
    p.data.category !== 'event' &&
    !sent.has(p.slug) &&
    !isOffTopicHero(p.data.heroImage, subjectOf(p));

  const inRegion = posts.filter((p) => usable(p) && eq(p.data.region, region)).sort(bySourceThenDate);
  let chosen = inRegion.slice(0, MAX_STORIES);

  // Country top-up when the region alone is thin.
  if (chosen.length < minStories) {
    const chosenSlugs = new Set(chosen.map((p) => p.slug));
    const inCountry = posts
      .filter((p) => usable(p) && !chosenSlugs.has(p.slug) && eq(p.data.country, country) && !eq(p.data.region, region))
      .sort(bySourceThenDate);
    chosen = chosen.concat(inCountry).slice(0, MAX_STORIES);
  }

  if (chosen.length === 0) return null; // no clean hero → skip this audience

  const events = posts
    .filter((p) =>
      p.data.category === 'event' &&
      !sent.has(p.slug) &&
      p.data.eventStartDate &&
      new Date(p.data.eventStartDate) >= now &&
      (eq(p.data.region, region) || eq(p.data.country, country)))
    .sort((a, b) => new Date(a.data.eventStartDate) - new Date(b.data.eventStartDate))
    .slice(0, MAX_EVENTS)
    .map((p) => ({ slug: p.slug, title: p.data.title, date: p.data.eventStartDate, region: p.data.region }));

  const [hero, ...stories] = chosen.map(card);
  return {
    hero,
    stories,
    events,
    country,
    usedPostSlugs: chosen.map((p) => p.slug),
    usedEventSlugs: events.map((e) => e.slug),
  };
}

export function pickGlobalEdition({ posts, sent, now, max = 5 }) {
  const clean = posts
    .filter((p) => p.data.category !== 'event' && !sent.has(p.slug) && !isOffTopicHero(p.data.heroImage, subjectOf(p)))
    .sort(bySourceThenDate)
    .slice(0, max)
    .map(card);
  if (clean.length === 0) return null;
  const events = posts
    .filter((p) => p.data.category === 'event' && !sent.has(p.slug) && p.data.eventStartDate && new Date(p.data.eventStartDate) >= now)
    .sort((a, b) => new Date(a.data.eventStartDate) - new Date(b.data.eventStartDate))
    .slice(0, MAX_EVENTS)
    .map((p) => ({ slug: p.slug, title: p.data.title, date: p.data.eventStartDate, region: p.data.region }));
  const [hero, ...stories] = clean;
  return { hero, stories, events, usedPostSlugs: clean.map((c) => c.slug), usedEventSlugs: events.map((e) => e.slug) };
}

export function pickMultiRegionEdition({ posts, regions, countryByRegion, sent, now, perRegion = 2 }) {
  const used = new Set();
  const sections = [];
  for (const region of regions) {
    const picks = posts
      .filter((p) => p.data.category !== 'event' && !sent.has(p.slug) && !used.has(p.slug)
        && !isOffTopicHero(p.data.heroImage, subjectOf(p)) && eq(p.data.region, region))
      .sort(bySourceThenDate).slice(0, perRegion).map(card);
    for (const c of picks) used.add(c.slug);
    if (picks.length) sections.push({ region, stories: picks });
  }
  if (sections.length === 0) return null;
  const countries = new Set(regions.map((r) => (countryByRegion[r] || '').toLowerCase()).filter(Boolean));
  const events = posts
    .filter((p) => p.data.category === 'event' && !sent.has(p.slug) && p.data.eventStartDate && new Date(p.data.eventStartDate) >= now
      && (regions.some((r) => eq(p.data.region, r)) || countries.has(String(p.data.country).toLowerCase())))
    .sort((a, b) => new Date(a.data.eventStartDate) - new Date(b.data.eventStartDate))
    .slice(0, MAX_EVENTS)
    .map((p) => ({ slug: p.slug, title: p.data.title, date: p.data.eventStartDate, region: p.data.region }));
  const usedPostSlugs = [...used];
  return { sections, events, usedPostSlugs, usedEventSlugs: events.map((e) => e.slug) };
}
