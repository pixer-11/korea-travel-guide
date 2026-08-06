import holidays from './holidays.json';
import { defaultLang, type Lang } from './ui';

// Public-holiday names in the reader's language.
//
// The holiday feed gives two names per row: `localName` (the name used in the
// country itself — 元日, Fête nationale, Araw ng Kagitingan) and `name`
// (English). Pages printed "localName · name", which is right for an English
// reader and wrong for everyone else: 356 localized pages carried an English
// gloss like "元旦 · New Year's Day" (found 2026-08-06).
//
// Keyed "Country|English name" because the English name alone is ambiguous:
// Liberation Day is 광복절 in Korea and the Festa della Liberazione in Italy,
// and Constitution Day is a different date and a different event in Korea and
// Spain. A country-qualified table gets both right.
const TABLE = holidays as Record<string, Partial<Record<Lang, string>>>;

// Some feed rows are marked provisional (Islamic-calendar dates confirmed by
// sighting). The suffix is part of the English name, so it needs translating
// too — otherwise the gloss is localized right up to a trailing "(Tentative Date)".
const TENTATIVE = /\s*\(Tentative Date\)\s*$/i;
const TENTATIVE_LABEL: Record<Lang, string> = {
  en: ' (tentative date)',
  ko: '(잠정)',
  ja: '（暫定）',
  zh: '（暂定）',
  es: ' (fecha provisional)',
};

/**
 * The holiday's name in `lang`, or null when the table has no entry.
 *
 * Null on purpose rather than falling back to English: the whole point is that
 * a Japanese reader never sees "New Year's Day". Callers show `localName`
 * alone when this returns null, which is still useful — it is the name written
 * on the shop door that day.
 */
export function localizeHoliday(
  country: string | undefined | null,
  name: string | undefined | null,
  lang: Lang,
): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  if (lang === defaultLang) return n;

  const tentative = TENTATIVE.test(n);
  const base = n.replace(TENTATIVE, '');
  const hit = TABLE[`${(country ?? '').trim()}|${base}`]?.[lang];
  if (!hit) return null;
  return tentative ? `${hit}${TENTATIVE_LABEL[lang]}` : hit;
}

/**
 * What to print for one holiday: the local name, plus the reader's-language
 * name after a separator when it adds something. Never English on a localized
 * page, never a duplicate ("元日 · 元日"), never empty.
 */
export function holidayLabel(
  country: string | undefined | null,
  localName: string | undefined | null,
  name: string | undefined | null,
  lang: Lang,
): string {
  // The feed appends the English "(Tentative Date)" to the LOCAL name as well
  // ("Ramazan Bayramı 1. Gün (Tentative Date)"), so translating only the gloss
  // left English on 12 Turkish-holiday pages — caught in the built output, not
  // in review. Strip it from both sides and re-attach it once at the end,
  // rather than printing "(잠정)" twice in one line.
  const rawLocal = String(localName ?? '');
  const rawName = String(name ?? '');
  const tentative = TENTATIVE.test(rawLocal) || TENTATIVE.test(rawName);
  const local = rawLocal.replace(TENTATIVE, '').trim();
  const gloss = localizeHoliday(country, rawName.replace(TENTATIVE, ''), lang);

  let label;
  if (!local) label = gloss ?? rawName.replace(TENTATIVE, '').trim();
  else if (!gloss || gloss === local) label = local;
  else label = `${local} · ${gloss}`;

  return tentative ? `${label}${TENTATIVE_LABEL[lang]}` : label;
}
