import table from './esim-i18n.json';
import { defaultLang, type Lang } from './ui';

// Localized per-country eSIM prose (intro / coverage / tips). English source
// lives in data/esim-facts.json; translations in esim-i18n.json are produced by
// scripts/translate-esim.mjs, which stamps each entry with a srcHash of the
// English text so an edited source re-queues its translations automatically.
// Falls back to English field-by-field, so a half-translated country degrades
// instead of breaking.

export interface EsimProse {
  intro: string;
  coverage: string;
  tips: string[];
}

const TABLE = table as Record<string, Record<string, Partial<EsimProse> & { _srcHash?: string }>>;

export function localizeEsim(slug: string, en: EsimProse, lang: Lang): EsimProse {
  if (lang === defaultLang) return en;
  const tr = TABLE[slug]?.[lang];
  return {
    intro: tr?.intro || en.intro,
    coverage: tr?.coverage || en.coverage,
    tips: tr?.tips?.length === en.tips.length ? (tr.tips as string[]) : en.tips,
  };
}
