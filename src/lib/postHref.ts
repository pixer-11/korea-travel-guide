// A post's URL in the reader's language — or the English post when that
// language has no translation yet. Localized post pages exist only for slugs
// with a postI18n entry, and translations land per language on different days,
// so a bare localizePath(`/posts/…`) links to a page that was never built:
// /ko/tools/best-time/ and /ko/search.json pointed at a 404 Neues Museum page
// for days (2026-10-05 audit). Same rule cards.ts has always used.
import { localizePath, type Lang } from '../i18n/utils';

export function postHref(id: string, lang: Lang, translated: { has(id: string): boolean }, trailingSlash = false): string {
  const path = lang !== 'en' && translated.has(id) ? localizePath(`/posts/${id}`, lang) : `/posts/${id}`;
  return trailingSlash && !path.endsWith('/') ? `${path}/` : path;
}
