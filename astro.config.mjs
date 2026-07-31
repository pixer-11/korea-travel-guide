// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';


// IMPORTANT: change this to your real domain before deploying.
// It is used for canonical URLs, sitemap, and Open Graph tags.
const SITE = process.env.SITE_URL || 'https://wanderatlasguides.com';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Build a pathname → last-modified date map from content frontmatter, so the
// sitemap can advertise REAL freshness (updatedDate ?? pubDate ?? lastReviewed).
// Only pages with a genuine content date get a <lastmod>; hubs/index pages are
// left blank on purpose rather than stamped with the daily build time, which
// would look manipulative to search engines and dilute the freshness signal.
function contentLastmod() {
  const map = new Map();
  const grab = (dir, toPath) => {
    let files = [];
    try { files = readdirSync(dir); } catch { return; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      let fm = '';
      try { fm = readFileSync(join(dir, f), 'utf8').split('---')[1] || ''; } catch { continue; }
      const pick = (k) => new RegExp(`(?:^|\\n)${k}:\\s*['"]?(\\d{4}-\\d{2}-\\d{2})`).exec(fm)?.[1];
      const date = pick('updatedDate') || pick('pubDate') || pick('lastReviewed');
      if (date) map.set(toPath(f.replace(/\.md$/, '')), date);
    }
  };
  // Post + essentials routes both use the filename slug as the URL segment
  // (posts: params.slug = post.id; essentials: params.country = entry.id).
  grab(join(__dirname, 'src/content/posts'), (slug) => `/posts/${slug}`);
  grab(join(__dirname, 'src/content/essentials'), (slug) => `/essentials/${slug}`);
  return map;
}

