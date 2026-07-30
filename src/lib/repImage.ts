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
  if (!withHero.length) return '';
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
// 960 is the smallest width Wikimedia reliably serves (below that, HTTP 400).
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const WALL_DIR = join(process.cwd(), 'public', 'wall');

export function tileSize(url: string): string {
  const name = `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.webp`;
  if (existsSync(join(WALL_DIR, name))) return `/wall/${name}`;
  return url
    .replace(/\/(\d{3,4})px-/, (m, w) => (Number(w) > 960 ? '/960px-' : m))
    .replace(/(fastly\.4sqi\.net\/img\/general\/)original\//, '$1width960/');
}
