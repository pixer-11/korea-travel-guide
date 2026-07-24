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

function card(p) {
  return { slug: p.slug, title: p.data.title, category: p.data.category, image: p.data.heroImage, region: p.data.region };
}

// Selection for ONE single-region audience. Pure: takes an already-loaded posts
// array so it is fully unit-testable. `sent` is a Set of slugs to exclude.
export function pickSingleRegionEdition({ posts, region, country, sent, now, minStories = 3 }) {
  const usable = (p) =>
    p.data.category !== 'event' &&
    !sent.has(p.slug) &&
    !isOffTopicHero(p.data.heroImage);

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
