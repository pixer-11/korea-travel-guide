// Shared URL-slug helper for region hubs. MUST stay in sync with the copy in
// astro.config.mjs (which generates the 301 _redirects for old %20 paths) and
// with scripts/lib/slugify.mjs (post-id slugs) — identical logic so a region's
// route param, every in-site link to it, and its redirect all resolve to the
// same path. Previously region URLs used raw `region.toLowerCase()`, which left
// spaces as %20 on 32 of 125 region pages (e.g. /regions/abu%20dhabi/).
export function slugifyRegion(input: string): string {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
