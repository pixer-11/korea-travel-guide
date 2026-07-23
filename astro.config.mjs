// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import react from '@astrojs/react';

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
const LASTMOD = contentLastmod();

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
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    let fm = '';
    try { fm = readFileSync(join(dir, f), 'utf8').split('---')[1] || ''; } catch { continue; }
    const m = /(?:^|\n)region:\s*['"]?([^'"\n]+)/.exec(fm);
    const r = m?.[1]?.trim();
    if (r && !r.includes('/')) regions.add(r);
  }
  const lines = [];
  for (const r of regions) {
    const oldEnc = encodeURI(r.toLowerCase()); // what the old href resolved to
    const next = regionSlug(r);
    if (oldEnc !== next) lines.push(`/regions/${oldEnc}/ /regions/${next}/ 301`);
  }
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

export default defineConfig({
  site: SITE,
  integrations: [
    sitemap({
      // Advertise per-page freshness. AI search + Google use <lastmod> to decide
      // what to re-crawl and cite; on a daily-rebuilt automated site this is a
      // cheap, honest ranking/citation lever.
      serialize(item) {
        try {
          const path = new URL(item.url).pathname.replace(/\/$/, '');
          const d = LASTMOD.get(path);
          if (d) item.lastmod = new Date(`${d}T00:00:00Z`).toISOString();
        } catch { /* leave lastmod unset on any parse issue */ }
        return item;
      },
    }),
    react(),
    regionRedirectsIntegration(),
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
