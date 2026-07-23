import { getCollection } from 'astro:content';

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
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const entries = posts
    .filter((p) => p.data.heroImage?.url && !p.data.heroImage.url.includes('placeholder'))
    .map(
      (p) => `  <url>
    <loc>${SITE}/posts/${p.id}/</loc>
    <image:image><image:loc>${esc(abs(p.data.heroImage!.url))}</image:loc></image:image>
  </url>`
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
