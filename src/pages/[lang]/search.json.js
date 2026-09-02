import { getCollection } from 'astro:content';
import countriesData from '../../../data/countries.json';
import { buildSearchIndex } from '../../lib/searchIndex';

// The localized search index: same builder as /search.json, localized names
// and localized URLs, plus the translated guide titles. Until 2026-09-02 the
// four localized homepages queried the English index.
export function getStaticPaths() {
  return ['ko', 'ja', 'es', 'zh'].map((lang) => ({ params: { lang } }));
}

export async function GET({ params }) {
  const lang = params.lang;
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const translations = await getCollection('postI18n', ({ data }) => data.lang === lang);
  const items = buildSearchIndex({ lang, posts, countries: countriesData.countries, translations });
  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json' },
  });
}
