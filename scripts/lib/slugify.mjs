// Turns "Gwangjang Market, Seoul!" into "gwangjang-market-seoul".
//
// THE site's slug. Post ids, region route params, the %20 redirects in
// astro.config.mjs and the sitemap's hub lastmod keys all come from here.
// It lived as four hand-copied identical bodies until 2026-09-07, when one of
// them turned out not to be identical: hub-lastmod.mjs only lowercased and
// dashed spaces, so Alcañiz/Buñol/Xi'an were dated at /regions/alcañiz and the
// real pages got no freshness signal. Add a caller, don't add a copy.
/** @param {string} input */
export function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
