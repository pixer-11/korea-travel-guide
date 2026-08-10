// Pick the most IDENTITY-REVEALING hero for a city/country tile.
// A place tile should show the place itself — a landmark, skyline or scenery —
// not a close-up of food and NEVER an event's artist/concert shot. So we rank
// candidate posts by category (attractions first, food last) and EXCLUDE events
// entirely: a concert hero is a photo of the performer (e.g. a K-pop group), which
// says nothing about the destination. A city with only event guides gets no tile
// image (empty), which is better than a musician standing in for the place.
const CAT_RANK: Record<string, number> = {
  attraction: 0, // palaces, temples, parks, viewpoints, nature — best for place identity
  'hidden-gem': 1,
  trendy: 2, // cafés — often interiors/coffee
  restaurant: 3, // food close-ups — last resort
};

type HeroPost = { data: { category: string; heroImage?: { url?: string } } };

export function pickRepHeroUrl(posts: HeroPost[]): string {
  const withHero = posts.filter(
    (p) =>
      p.data.category !== 'event' &&
      p.data.heroImage?.url &&
      !p.data.heroImage.url.includes('placeholder')
  );
  if (!withHero.length) {
    // Event-only cities (Manila's guides today are all concerts) used to render
    // a BLANK tile here, on the theory that a musician's photo says nothing
    // about the place. The owner saw the Philippines hub and ruled the other
    // way — a dark empty box says even less. Last resort only: the moment the
    // city gets one real venue guide, that photo takes over.
    const eventHero = posts.find(
      (p) => p.data.heroImage?.url && !p.data.heroImage.url.includes('placeholder')
    );
    return eventHero ? eventHero.data.heroImage!.url! : '';
  }
  return pickRank(withHero);
}

// Regions whose only guides are PHOTOLESS events (Arlington's one post is a
// BTS date with no hero) still rendered dark empty tiles. This table carries a
// verified CITY photo per such region — backfill-region-covers.mjs fills it
// from Wikimedia with the identity rules of the photo pipeline. A real post
// hero always wins; the cover is a last-resort fallback only.
// readFileSync, not a JSON import: this file is checked as plain TS (no Vite),
// where a .json import needs resolveJsonModule and failed astro check.
import { readFileSync } from 'node:fs';
const regionCovers: Record<string, { url?: string }> = (() => {
  try { return JSON.parse(readFileSync(new URL('../../data/region-covers.json', import.meta.url), 'utf8')); }
  catch { return {}; }
})();
export function regionCoverUrl(region: string): string {
  return regionCovers[region]?.url ?? '';
}

function pickRank(withHero: HeroPost[]): string {
  // Stable sort by category rank — ties keep the caller's order (usually newest first).
  withHero.sort((a, b) => (CAT_RANK[a.data.category] ?? 5) - (CAT_RANK[b.data.category] ?? 5));
  // Returns the RAW stored URL. For one day this returned tileSize(url), and
  // two callers — DestinationHub and RegionsIndex — hashed the return value to
  // derive their /wall/ thumbnail name. Hashing the transformed string produced
  // file names that exist nowhere, and every city tile on the country pages
  // went dark. A picker must not transform; the consumer that wants a
  // thumbnail calls tileSize() itself, exactly once.
  return withHero[0].data.heroImage!.url!;
}

// These URLs become CSS background-image on ~156px-wide tiles, which can take
// neither srcset nor lazy-loading — so whatever size this returns is downloaded
// in full, immediately, for every tile. As stored they are 1920px originals:
// 17 tiles made the homepage a 12.6MB page that took 62 seconds on slow 4G.
//
// First choice is our own /wall/ thumbnail: build-wall.mjs already renders every
// hero as a 640px WebP (15–90KB) named sha1(heroUrl), so the tile can be served
// from our domain — no Wikimedia hotlink, no missing Cache-Control, no 12MB.
// The hash must be computed on the STORED url, exactly as build-wall saw it.
// Posts newer than the last wall build fall back to a downsized remote render;
// 960 is on Wikimedia's fixed ladder of served widths (see src/lib/wikimediaThumb.mjs).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { wikimediaThumb } from './wikimediaThumb.mjs';

const WALL_DIR = join(process.cwd(), 'public', 'wall');

export function tileSize(url: string): string {
  const name = `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.webp`;
  if (existsSync(join(WALL_DIR, name))) return `/wall/${name}`;
  // 960 is on Wikimedia's served ladder, so this one was legal by luck. Routed
  // through the helper anyway: an off-ladder width here would blank every tile
  // the same way an off-ladder hero blanked every article on 2026-08-10.
  return wikimediaThumb(url, 960)
    .replace(/(fastly\.4sqi\.net\/img\/general\/)original\//, '$1width960/');
}
