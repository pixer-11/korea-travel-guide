// Build-time "is this event over?" — the site rebuilds daily, so this refreshes
// each day. An event is PAST once its end date is before today (date-only compare,
// so an event ending today still counts as live). Events with no parseable date
// stay "upcoming" (never mis-expired). Non-event posts are never "past".
import { isRecurringEvent } from './eventRecurrence.mjs';

type EventDates = { category?: string; eventEndDate?: Date | string | null; eventStartDate?: Date | string | null };

const dayStr = (d: Date) => d.toISOString().slice(0, 10);

export function isEventPast(data: EventDates, today = new Date()): boolean {
  if (data.category !== 'event' || !data.eventEndDate) return false;
  const end = dayStr(new Date(data.eventEndDate));
  return end < dayStr(today);
}

export function isEventUpcoming(data: EventDates, today = new Date()): boolean {
  return data.category === 'event' && !!data.eventEndDate && !isEventPast(data, today);
}

// Does the page tell search engines NOT to index it?
//
// ONE definition, same shape PostArticle.astro applies to its own <meta robots>
// (noindexPost = isEventPast && !isRecurringEvent): a past ONE-OFF event goes
// noindex, a past RECURRING one stays indexed for "when is X <next year>".
//
// Lives here because every feed that hands URLs to a crawler has to agree with
// the page. It didn't: the main sitemap filtered these, but image-sitemap.xml
// and rss.xml both kept offering 16 self-noindexed pages to Google, which spends
// crawl budget fetching them only to be told to go away (audit 2026-08-25).
// Any new feed must import this rather than re-derive the rule.
export function isNoindexedPost(
  data: EventDates & { title?: string; eventRecurring?: boolean },
  today = new Date(),
): boolean {
  return isEventPast(data, today) && !isRecurringEvent({ ...data, title: data.title });
}

// Sort key: soonest upcoming first; past events sink to the bottom (by most-recent
// end first, so the last-finished shows before older ones).
export function eventSortValue(data: EventDates, today = new Date()): number {
  const start = data.eventStartDate ? new Date(data.eventStartDate).getTime() : Number.MAX_SAFE_INTEGER;
  return isEventPast(data, today) ? Number.MAX_SAFE_INTEGER - start : start;
}
