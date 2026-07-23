// Build-time "is this event over?" — the site rebuilds daily, so this refreshes
// each day. An event is PAST once its end date is before today (date-only compare,
// so an event ending today still counts as live). Events with no parseable date
// stay "upcoming" (never mis-expired). Non-event posts are never "past".
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

// Sort key: soonest upcoming first; past events sink to the bottom (by most-recent
// end first, so the last-finished shows before older ones).
export function eventSortValue(data: EventDates, today = new Date()): number {
  const start = data.eventStartDate ? new Date(data.eventStartDate).getTime() : Number.MAX_SAFE_INTEGER;
  return isEventPast(data, today) ? Number.MAX_SAFE_INTEGER - start : start;
}
