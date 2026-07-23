// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFileSync, readdirSync } from 'node:fs';
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
