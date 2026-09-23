// Opening hours as minute intervals, and "is it open right now?".
//
// Google hands us seven English sentences ("Monday: 7:00 AM – 11:00 PM"). The
// post page printed all seven, and a reader who wanted one answer — can I go
// now? — had to find today's line and do the timezone sum themselves. This
// turns the week into numbers the page can (a) condense ("Daily 05:00–23:00")
// at build time and (b) check against the VENUE's clock in the browser.
//
// The rule everywhere below: if we cannot read the week with certainty, we
// return null and the page says nothing. A wrong "Open now" sends someone to a
// locked door; a missing one costs them a glance at the hours list.
//
// Shared by the build (PostArticle) and the browser script (PostSidebar), so
// the condensed line and the live status can never disagree.

export const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_MIN = 1440;

// Same shape addOpenHoursFromLine (hours.mjs) accepts: the start's meridiem is
// optional because Google drops it when both ends share one ("10:00 – 11:30 AM").
const RANGE = /(\d{1,2})(?::(\d{2}))?\s*([AP])?\.?M?\.?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M?\.?/gi;

const to24 = (h, mer) => {
  const x = Number(h);
  if (!mer) return x;
  const pm = /p/i.test(mer);
  if (x === 12) return pm ? 12 : 0;
  return pm ? x + 12 : x;
};

/**
 * Parse one day's text ("7:00 AM – 11:00 PM", "Closed", "Open 24 hours").
 * @returns {[number, number][] | null} [start, end) in minutes from that day's
 *   midnight; end may exceed 1440 for a shift past midnight. null = unreadable.
 */
export function parseDay(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^open 24 hours$/i.test(s)) return [[0, DAY_MIN]];
  if (/^closed$/i.test(s)) return [];
  const out = [];
  let rest = s;
  for (const m of s.matchAll(RANGE)) {
    const start = to24(m[1], m[3] || m[6]) * 60 + Number(m[2] || 0);
    let end = to24(m[4], m[6]) * 60 + Number(m[5] || 0);
    if (start >= DAY_MIN || end > DAY_MIN) return null;
    if (end <= start) end += DAY_MIN;
    out.push([start, end]);
    rest = rest.replace(m[0], '');
  }
  // Anything left besides separators is a format we don't know ("By appointment",
  // "Hours might differ") — refuse the whole day rather than half-read it.
  if (!out.length || /[^\s,;]/.test(rest)) return null;
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * The whole week, Monday first.
 * @param {string[] | undefined} lines Google's "Day: text" sentences.
 * @returns {[number, number][][] | null} null unless all seven days read cleanly.
 */
export function parseWeek(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const week = new Array(7).fill(null);
  for (const line of lines) {
    const m = /^\s*([A-Za-z]+)\s*:\s*(\S.*)$/.exec(String(line));
    if (!m) return null;
    const i = WEEK.indexOf(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase());
    if (i < 0 || week[i]) return null;
    const day = parseDay(m[2]);
    if (!day) return null;
    week[i] = day;
  }
  return week.every(Boolean) ? week : null;
}

/** 24-hour "HH:MM" for a minute offset (wraps past midnight). */
export function hhmm(min) {
  const x = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
}

/** A day's intervals as text: "05:00–23:00", "11:30–15:00, 17:00–22:00". '' when closed. */
export function dayText(intervals) {
  return intervals.map(([s, e]) => `${hhmm(s)}–${e === DAY_MIN ? '24:00' : hhmm(e)}`).join(', ');
}

const is24 = (iv) => iv.length === 1 && iv[0][0] === 0 && iv[0][1] >= DAY_MIN;

/**
 * Days that keep identical hours, grouped, in week order of their first day.
 * @returns {{days: string[], kind: 'hours' | 'closed' | 'open24', text: string}[]}
 */
export function condenseWeek(week) {
  const groups = new Map();
  week.forEach((iv, i) => {
    const kind = !iv.length ? 'closed' : is24(iv) ? 'open24' : 'hours';
    const text = kind === 'hours' ? dayText(iv) : '';
    const key = `${kind}|${text}`;
    const g = groups.get(key);
    if (g) g.days.push(WEEK[i]);
    else groups.set(key, { days: [WEEK[i]], kind, text });
  });
  return [...groups.values()];
}

/**
 * Open or closed at a given moment of the venue's own week.
 * @param {[number, number][][]} week  from parseWeek
 * @param {number} day  0 = Monday
 * @param {number} min  minutes since the venue's local midnight
 * @returns {{open: true, closes: number | null, closesIn: number}
 *   | {open: false, opens: number | null, opensIn: number}}
 *   closes/opens are minute-of-day; closesIn/opensIn are days ahead (0 = today).
 *   closes null = open round the clock all week; opens null = never opens.
 */
export function statusAt(week, day, min) {
  const at = (d) => week[((d % 7) + 7) % 7];
  // Still inside yesterday's late shift?
  let end = null;
  for (const [, e] of at(day - 1)) if (e > DAY_MIN && min < e - DAY_MIN) end = e - DAY_MIN;
  if (end == null) for (const [s, e] of at(day)) if (min >= s && min < e) end = e;
  if (end != null) {
    // A shift that ends exactly at midnight and picks up again at 00:00 the
    // next day is one opening, not a close; follow it (at most a week).
    for (let hops = 0; end % DAY_MIN === 0; hops++) {
      if (hops >= 7) return { open: true, closes: null, closesIn: 0 };
      const next = at(day + end / DAY_MIN).find(([s]) => s === 0);
      if (!next) break;
      end += next[1];
    }
    return { open: true, closes: end % DAY_MIN, closesIn: Math.floor(end / DAY_MIN) };
  }
  for (let k = 0; k <= 7; k++) {
    const hit = at(day + k).find(([s]) => k > 0 || s > min);
    if (hit) return { open: false, opens: hit[0], opensIn: k };
  }
  return { open: false, opens: null, opensIn: 0 };
}

/** Monday-first weekday index and minute-of-day for `date` in an IANA zone. */
export function venueClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  const day = WEEK.indexOf(get('weekday'));
  const min = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  return { day, min };
}
