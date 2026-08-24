import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { isNoindexedPost } from '../lib/eventStatus';

// RSS feed — enables Flipboard, newsletter auto-import, and other syndication.
export async function GET(context) {
  // Google treats this feed as a discovery path — Search Console names rss.xml
  // as a referring URL for indexed posts. Offering it pages that carry their own
  // noindex tag spends crawl budget to be told to go away, and with the site's
  // crawl already stretched thin across 10k URLs that waste is not free
  // (audit 2026-08-25). Same resolver the page and both sitemaps use.
  const posts = (await getCollection('posts', ({ data }) => !data.draft))
    .filter((p) => !isNoindexedPost(p.data))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());

  return rss({
    title: 'Wander Atlas',
    description:
      'Editor-reviewed, AI-assisted travel guides to destinations around the world.',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/posts/${post.id}/`,
      categories: [post.data.region, post.data.category],
    })),
  });
}
