import eventNames from './event-names.json';
import { defaultLang, type Lang } from './ui';

// Localized names for the recurring events in data/events.json. Same reasoning as
// places.ts: these are DATA, not UI strings, so they cannot live in the
// dictionary — the table is built by scripts/build-event-names.mjs.
//
// Without it, the Korean when-to-go page for Japan in March listed its single
// seasonal highlight as "Cherry Blossom Season in Japan": an English sentence
// under a Korean heading, arriving through the data rather than through the UI,
// which is exactly the shape the leak audit's rules cannot see.
//
// Falls back to the English name for an event discovered today and not yet
// translated, so a missing entry degrades to English instead of blanking.
const TABLE = eventNames as Record<string, Partial<Record<Lang, string>>>;

export function localizeEvent(name: string | undefined | null, lang: Lang): string {
  const n = (name ?? '').trim();
  if (!n || lang === defaultLang) return n;
  return TABLE[n]?.[lang] || n;
}