// Slugs the site itself marks noindex, so the sitemap never contradicts the page.
// Past events go noindex and drop out of every listing the moment their end date
// passes, but were still being submitted — Search Console flags each one.
function noindexSlugs() {
  const out = new Set();
  const today = new Date().toISOString().slice(0, 10);
  try {
    const dir = join(__dirname, 'src/content/posts');
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const raw = readFileSync(join(dir, f), 'utf8');
      const fm = raw.slice(4, raw.indexOf(String.fromCharCode(10) + '---', 3));
      const val = (k) => {
        const line = fm.split(String.fromCharCode(10)).find((l) => l.trimStart().startsWith(k + ':'));
        return line ? line.trimStart().slice(k.length + 1).trim().replace(/^["']|["']$/g, '') : '';
      };
      if (val('category') !== 'event') continue;
      const end = (val('eventEndDate') || val('eventStartDate')).slice(0, 10);
      if (end && end < today) out.add('/posts/' + f.replace(/.md$/, ''));
    }
  } catch { /* partial checkout */ }
  return out;
}
const NOINDEX_SLUGS = noindexSlugs();

const LASTMOD = contentLastmod();

// Freshness for pages that aren't a file: region, country, continent, roundup,
// events and when-to-go hubs. Each takes the newest date among the posts it
// covers, which is what "when did this page last change" actually means for a
// listing.
function hubLastmod() {
  const map = new Map();
  const bump = (path, date) => {
    if (!date) return;
    const prev = map.get(path);
    if (!prev || date > prev) map.set(path, date);
  };
  const slugify = (s) => String(s).toLowerCase().trim().replace(/\s+/g, '-');
  try {
    const dir = join(__dirname, 'src/content/posts');
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const raw = readFileSync(join(dir, f), 'utf8');
      const fm = raw.slice(4, raw.indexOf(String.fromCharCode(10) + "---", 3));
      if (/^draft:\s*true/m.test(fm)) continue;
      const val = (k) => {
        const line = fm.split('\n').find((l) => l.trimStart().startsWith(k + ':'));
        if (!line) return '';
        return line.trimStart().slice(k.length + 1).trim().replace(/^["']|["']$/g, '');
      };
      const date = (val('updatedDate') || val('pubDate') || '').slice(0, 10);
      if (!date) continue;
      const region = val('region');
      const country = val('country') || 'South Korea';
      const countrySlug = slugify(country);
      if (region) {
        const r = slugify(region);
        bump(`/regions/${r}`, date);
        for (const k of ['things-to-do', 'best-restaurants', 'cafes', 'hidden-gems']) {
          bump(`/regions/${r}/${k}`, date);
        }
      }
      bump(`/destinations/${countrySlug}`, date);
      bump(`/essentials/${countrySlug}`, date);
      bump(`/events/${countrySlug}`, date);
      for (const m of ['january','february','march','april','may','june','july','august','september','october','november','december']) {
        bump(`/tools/when-to-go/${countrySlug}/${m}`, date);
      }
      bump('/destinations', date);
      bump('/regions', date);
      bump('/tools/when-to-go', date);
      bump('/', date);
    }
  } catch { /* a partial checkout just means no hub dates */ }
  return map;
}
const HUB_LASTMOD = hubLastmod();

// Region URLs switched from raw `region.toLowerCase()` (spaces left as %20 on 32
// of 125 pages, e.g. /regions/abu%20dhabi/) to a proper slug. Emit 301s from the
// old encoded paths so any already-indexed %20 URL passes its equity to the new
// clean path instead of 404ing. Keep this slugify identical to src/lib/slug.ts.
function regionSlug(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
function regionRedirects() {
  const dir = join(__dirname, 'src/content/posts');
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  const regions = new Set();
  // Region hubs are built from LIVE posts only. A redirect may only point at a
  // region that still has one — Gardena's single post was quarantined, its hub
  // was therefore never built, and the "rescue" 301 delivered visitors to a
  // 404 in five languages.
  const liveRegions = new Set();
  const drafts = []; // quarantined posts — temporarily unpublished, not deleted
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    let fm = '';
    try { fm = readFileSync(join(dir, f), 'utf8').split('---')[1] || ''; } catch { continue; }
    // Capture the whole line, then strip wrapping quotes. The old character
    // class [^'"\n] stopped at the FIRST quote of any kind, so `region: Xi'an`
    // was read as "Xi" — the live hub check then couldn't see Xi'an existed,
    // and a quarantined Xian post fell back to the homepage instead of its hub.
    const m = /(?:^|\n)region:\s*(.+)/.exec(fm);
    const r = m?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (r && !r.includes('/')) regions.add(r);
    if (/(?:^|\n)draft:\s*true/.test(fm)) drafts.push({ slug: f.replace(/\.md$/, ''), region: r || '' });
    else if (r && !r.includes('/')) liveRegions.add(r);
  }
  const lines = [];
  // Host normalization (www -> apex) deliberately does NOT live here. This
  // project deploys as a WORKER with static assets, and absolute-URL sources in
  // _redirects are a Pages-only feature — the deploy validator refused the file
  // and every build after this line landed failed, freezing the site at the
  // morning's version while the day's fixes piled up unpublished. The www 301
  // belongs in a Cloudflare dashboard Redirect Rule, set once by the owner.
  // Quarantined (draft:true) posts render no page, which would 404 any visitor
  // holding the old link — the user hit exactly that on the Manseok post. Send
  // them to the region hub instead; the moment the post is un-drafted the page
  // is back and this 301 is no longer generated.
  // Region NAME normalizations: old region pages 301 to the canonical city so
  // an indexed URL keeps its equity. Defined before the drafts loop because the
  // drafts loop must apply it too — a quarantined Xian post used to redirect to
  // /regions/xian/, a spelling whose hub never existed.
  const alias = {
    'new-york-city': 'new-york',
    'metro-manila': 'manila',
    'pasay-city': 'manila',
    'quezon-city': 'manila',
    xian: 'xi-an',
  };
  const canon = (name) => {
    const raw = regionSlug(name);
    return alias[raw] ?? raw;
  };
  // Region hubs are built from LIVE posts only, so a redirect may only point at
  // one that still has a live post: Gardena's single post was quarantined, its
  // hub was therefore never built, and the "rescue" 301 delivered visitors to a
  // 404 in five languages. No live hub → fall back to the homepage, a poor
  // landing but an existing one.
  const liveHubs = new Set([...liveRegions].map(canon));
  for (const d of drafts) {
    const reg = canon(d.region);
    for (const p of ['', '/ko', '/ja', '/es', '/zh']) {
      lines.push(`${p}/posts/${d.slug}/ ${reg && liveHubs.has(reg) ? `${p}/regions/${reg}/` : (p || '/')} 301`);
    }
  }
  for (const r of regions) {
    const oldEnc = encodeURI(r.toLowerCase()); // what the old href resolved to
    const next = regionSlug(r);
    if (oldEnc !== next) lines.push(`/regions/${oldEnc}/ /regions/${next}/ 301`);
  }
  // The alias lines used to exist only for the English path, so
  // /ko/regions/xian/ (reachable from redirected localized post URLs) 404ed.
  for (const [from, to] of Object.entries(alias)) {
    for (const p of ['', '/ko', '/ja', '/es', '/zh']) lines.push(`${p}/regions/${from}/ ${p}/regions/${to}/ 301`);
  }
  // Deleted duplicate event post → its kept twin.
  for (const p of ['', '/ko', '/ja', '/es', '/zh']) {
    lines.push(`${p}/posts/multiple-cities-tour-de-france-femmes/ ${p}/posts/nice-finish-various-french-stages-tour-de-france-femmes-avec-zwift/ 301`);
  }
  // Same venue, two posts: the 2026-07-28 geocode backfill gave the older,
  // weakly-titled placeless post the same Google place.id as the newer guide,
  // surfacing a duplicate validate-content had no way to see before. Kept the
  // better-titled one; the retired slug 301s to it in every locale.
  for (const p of ['', '/ko', '/ja', '/es', '/zh']) {
    lines.push(`${p}/posts/gyeongju-donggung-and-wolji/ ${p}/posts/gyeongju-donggung-palace-wolji-pond/ 301`);
  }
  // Business-card QR target: /card stays printed on physical cards forever, so
  // it must never 404. 302 (not 301) so the destination can be repointed later
  // (e.g. to a newsletter page) without reprinting cards.
  lines.push('/card /?utm_source=business_card&utm_medium=offline&utm_campaign=card2026 302');
  // Instagram bio link (wander_atlas_guides): repointable without editing the bio.
  lines.push('/ig /?utm_source=instagram&utm_medium=social&utm_campaign=bio 302');
  // Retired posts (photo-unfixable venues deleted for regeneration, 2026-07-26):
  // each old URL 301s to its region hub so any indexed link keeps landing well.
  try {
    const retired = JSON.parse(readFileSync(join(__dirname, 'data/retired-posts.json'), 'utf8'));
    for (const r of retired) {
      // Same alias + live-hub rule as the drafts loop above: a retired post
      // whose whole city has since gone dark lands on the homepage, not a 404.
      const reg = canon(r.region || '');
      const ok = reg && liveHubs.has(reg);
      for (const p of ['', '/ko', '/ja', '/es', '/zh']) {
        lines.push(`${p}/posts/${r.slug}/ ${ok ? `${p}/regions/${reg}/` : (p || '/')} 301`);
      }
    }
  } catch { /* no retired list */ }
  return lines.sort();
}
// Custom integration: after the build, append the region 301s to dist/_redirects
// (Cloudflare Workers static-assets honours this file). Runs every build so new
// multi-word regions are covered automatically — no hand-maintained list.
function regionRedirectsIntegration() {
  return {
    name: 'region-redirects',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const lines = regionRedirects();
        if (!lines.length) return;
        const out = fileURLToPath(new URL('_redirects', dir));
        let existing = '';
        try { existing = readFileSync(out, 'utf8').replace(/\s*$/, '') + '\n\n'; } catch { /* none yet */ }
        writeFileSync(out, existing + '# region slug 301s (auto-generated)\n' + lines.join('\n') + '\n');
      },
    },
  };
}

