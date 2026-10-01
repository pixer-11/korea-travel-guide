// What "Save to my trip" carries for a place — ONE definition, used by the Save
// button on the post page and by the per-city data files /my-trip reads
// (src/pages/trip-data/[lang]/[region].json.ts), so a fresh save and a
// refreshed old one can never disagree.
//
// Everything here is the post's own data: Google's hours (localized lines for
// display, minute intervals for "open now" in the venue's time zone), the
// measured quiet windows, rating, the venue's time zone, whether the guide
// recommends booking ahead. Nothing is invented; a field the post lacks stays
// empty and /my-trip shows nothing for it.
import { formatHourRanges, localizeOpeningLine } from './hours.mjs';
import { resolveBusyness, perDayBusyness, DAY_NAMES } from './busyness.mjs';
import { parseWeek } from './open-now.mjs';
import { venueTimeZone } from './venue-tz.mjs';
import { recommendsBooking } from './bookAhead.mjs';
import { slugifyRegion } from './slug';

export interface TripExtra {
  rs: string; // region slug: /trip-data/<lang>/<rs>.json
  cat: string;
  rating: number | null;
  reviews: number | null;
  week: number[][][] | null; // Monday-first minute intervals (lib/open-now)
  tz: string | null;
  book: boolean;
  address: string;
}

/** Localized hour lines and the weekday / weekend quiet windows. */
export function tripHoursAndQuiet(place: any, lang: string, ampm: { am: string; pm: string }) {
  const hours = (place?.openingHours ?? []).map((l: string) => localizeOpeningLine(l, lang, ampm));
  const fmt = (h: number[] | undefined) => formatHourRanges(h, { ...ampm, lang });
  // Weekday and weekend quiet windows differ at most venues that have both, so
  // both travel and /my-trip shows whichever matches today. Each must hold on
  // every day of its half of the week — narrowed to the intersection.
  const perDay = perDayBusyness(place?.busyness, place?.openingHours);
  const shared = (days: string[]) => {
    if (!perDay) return undefined;
    const lists = days.map((d) => perDay.get(d)!.quiet);
    return lists[0].filter((h: number) => lists.every((l: number[]) => l.includes(h)));
  };
  const bz = resolveBusyness(place?.busyness);
  const quiet = perDay
    ? { wd: fmt(shared(DAY_NAMES.slice(0, 5))) || '', we: fmt(shared(DAY_NAMES.slice(5))) || '' }
    : { wd: fmt(bz.weekdayQuiet) || '', we: fmt(bz.weekendQuiet) || '' };
  return { hours, quiet };
}

/** The fields /my-trip needs beyond the original payload. */
export function tripExtra(post: any): TripExtra {
  const d = post.data;
  const p = d.place ?? {};
  return {
    rs: slugifyRegion(d.region ?? ''),
    cat: d.category ?? '',
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviews: typeof p.userRatingsTotal === 'number' ? p.userRatingsTotal : null,
    week: p.hoursOmitted ? null : parseWeek(p.openingHours),
    tz: p.lat != null ? venueTimeZone(d.country ?? 'South Korea', d.region) : null,
    book: recommendsBooking(String(post.body ?? '')),
    address: p.address ?? '',
  };
}
