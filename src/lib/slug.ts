// Shared URL-slug helper for region hubs: a region's route param, every in-site
// link to it, its 301 redirect and its sitemap lastmod key all have to resolve
// to the same path. Previously region URLs used raw `region.toLowerCase()`,
// which left spaces as %20 on 32 of 125 region pages (e.g. /regions/abu%20dhabi/).
//
// This used to be a fourth hand-kept copy of the same six lines, told by comment
// to "stay in sync" with astro.config.mjs, scripts/lib/slugify.mjs and (silently)
// src/lib/hub-lastmod.mjs. One of those four had drifted — hub-lastmod's copy
// only lowercased and dashed spaces, so three regions' sitemap freshness went to
// a URL that does not exist. There is now one definition; this is the typed door
// to it, kept so callers still get `(input: string) => string` under strict TS
// rather than the `any` a bare re-export of a .mjs would infer.
import { slugify } from '../../scripts/lib/slugify.mjs';

export function slugifyRegion(input: string): string {
  return slugify(input);
}