// Custom integration: normalize INTERNAL link hrefs to trailing-slash form in
// the built HTML. Canonicals/sitemap use "/path/" but templates all over the
// codebase write "/path", so every internal click cost a 307/308 redirect hop
// (crawl-budget + latency waste). Fixing it here — instead of in ~30 templates —
// also covers every FUTURE template automatically (regression-proof).
function trailingSlashIntegration() {
  const fixUrl = (url) => {
    if (!url.startsWith('/') || url.startsWith('//')) return url; // internal abs paths only
    const hashAt = url.indexOf('#');
    const hash = hashAt === -1 ? '' : url.slice(hashAt);
    let rest = hashAt === -1 ? url : url.slice(0, hashAt);
    const qAt = rest.indexOf('?');
    const query = qAt === -1 ? '' : rest.slice(qAt);
    let path = qAt === -1 ? rest : rest.slice(0, qAt);
    if (path === '' || path.endsWith('/')) return url;
    const last = path.slice(path.lastIndexOf('/') + 1);
    if (last.includes('.')) return url; // real files: .xml .ics .txt .md .jpg …
    return `${path}/${query}${hash}`;
  };
  const walk = (dir, out = []) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (f.endsWith('.html')) out.push(p);
    }
    return out;
  };
  return {
    name: 'trailing-slash-links',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const root = fileURLToPath(dir);
        let files = 0, links = 0;
        for (const file of walk(root)) {
          const html = readFileSync(file, 'utf8');
          const next = html.replace(/href="(\/[^"]*)"/g, (m, u) => {
            const fixed = fixUrl(u);
            if (fixed !== u) links++;
            return `href="${fixed}"`;
          });
          if (next !== html) { writeFileSync(file, next); files++; }
        }
        console.log(`[trailing-slash-links] normalized ${links} link(s) in ${files} file(s)`);
      },
    },
  };
}

