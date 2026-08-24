import { getCollection } from 'astro:content';
import { isNoindexedPost } from '../lib/eventStatus';

// Image sitemap — lists each post's hero image against its page URL so Google can
// surface them in Image search + Discover. The main sitemap (@astrojs/sitemap)
// doesn't emit <image:image>, so this is a separate file linked from robots.txt.
const SITE = (import.meta.env.SITE || 'https://wanderatlasguides.com').replace(/\/$/, '');
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// Self-hosted heroes are stored as site-relative paths (/venue-photos/…, /wall/…);
// image <loc> must be absolute, so prefix those with the site origin.
const abs = (u: string) => (u.startsWith('http') ? u : SITE + u);

export async function GET() {
  // A sitemap must never submit a page the page itself marks noindex. The main
  // sitemap has always filtered these (astro.config.mjs → noindexSlugs); this
  // file did not, so 16 past one-off events were told "don't index me" by their
  // own meta tag while still being handed to Google here (audit 2026-08-25).
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).filter(
    (p) => !isNoindexedPost(p.data),
  );
  const entries = posts
    .filter((p) => p.data.heroImage?.url && !p.data.heroImage.url.includes('placeholder'))
    // Hero AND in-body gallery photos: every image is its own entry point from
    // Google Images, so a post with a second photo gets listed with both.
    .map((p) => {
      const urls = [p.data.heroImage!.url, ...(p.data.gallery ?? []).map((g) => g.url)]
        .filter((u) => u && !u.includes('placeholder'));
      const imgs = [...new Set(urls)]
        .map((u) => `<image:image><image:loc>${esc(abs(u))}</image:loc></image:image>`)
        .join('');
      return `  <url>
    <loc>${SITE}/posts/${p.id}/</loc>
    ${imgs}
  </url>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
