// Single source of truth for post titles. Imported by BOTH generate.mjs (new
// posts) and backfill-titles.mjs (existing posts) so a rule change can never
// leave the two out of sync (as happened once with the meta-description clip()).
// Event titles are NOT built here — they come from discover-events.mjs.

import { strongRating } from './serp.mjs';

function cap(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

// Tidy a raw Google place name for use in a title (drop marketing suffixes and
// the local-script half of a bilingual name). Unicode ranges written as escapes
// so this file stays pure-ASCII:  -ɏ = Latin through Latin-Extended-B,
// Ḁ-ỿ = Latin Extended-Additional (preserves Vietnamese diacritics).
export function cleanVenueName(name) {
  let s = String(name)
    .replace(/\s*[-–—]\s*michelin[^,]*$/i, '') // "- Michelin Selected 2025-2026"
    .replace(/\s*\((?:michelin|selected)[^)]*\)\s*$/i, '')
    .trim();
  // Some Google names are keyword stuffing joined by " / "
  // ("sugyeongsa / gyeongju restaurant / gyeongju vegan / …"). Keep the first.
  if (s.includes(' / ')) s = s.split(' / ')[0].trim();
  const latin = s.replace(/[^ -ɏḀ-ỿ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[A-Za-z].*[A-Za-z]/.test(latin)) s = latin;
  // Tidy separators left dangling after stripping a bilingual half.
  s = s
    .replace(/\s*[|/·–—-]+\s*$/g, '')
    .replace(/^\s*[|/·–—-]+\s*/g, '')
    .trim();
  return s;
}

// Venue-first, ~45 chars where possible (so BaseLayout can append the brand
// within its 60-char budget). Drops the old "A Visitor's Guide" marketing filler
// and removes a trailing city echo so a name that already ends in the city
// ("Flavors Grill Abu Dhabi") doesn't repeat it in the suffix.
// `place` is optional: when it carries a strong real Google rating
// (strongRating in lib/serp.mjs — NEVER an invented number), a compact
// star badge "(4.9★)" is appended for review-intent SERP CTR, but only if
// the whole title still fits Google's ~60-char display. A long venue name is
// never truncated to make room — those titles simply skip the badge.
export function makeTitle(name, target, place) {
  const region = target.region;
  let base = cleanVenueName(name);
  const reg = region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const deEchoed = base.replace(new RegExp(`[\\s,\\-–—]+${reg}$`, 'i'), '').trim();
  // Only de-echo when what's left still stands on its own. Stripping the city from
  // "Classical Gardens of Suzhou" / "CQ @ Clarke Quay" / "Vieux Lyon" left a
  // dangling connector — "Classical Gardens of: Suzhou Travel Guide" — or a
  // meaningless fragment. Those names need the city to make sense.
  const danglesConnector = /\b(of|the|de|du|des|at|in|on|and|for|à|a|el|la|le|les)$|[&@+\-–—/]$/i.test(deEchoed);
  if (deEchoed.length >= 5 && !danglesConnector) base = deEchoed;
  // If the venue name itself contains the city ("Tokyo Tower"), don't repeat it in
  // the suffix — "Tokyo Tower: Travel Guide", not "…: Tokyo Travel Guide".
  const baseHasRegion = new RegExp(`\\b${reg}\\b`, 'i').test(base);
  const suffix =
    target.category === 'restaurant'
      ? (baseHasRegion ? 'Where to Eat' : `Where to Eat in ${region}`)
      : (baseHasRegion ? 'Travel Guide' : `${region} Travel Guide`);
  const title = `${base}: ${suffix}`;
  const sr = strongRating(place);
  if (sr) {
    const badged = `${title} (${sr.rating.toFixed(1)}★)`;
    if (badged.length <= 60) return badged;
  }
  return title;
}

export function makePlacelessTitle(target) {
  const t = cap(target.topic);
  const reg = target.region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // If the topic already names the city ("Suncheon Bay"), don't append " in City".
  return new RegExp(`\\b${reg}\\b`, 'i').test(t) ? t : `${t} in ${target.region}`;
}
