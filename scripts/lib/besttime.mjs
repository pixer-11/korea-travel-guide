// BestTime.app foot-traffic client — the legal alternative to Google Popular
// Times (Places API New does NOT expose busy/popular times). We fetch a venue's
// weekly foot-traffic forecast ONCE at build time and cache the honest, real
// quiet/busy hours into post frontmatter. We NEVER invent this data: if BestTime
// has no forecast for a venue, we store nothing and the post shows nothing.
//
// Docs: https://documentation.besttime.app/  ·  ToS allows displaying the data
// in a functional UI (our visit-tips box); only reselling raw data is barred.
const PRIVATE_KEY = process.env.BESTTIME_API_KEY; // pri_… (create+read). Keep server-side.
const NEW_FORECAST = 'https://besttime.app/api/v1/forecasts';

// Compress a sorted hour list into human ranges: [8,9,10] → "8–11 AM",
// [22,23] → "10 PM–12 AM". Hours are 24h clock (0–23); a run [a..b] means the
// venue is quiet/busy from a:00 up to (b+1):00.
function fmtHour(h) {
  const hh = ((h % 24) + 24) % 24;
  const ampm = hh < 12 ? 'AM' : 'PM';
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return { twelve, ampm };
}
export function formatHourRanges(hours) {
  const xs = [...new Set(hours)].filter((h) => Number.isInteger(h)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const runs = [];
  let start = xs[0], prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] === prev + 1) { prev = xs[i]; continue; }
    runs.push([start, prev]); start = xs[i]; prev = xs[i];
  }
  runs.push([start, prev]);
  return runs
    .map(([a, b]) => {
      const s = fmtHour(a), e = fmtHour(b + 1); // end is exclusive → +1 hour
      // Same meridiem → print it once: "8–11 AM"; else "10 PM–1 AM".
      if (s.ampm === e.ampm) return `${s.twelve}–${e.twelve} ${e.ampm}`;
      return `${s.twelve} ${s.ampm}–${e.twelve} ${e.ampm}`;
    })
    .join(', ');
}

// Only advise hours a traveller would actually visit (7 AM–10 PM). Some 24h-open
// outdoor venues (folk villages, parks) report the dead-of-night as "quiet",
// which is useless/misleading as visit advice — filter those out.
const VISIT_HOURS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
const inVisitWindow = (hrs) => (hrs || []).filter((h) => VISIT_HOURS.has(h));

// Merge the per-day quiet/busy hours BestTime returns into a weekday (Mon–Fri)
// and weekend (Sat–Sun) view — what a traveller actually plans around. We take
// the hours that are quiet/busy on a MAJORITY of days in each group, so a single
// odd day doesn't distort the advice. day_int: 0=Mon … 6=Sun.
function majorityHours(days, pick) {
  const count = new Map();
  for (const d of days) for (const h of inVisitWindow(pick(d))) count.set(h, (count.get(h) || 0) + 1);
  const need = Math.ceil(days.length / 2);
  return [...count.entries()].filter(([, c]) => c >= need).map(([h]) => h).sort((a, b) => a - b);
}

/**
 * Fetch + normalize a venue's weekly foot-traffic forecast.
 * Returns { weekdayQuiet, weekdayBusy, weekendQuiet, weekendBusy, venueId } as
 * hour arrays (24h clock), or null if there's no usable forecast (no key, no
 * data, API error, or venue-not-found — all non-fatal, publishing never blocks).
 */
// Every failure used to return the same bare null: no key, exhausted credits, a
// dead key, a network blip and "this venue genuinely has no forecast" were
// indistinguishable. That is exactly how the missing API key went unnoticed for
// days while every published post quietly lost its busy-times data. The reasons
// are now counted apart so the publish run can say which one happened — the
// difference between "these venues have no data" and "we are locked out" is the
// difference between doing nothing and topping up an account.
const diag = { noKey: 0, noData: 0, quota: 0, authFailed: 0, apiError: 0, network: 0, ok: 0 };

/** Counts since process start, for the publish summary. */
export function busynessDiagnostics() {
  return { ...diag };
}

export async function fetchBusyness(venueName, venueAddress) {
  if (!PRIVATE_KEY) { diag.noKey++; return null; }
  if (!venueName || !venueAddress) { diag.noData++; return null; }
  const url =
    `${NEW_FORECAST}?api_key_private=${encodeURIComponent(PRIVATE_KEY)}` +
    `&venue_name=${encodeURIComponent(venueName)}` +
    `&venue_address=${encodeURIComponent(venueAddress)}`;
  let res;
  try {
    res = await fetch(url, { method: 'POST' });
  } catch { diag.network++; return null; }
  if (!res.ok) {
    // 402/429 = out of credits or rate-limited; 401/403 = key rejected. Both mean
    // no venue will get data today, which is worth saying out loud.
    if (res.status === 402 || res.status === 429) diag.quota++;
    else if (res.status === 401 || res.status === 403) diag.authFailed++;
    else diag.apiError++;
    return null;
  }
  let data;
  try { data = await res.json(); } catch { diag.apiError++; return null; }
  // BestTime returns { status:"OK", analysis:[...7 days], venue_info:{venue_id} }
  if (data.status && data.status !== 'OK') {
    const msg = String(data.message || data.error || '').toLowerCase();
    if (/credit|quota|limit|subscription|payment/.test(msg)) diag.quota++;
    else diag.noData++;
    return null;
  }
  const analysis = data.analysis;
  if (!Array.isArray(analysis) || analysis.length === 0) { diag.noData++; return null; }

  const byDay = (n) => analysis.find((a) => a?.day_info?.day_int === n);
  const weekdays = [0, 1, 2, 3, 4].map(byDay).filter(Boolean);
  const weekend = [5, 6].map(byDay).filter(Boolean);
  if (!weekdays.length && !weekend.length) { diag.noData++; return null; }

  const quiet = (d) => d?.quiet_hours;
  const busy = (d) => d?.busy_hours;

  const out = {
    weekdayQuiet: majorityHours(weekdays, quiet),
    weekdayBusy: majorityHours(weekdays, busy),
    weekendQuiet: majorityHours(weekend, quiet),
    weekendBusy: majorityHours(weekend, busy),
    venueId: data.venue_info?.venue_id || null,
  };
  // Nothing usable → treat as no data (don't write an empty box).
  if (!out.weekdayQuiet.length && !out.weekdayBusy.length &&
      !out.weekendQuiet.length && !out.weekendBusy.length) { diag.noData++; return null; }
  diag.ok++;
  return out;
}
