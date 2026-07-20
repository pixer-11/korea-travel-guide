import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

// RSS feed — enables Flipboard, newsletter auto-import, and other syndication.
export async function GET(context) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime()
  );

  return rss({
    title: 'Korea Travel Guide',
    description:
      'Editor-reviewed, AI-assisted travel guides for international visitors to Korea.',
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