import rehypeMidCta from './src/lib/rehype-mid-cta.mjs';

export default defineConfig({
  site: SITE,
  markdown: {
    rehypePlugins: [rehypeMidCta],
  },
  integrations: [
    sitemap({
      // The embeddable crowd widgets are noindex iframe fragments — listing them
      // told Google "index these" while the page itself says "don't", and wasted
      // crawl budget on 184 non-pages.
      // Anything the page marks noindex must not be submitted, or Search Console
      // reports "Submitted URL marked noindex" for every one. /my-trip is
      // per-visitor, /pinterest-callback is an OAuth landing.
      filter: (page) =>
        !page.includes('/embed/') &&
        !page.includes('/my-trip') &&
        !page.includes('/pinterest-callback') &&
        ![...NOINDEX_SLUGS].some((slug) => page.includes(slug + '/') || page.endsWith(slug)),
      // Advertise per-page freshness. AI search + Google use <lastmod> to decide
      // what to re-crawl and cite; on a daily-rebuilt automated site this is a
      // cheap, honest ranking/citation lever.
      serialize(item) {
        try {
          const path = new URL(item.url).pathname.replace(/\/$/, '');
          // The map is keyed on English paths, so /ko/posts/x never matched it and
          // lastmod covered 481 of 4,721 URLs — 10%. A translation is the same
          // content with the same freshness, so strip the locale before looking up.
          const enPath = path.replace(/^\/(ko|ja|es|zh)(?=\/|$)/, '') || '/';
          let d = LASTMOD.get(enPath);

          // Hubs have no file of their own, but they genuinely change when their
          // children do: a city page is stale the moment a new guide lands in that
          // city. Derive their date from the newest page beneath them rather than
          // leaving 4,000 URLs with no freshness signal at all.
          if (!d) d = HUB_LASTMOD.get(enPath);

          if (d) item.lastmod = new Date(`${d}T00:00:00Z`).toISOString();
        } catch { /* leave lastmod unset on any parse issue */ }
        return item;
      },
    }),
    regionRedirectsIntegration(),
    trailingSlashIntegration(),
  ],
  trailingSlash: 'ignore',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ko', 'ja', 'es', 'zh'],
    routing: { prefixDefaultLocale: false },
  },
  build: {
    format: 'directory',
  },
});
