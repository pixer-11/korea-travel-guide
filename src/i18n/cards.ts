import { getCollection } from 'astro:content';
import { localizePath, type Lang } from './utils';

// Shared helper for localizing post CARDS on hub pages (destinations, events,
// region hubs, roundups…). Loads the translated title/description for the current
// language and lets a hub show localized card copy + link to the localized post
// URL — falling back to the English post when a translation is missing (so a
// brand-new untranslated post never 404s or shows a half-empty card).
export async function loadCardTranslations(lang: Lang) {
  if (lang === 'en') return new Map<string, { title: string; description: string }>();
  const trs = await getCollection('postI18n', ({ data }) => data.lang === lang);
  return new Map(trs.map((t) => [t.data.slug, { title: t.data.title, description: t.data.description }]));
}

export function cardHelpers(
  tr: Map<string, { title: string; description: string }>,
  lang: Lang
) {
  return {
    title: (id: string, enTitle: string) => tr.get(id)?.title ?? enTitle,
    desc: (id: string, enDesc: string) => tr.get(id)?.description ?? enDesc,
    href: (id: string, trailingSlash = false) => {
      const path = lang !== 'en' && tr.has(id) ? localizePath(`/posts/${id}`, lang) : `/posts/${id}`;
      return trailingSlash && !path.endsWith('/') ? `${path}/` : path;
    },
  };
}
