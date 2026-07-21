import { ui, defaultLang, type Lang } from './ui';

export { defaultLang };
export type { Lang };

// Display names for the language switcher.
export const languages: Record<Lang, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  es: 'Español',
  zh: '中文',
};

export const localeCodes: Record<Lang, string> = {
  en: 'en',
  ko: 'ko',
  ja: 'ja',
  es: 'es',
  zh: 'zh-Hans',
};

const NON_DEFAULT = ['ko', 'ja', 'es', 'zh'] as const;

// Locale for the current URL (English is unprefixed at /).
export function getLangFromUrl(url: URL): Lang {
  const seg = url.pathname.split('/')[1];
  return (NON_DEFAULT as readonly string[]).includes(seg) ? (seg as Lang) : defaultLang;
}

// Translator bound to a language, with English fallback.
export function useTranslations(lang: Lang) {
  return function t(key: keyof (typeof ui)['en']): string {
    return (ui[lang] as Record<string, string>)[key] ?? ui[defaultLang][key];
  };
}

// Strip any locale prefix from a path → the canonical (English) path.
export function stripLocale(path: string): string {
  const stripped = path.replace(/^\/(ko|ja|es|zh)(?=\/|$)/, '');
  return stripped === '' ? '/' : stripped;
}

// Build the path for a given locale. English has no prefix.
export function localizePath(path: string, lang: Lang): string {
  const base = stripLocale(path);
  if (lang === defaultLang) return base;
  return base === '/' ? `/${lang}/` : `/${lang}${base}`;
}
