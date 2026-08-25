// ─────────────────────────────────────────────────────────────
//  SITEMAP SPLIT — one file of 10,454 URLs is not a diagnostic.
//
//  @astrojs/sitemap writes everything into dist/sitemap-0.xml (its entryLimit
//  is 45,000). Search Console reports coverage PER SITEMAP, so a single file
//  can only ever answer "some of the site is not indexed" — which we already
//  knew. Split by language and page type and the same screen answers the
//  question that matters: WHICH type, and WHICH language, is not getting in.
//  That is the whole reason for this pass; nothing about the URLs changes.
//
//  sitemap-0.xml is deliberately left on disk. Bing was given that exact URL
//  as a direct child submission on 2026-08-25 (the sitemap INDEX had been
//  accepted while zero children were read — see the bing-sitemap memory), and
//  deleting the file would turn that submission into a 404. It simply stops
//  being referenced by the index, so Google's coverage view is clean.
// ─────────────────────────────────────────────────────────────

const LANGS = ['ko', 'ja', 'es', 'zh'];

/** Page type from the language-stripped path. Order matters: first match wins. */
export function pageType(path) {
  if (path.startsWith('/posts/')) return 'posts';
  if (path === '/events' || path.startsWith('/events/')) return 'events';
  if (path.startsWith('/tools/when-to-go')) return 'when-to-go';
  if (path.startsWith('/tools/')) return 'tools';
  if (path.startsWith('/itinerary')) return 'itineraries';
  if (/^\/(destinations|regions|continents|essentials|day-trips|topics|roundups)/.test(path)) return 'hubs';
  return 'pages';
}

/** { lang, type } for one <loc>. */
export function classify(loc) {
  let path;
  try { path = new URL(loc).pathname; } catch { path = loc; }
  path = path.replace(/\/$/, '') || '/';
  const m = path.match(/^\/(ko|ja|es|zh)(?=\/|$)/);
  const lang = m ? m[1] : 'en';
  const rest = m ? path.slice(m[0].length) || '/' : path;
  return { lang, type: pageType(rest) };
}

/** Group raw <url>…</url> blocks into { 'en-posts': [block, …], … }. */
export function groupUrls(xml) {
  const groups = new Map();
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) continue;
    const { lang, type } = classify(loc);
    const key = `${lang}-${type}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  }
  return groups;
}

/** Newest <lastmod> in a set of blocks, or null when none carry one. */
export function newestLastmod(blocks) {
  let best = null;
  for (const b of blocks) {
    const d = b.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
    if (d && (!best || d > best)) best = d;
  }
  return best;
}

export function renderSitemap(blocks) {
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + blocks.join('')
    + '</urlset>';
}

export function renderIndex(files, siteBase) {
  const base = siteBase.replace(/\/$/, '');
  const entries = files.map(({ name, lastmod }) =>
    `<sitemap><loc>${base}/${name}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + entries
    + '</sitemapindex>';
}

export const SPLIT_LANGS = ['en', ...LANGS];
