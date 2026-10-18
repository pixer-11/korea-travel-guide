// "What's next" for a finished event guide.
//
// Finished event guides keep their search traffic — in the week of 2026-10-19
// three of the top twelve pages were tennis events whose finals had already
// been played (Shanghai Masters, China Open), and the only way on from them
// was the events index. A reader who searched for one tournament is most
// likely to want the next one on the same calendar, wherever it is: Shanghai
// → the ATP Finals in Turin. Related guides are chosen within one country, so
// that link never existed.
//
// Same performer first (a tour's next stop), then the same kind of event.
// Kinds are read from the title, venue and description, ordered so that the
// narrow ones win: "Table Tennis" is not tennis, a snooker "Grand Prix" is not
// Formula 1, and a bare "Grand Prix" decides nothing (the Macau Grand Prix is
// F3 and motorcycles).

const KINDS = [
  ['table-tennis', /table tennis|\bITTF\b|ping ?pong/i],
  ['snooker', /snooker/i],
  ['motogp', /moto ?gp/i],
  ['f1', /formula ?(1|one)\b|\bF1\b/i],
  ['tennis', /\btennis\b|\bATP\b|\bWTA\b/i],
  ['golf', /\bgolf\b|\bPGA\b|\bLPGA\b/i],
  ['marathon', /marathon/i],
  ['cycling', /tour de france|giro d'italia|vuelta a espa|cycling/i],
  ['badminton', /badminton|\bBWF\b/i],
];

export function eventKind(data) {
  if (!data || data.category !== 'event') return null;
  const text = [data.title, data.eventVenue, data.description].filter(Boolean).join(' · ');
  for (const [k, re] of KINDS) if (re.test(text)) return k;
  return null;
}

// The content schema coerces event dates to Date; tests and scripts pass strings.
const day = (x) => (x instanceof Date ? (Number.isNaN(x.getTime()) ? '' : x.toISOString()) : String(x ?? '')).slice(0, 10);

/**
 * The next event to point a finished event's reader at, or null.
 * @param {{id:string,data:any}} post   the finished event
 * @param {{id:string,data:any}[]} posts live posts
 * @param {string} today                 YYYY-MM-DD (the build day)
 */
export function nextEventFor(post, posts, today) {
  const d = post?.data;
  if (!d || d.category !== 'event') return null;
  const performer = String(d.eventPerformer?.name ?? '').trim().toLowerCase();
  const kind = eventKind(d);
  if (!performer && !kind) return null;
  const ahead = posts
    .filter((p) => p.id !== post.id && p.data?.category === 'event' && !p.data.draft
      && p.data.eventStartDate && day(p.data.eventEndDate || p.data.eventStartDate) >= today)
    .sort((a, b) => day(a.data.eventStartDate).localeCompare(day(b.data.eventStartDate)) || a.id.localeCompare(b.id));
  if (performer) {
    const same = ahead.find((p) => String(p.data.eventPerformer?.name ?? '').trim().toLowerCase() === performer);
    if (same) return { post: same, why: 'performer' };
  }
  if (kind) {
    const same = ahead.find((p) => eventKind(p.data) === kind);
    if (same) return { post: same, why: 'kind' };
  }
  return null;
}
