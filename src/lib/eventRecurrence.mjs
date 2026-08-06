// Does this event come back every year?
//
// ONE definition, imported by everything that needs it. It used to live only in
// PostArticle.astro, so the page said "index me, I'm annual" while the sitemap
// (astro.config.mjs) dropped every past event without exception — three
// recurring events were indexable but unsubmitted (found 2026-08-06). Any new
// caller must import from here rather than re-deriving the rule.

// Match the ENGLISH title on purpose — these patterns are English, and the
// localized titles are free translations.
const RECURRING = new RegExp(
  String.raw`annual|festival|championship|grand prix|gran premio|\bopen\b|world cup|olympic|marathon|matsuri|biennale|\bcup\b|rally|expo|comic ?market|comiket|\b\d{1,3}(st|nd|rd|th)\b`,
  'i',
);

// Things that look recurring but are not. `expo` matched "XG Concert
// (AsiaWorld-Expo)" — a venue name — and shipped repeatFrequency:"P1Y" on a
// single K-pop date; the ordinal rule matched "10th Anniversary Tour" and
// "1st World Tour", which are by definition not annual. A tour is a tour
// (found 2026-08-06). Checked BEFORE the recurrence patterns, so a venue or a
// tour ordinal can no longer promote a one-off into a yearly series.
// Narrow on purpose. A bare `tour` would demote the World Athletics Continental
// Tour, and a bare `anniversary` would demote the Sturgis Motorcycle Rally
// (86th Anniversary) — both genuinely annual. Only touring-act language and
// venue names ending in "Expo" are excluded.
const NOT_RECURRING = new RegExp(
  String.raw`\bworld tour\b|\banniversary tour\b|\bconcert\b|-expo\b|expo\)`,
  'i',
);

/**
 * True when an event title advertises a yearly cadence (annual festival, GP,
 * championship, film festival…). Such an event keeps its page indexed after the
 * date passes AND advertises repeatFrequency P1Y, so it can win
 * "when is X <next year>" as the next edition approaches.
 *
 * Takes a title, not a post: astro.config.mjs reads raw frontmatter and has no
 * collection entry to hand.
 */
export function isRecurringEventTitle(title) {
  const t = String(title ?? '');
  return RECURRING.test(t) && !NOT_RECURRING.test(t);
}

/**
 * Is this event post recurring? The stored fact wins; the title heuristic is
 * only a fallback.
 *
 * The heuristic can only see words, so it misses every annual event whose name
 * carries none — Lollapalooza, Tour de France, ChinaJoy all read as one-offs
 * and dropped out of the index the day they ended. Widening the keywords is
 * what produced the opposite failure (a one-off K-pop night advertising a
 * yearly cadence because its venue is called AsiaWorld-Expo), so the fix is a
 * better input, not a bigger regex: discover-events.mjs now asks the web
 * search outright and stores `eventRecurring`.
 *
 * Takes frontmatter-ish data so both the page and the sitemap filter can call
 * it; the sitemap reads raw YAML and has no collection entry.
 */
export function isRecurringEvent(data) {
  if (!data || data.category !== 'event') return false;
  if (typeof data.eventRecurring === 'boolean') return data.eventRecurring;
  return isRecurringEventTitle(data.title);
}
