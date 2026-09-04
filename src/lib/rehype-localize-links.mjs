// Rehype plugin: a translated page links to translated pages.
//
// Translations are written by the translator with every URL kept verbatim, so
// a Korean guide's "[editorial policy](/about)" sent the reader to the ENGLISH
// /about even though /ko/about exists (found by the owner 2026-09-04; 909 ko
// posts carried that one link). Rewriting the markdown files would have to be
// repeated for every future translation; doing it here at render time covers
// every current and future page in one place.
//
// Rule: for a file under one of the translation directories (…/i18n/<lang>/,
// …/static-pages-i18n/<lang>/, …), an absolute internal href whose first path
// segment has a localized twin under src/pages/[lang]/ is prefixed with
// /<lang>. Anything else (already-localized, external, files, anchors, /go/
// affiliate hops, segments with no [lang] twin) is left exactly as written.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LANGS = new Set(['ko', 'ja', 'es', 'zh']);
const TRANSLATED_DIR = /[\\/]content[\\/][a-z-]*i18n[\\/](ko|ja|es|zh)[\\/]/;

// First path segments that exist as routes under src/pages/[lang]/ — read once
// from the filesystem so a new localized route is covered without editing here.
function localizedSegments() {
  try {
    const dir = fileURLToPath(new URL('../pages/[lang]/', import.meta.url));
    return new Set(readdirSync(dir).map((n) => n.replace(/\.(astro|js|ts|md|mdx)$/, '')));
  } catch {
    return new Set();
  }
}

export function localizeHref(href, lang, segments) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href;
  const path = href.split(/[?#]/)[0];
  const first = path.split('/')[1] || '';
  if (!first) return `/${lang}${href}`; // the home page
  if (LANGS.has(first)) return href; // already localized
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return href; // a file (json, xml, webp…)
  if (!segments.has(first)) return href; // no localized twin — keep the English page
  return `/${lang}${href}`;
}

export default function rehypeLocalizeLinks() {
  const segments = localizedSegments();
  return (tree, file) => {
    const p = String(file?.path || file?.history?.[0] || '').replace(/\\/g, '/');
    const m = TRANSLATED_DIR.exec(p);
    if (!m) return;
    const lang = m[1];
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'a' && node.properties?.href) {
        node.properties.href = localizeHref(String(node.properties.href), lang, segments);
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}
