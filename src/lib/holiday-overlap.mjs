// ─────────────────────────────────────────────────────────────
//  ASIA HOLIDAY OVERLAP — which weeks several Asian countries are off at once.
//
//  Why this exists (2026-09-24): avoid-crowds.com — the one independent crowd
//  forecaster that earned Washington Post / CNN links with an open CC BY
//  dataset — covers 4 Asia-Pacific cities and models no Asian source-market
//  holidays (no Golden Week, Chuseok or Tết). Asian regional travel is driven
//  by exactly those weeks, and every date here is a public fact we may publish:
//  the holidays come from the MIT-licensed `holidays` package
//  (scripts/lib/holidays-export.py → data/country-facts.json).
//
//  What it claims, and what it does not: it counts WEEKDAY public holidays per
//  country per week. A holiday on a Saturday gives nobody a day off, so it is
//  not counted. It does NOT claim how busy any destination will be — we have no
//  measurement of that — only which weeks more of Asia is on a break at once.
//  Pure functions, data in by argument, so the page, the CSV/ICS endpoints and
//  the test all run the same arithmetic.
// ─────────────────────────────────────────────────────────────

/** The travel source markets we have holiday data for, in a fixed column order. */
export const SOURCE_MARKETS = [
  'China', 'South Korea', 'Japan', 'Taiwan', 'Hong Kong', 'Singapore',
  'Malaysia', 'Indonesia', 'Thailand', 'Vietnam', 'Philippines', 'India',
];

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const utc = (s) => Date.parse(`${s}T00:00:00Z`);

/** Monday on or before the given ISO date. */
export function mondayOf(isoDate) {
  const t = utc(isoDate);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return iso(t - ((dow + 6) % 7) * DAY);
}

const isWeekday = (isoDate) => {
  const d = new Date(utc(isoDate)).getUTCDay();
  return d >= 1 && d <= 5;
};

/**
 * @param {object} facts          data/country-facts.json
 * @param {object} [opts]
 * @param {string} [opts.fromISO] first day to cover (default today, UTC)
 * @param {number} [opts.weeks]   how many weeks (default 52)
 * @param {string[]} [opts.markets]
 * @returns {{start:string,end:string,score:number,markets:{country:string,days:number,holidays:{date:string,name:string,localName:string}[]}[]}[]}
 */
export function overlapWeeks(facts, { fromISO = iso(Date.now()), weeks = 52, markets = SOURCE_MARKETS } = {}) {
  const countries = facts?.countries ?? {};
  const first = utc(mondayOf(fromISO));
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const start = first + w * 7 * DAY;
    const startISO = iso(start);
    const endISO = iso(start + 6 * DAY);
    const row = [];
    for (const country of markets) {
      const hol = (countries[country]?.holidays ?? [])
        .filter((h) => h.date >= startISO && h.date <= endISO && isWeekday(h.date));
      // Days off, not holiday names: Tết's "Lunar New Year" and "Second Day of
      // Lunar New Year" are two days; two names on ONE date are one day.
      const days = new Set(hol.map((h) => h.date)).size;
      if (days > 0) row.push({ country, days, holidays: hol.map(({ date, name, localName }) => ({ date, name, localName })) });
    }
    out.push({ start: startISO, end: endISO, score: row.length, markets: row });
  }
  return out;
}

/** The weeks worth a headline: most countries off, then most days off, then earliest. */
export function peakWeeks(weeks, n = 8) {
  const daysOff = (w) => w.markets.reduce((a, m) => a + m.days, 0);
  return [...weeks]
    .filter((w) => w.score >= 2)
    .sort((a, b) => b.score - a.score || daysOff(b) - daysOff(a) || a.start.localeCompare(b.start))
    .slice(0, n);
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per (week, country with a weekday holiday). */
export function overlapCsv(weeks) {
  const lines = ['week_start,week_end,countries_off_that_week,country,weekday_holidays,holiday_dates,holiday_names'];
  for (const w of weeks) {
    for (const m of w.markets) {
      lines.push([
        w.start, w.end, w.score, m.country, m.days,
        [...new Set(m.holidays.map((h) => h.date))].join(' '),
        m.holidays.map((h) => h.name).join('; '),
      ].map(csvCell).join(','));
    }
  }
  return lines.join('\n') + '\n';
}
