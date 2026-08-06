import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Which photo a page that has no image of its own should share.
//
// Google Discover only serves the large card when og:image is ≥1200px wide.
// Posts have carried that invariant since 2026-08-02 (og:image = the ORIGINAL
// hero, never the 640px wall thumb), but every page that PICKS an image from
// among its children just took the first child with a hero — so one 1024px
// photo disqualified the home page and ten hubs at once, and a 958px one took
// fifteen more (found 2026-08-06).
//
// Widths come from data/hero-width-queue.json, which the nightly scan fills by
// probing each hero's true pixel width. Unknown is NOT treated as narrow: a
// brand-new post has no probe yet, and dropping it would leave a hub sharing
// the brand default instead of a real photograph.

const SEP = String.fromCharCode(1); // the queue's slug␁url key separator
const MIN_WIDTH = 1200;

// Read, not `import … with { type: 'json' }`: the attribute syntax works in the
// Astro build but Node's own test runner rejects the bare import, and a module
// the tests cannot load is a module with no tests. Resolved relative to THIS
// file so it does not depend on the working directory.
function loadProbes() {
  try {
    const path = fileURLToPath(new URL('../../data/hero-width-queue.json', import.meta.url));
    return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')).probes ?? {}));
  } catch {
    // No queue file yet (fresh clone, partial checkout): every width is unknown,
    // which degrades to the previous "first hero wins" behaviour.
    return new Map();
  }
}
const PROBES = loadProbes();

/** Probed width of a post's hero, or null when it has never been measured. */
export function heroWidth(post) {
  const url = post?.data?.heroImage?.url;
  if (!url) return null;
  const w = PROBES.get(`${post.id}${SEP}${url}`);
  return typeof w === 'number' ? w : null;
}

/**
 * The share image for a hub, in preference order:
 *   1. a hero PROVEN ≥1200px wide
 *   2. a hero of unknown width (the old behaviour — better than no photo)
 *   3. nothing, so BaseLayout falls back to the 1200×630 brand default
 * Never returns a hero that is known to be too narrow.
 */
export function pickOgPhoto(posts) {
  const withHero = (posts ?? []).filter((p) => p?.data?.heroImage?.url);
  const wide = withHero.find((p) => (heroWidth(p) ?? 0) >= MIN_WIDTH);
  if (wide) return wide.data.heroImage.url;
  const unmeasured = withHero.find((p) => heroWidth(p) === null);
  return unmeasured?.data.heroImage.url;
}

/** True unless the hero has been measured and found below the floor. */
export function heroIsWideEnough(post) {
  const w = heroWidth(post);
  return w === null || w >= MIN_WIDTH;
}
