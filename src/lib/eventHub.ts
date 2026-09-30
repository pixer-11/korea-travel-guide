// Shared arithmetic for the two events hubs (/events and /events/<country>),
// so the numbers and the picks cannot drift between them. Pure: posts in,
// values out; the components only render. Redesign 2026-09-30.
import { eventCategory } from './eventCategory.mjs';

// Event dates are date-only, stored as UTC midnight: the UTC day number IS
// the event's day.
const DAY = 86_400_000;
export const dayNum = (d: any) => Math.floor(new Date(d).getTime() / DAY);
export const todayNumOf = (today: Date) =>
  Math.floor(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / DAY);
export const startN = (p: any) => (p.data.eventStartDate ? dayNum(p.data.eventStartDate) : NaN);
export const endN = (p: any) => (p.data.eventEndDate ? dayNum(p.data.eventEndDate) : startN(p));

/** The hero's three numbers at build time; the hero's script recounts them from the reader's date. */
export function hubStats(upcoming: any[], today: Date) {
  const t = todayNumOf(today);
  return {
    // No end date counts as still on, as the list's "on now" group treats it.
    now: upcoming.filter((p) => startN(p) <= t && (!p.data.eventEndDate || endN(p) >= t)).length,
    week: upcoming.filter((p) => startN(p) >= t && startN(p) <= t + 6).length,
    today: upcoming.filter((p) => p.data.eventEndDate && endN(p) === t).length,
  };
}

export const hasPhoto = (p: any) => !!p.data.heroImage?.url && p.data.heroImage.license !== 'placeholder';

// The three picks. A rule, re-run on every daily build, so the row follows the
// events as they are added and end — nothing here is chosen by hand. Events
// with a real photo starting far enough ahead to still book, one in each of
// three windows (5–20, 21–40, 41–60 days out); annual events first in each
// window (eventRecurring comes from the discovery search: the established
// festivals, races and film weeks a trip is planned around), then a different
// category — and on the global hub a different country — from the picks
// before it. Search data cannot rank them: every upcoming event guide showed
// 0 impressions while the index was frozen (2026-09-30), so "most searched"
// would have been a claim with nothing under it.
export function pickEvents(upcoming: any[], today: Date, { distinctCountry = true } = {}) {
  const t = todayNumOf(today);
  const ahead = (p: any) => startN(p) - t;
  const pool = upcoming
    .filter((p) => hasPhoto(p) && ahead(p) >= 5 && ahead(p) <= 60)
    .sort((a, b) => Number(b.data.eventRecurring === true) - Number(a.data.eventRecurring === true) || startN(a) - startN(b));
  const picks: any[] = [];
  const clash = (p: any) => picks.some((q) =>
    eventCategory(q.data) === eventCategory(p.data) ||
    (distinctCountry && (q.data.country ?? '') === (p.data.country ?? '')));
  for (const [lo, hi] of [[5, 20], [21, 40], [41, 60]]) {
    const inWin = pool.filter((p) => ahead(p) >= lo && ahead(p) <= hi && !picks.includes(p));
    const p = inWin.find((x) => !clash(x)) ?? inWin[0];
    if (p) picks.push(p);
  }
  for (const p of pool) { if (picks.length >= 3) break; if (!picks.includes(p) && !clash(p)) picks.push(p); }
  for (const p of pool) { if (picks.length >= 3) break; if (!picks.includes(p)) picks.push(p); }
  return picks.sort((a, b) => startN(a) - startN(b));
}

/** Annual events whose run ended in the current year ("this year" must be true), latest first. */
export function annualEndedThisYear(past: any[], today: Date, n = 4) {
  return [...past]
    .filter((p) => p.data.eventRecurring === true && p.data.eventStartDate &&
      new Date(p.data.eventEndDate ?? p.data.eventStartDate).getUTCFullYear() === today.getUTCFullYear())
    .sort((a, b) => endN(b) - endN(a))
    .slice(0, n);
}

/** Up to `max` characters of whole sentences (Latin and CJK stops). */
export function firstSentences(text: string, max = 150) {
  const parts = (text || '').match(/[^.!?。！？]+[.!?。！？]+(?:\s|$)|[^.!?。！？]+$/g) ?? [];
  let out = '';
  for (const part of parts) { if (out && (out + part).length > max) break; out += part; }
  return out.trim();
}

/** Country hubs worth linking: ≥2 events (the hub's own build rule), most upcoming first. */
export function countryLinksOf(all: any[], upcoming: any[], countries: { name: string; slug: string; iso2: string }[]) {
  const bySlug = new Map(countries.map((c) => [c.name, c]));
  const total = new Map<string, number>();
  for (const p of all) { const n = p.data.country ?? 'South Korea'; total.set(n, (total.get(n) ?? 0) + 1); }
  const up = new Map<string, number>();
  for (const p of upcoming) { const n = p.data.country ?? 'South Korea'; up.set(n, (up.get(n) ?? 0) + 1); }
  return [...total.entries()]
    .filter(([name, n]) => n >= 2 && bySlug.has(name))
    .map(([name]) => ({ name, slug: bySlug.get(name)!.slug, flag: bySlug.get(name)!.iso2, up: up.get(name) ?? 0 }))
    .sort((a, b) => b.up - a.up || a.name.localeCompare(b.name));
}
