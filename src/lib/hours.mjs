// Turn stored 24h hour arrays into reader-friendly ranges: [8,9,10] → "8–11 AM".
//
// This lived inside PostArticle.astro, which meant the when-to-go pages could
// promise "verified quiet times" and then render venue cards with no times on
// them — the one dataset no competing travel site has, headlined and then not
// shown. Shared from here so both surfaces print the same thing.
//
// AM/PM is a locale word rather than punctuation, so the caller passes its
// translations; Korean readers get 오전/오후.

// Korean, Japanese and Chinese put the meridiem BEFORE the number and add a
// unit after it: 오전 9~10시, not "9–10 오전", which is what this printed for
// every CJK reader until now.
const MERIDIEM_FIRST = { ko: '시', ja: '時', zh: '点' };

export function formatHourRanges(hours, { am = 'AM', pm = 'PM', lang = 'en' } = {}) {
  const unit = MERIDIEM_FIRST[lang];
  const xs = [...new Set(hours ?? [])].filter((h) => Number.isInteger(h)).sort((a, b) => a - b);
  if (!xs.length) return null;

  const f = (h) => {
    const x = ((h % 24) + 24) % 24;
    return { t: x % 12 === 0 ? 12 : x % 12, m: x < 12 ? am : pm };
  };

  const runs = [];
  let s = xs[0], prev = xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] === prev + 1) { prev = xs[i]; continue; }
    runs.push([s, prev]); s = xs[i]; prev = xs[i];
  }
  runs.push([s, prev]);

  return runs
    .map(([a, b]) => {
      // The end hour is exclusive: quiet through 10:00 means quiet until 11.
      const from = f(a), to = f(b + 1);
      if (unit) {
        return from.m === to.m
          ? `${to.m} ${from.t}~${to.t}${unit}`
          : `${from.m} ${from.t}${unit}~${to.m} ${to.t}${unit}`;
      }
      return from.m === to.m ? `${from.t}–${to.t} ${to.m}` : `${from.t} ${from.m}–${to.t} ${to.m}`;
    })
    .join(', ');
}

/** The single most useful line for a venue: when it is quiet on a weekday. */
export function quietLine(busyness, labels = {}) {
  if (!busyness) return null;
  const wd = formatHourRanges(busyness.weekdayQuiet, labels);
  const we = formatHourRanges(busyness.weekendQuiet, labels);
  return { weekday: wd, weekend: we };
}

// Google returns opening hours as English sentences — "Monday: 8:00 AM – 12:00 AM"
// — and they were printed verbatim on every localized page. 239 posts carry them,
// so a Korean reader saw an English weekday name and an English AM/PM on roughly
// 956 pages. It is the largest piece of untranslated text on the site, and the
// leak audit missed it because its AM/PM rule only matched the "9–10 AM" shape.
//
// Only the words are replaced. The numbers, the dash and the ordering of the
// day's ranges are Google's data and stay exactly as given.
const DAYS = {
  ko: ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'],
  ja: ['月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日', '日曜日'],
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
};
const EN_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CLOSED = { ko: '휴무', ja: '定休日', zh: '休息', es: 'Cerrado' };
const OPEN_24 = { ko: '24시간 영업', ja: '24時間営業', zh: '24小时营业', es: 'Abierto 24 horas' };

export function localizeOpeningLine(line, lang, { am = 'AM', pm = 'PM' } = {}) {
  let out = String(line ?? '');
  const days = DAYS[lang];
  if (!days) return out;                                   // English: nothing to do

  EN_DAYS.forEach((en, i) => {
    out = out.replace(new RegExp(String.raw`\b${en}\b`, 'g'), days[i]);
  });
  if (CLOSED[lang]) out = out.replace(/\bClosed\b/g, CLOSED[lang]);
  if (OPEN_24[lang]) out = out.replace(/\bOpen 24 hours\b/gi, OPEN_24[lang]);

  // "8:00 AM" → "오전 8:00" for the languages that lead with the meridiem;
  // Spanish keeps the number first and simply drops the English marker.
  if (MERIDIEM_FIRST[lang]) {
    out = out.replace(/(\d{1,2}:\d{2})\s*(AM|PM)/g, (_, t, mer) => `${mer === 'AM' ? am : pm} ${t}`);
  } else {
    out = out.replace(/\s*(AM|PM)\b/g, (_, mer) => ` ${mer === 'AM' ? am : pm}`);
  }
  return out;
}

// Every hour (0–23) the venue is open on at least one day of the week.
// Used to keep foot-traffic windows inside real opening hours before they reach
// the writer: BestTime measures the pavement, not the business.
function addOpenHoursFromLine(line, set) {
  const re = /(\d{1,2})(?::(\d{2}))?\s*([AP])?\.?M?\.?\s*[–—-]\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M?\.?/gi;
  const to24 = (h, mer) => {
    let x = Number(h);
    if (!mer) return x;
    const pm = /p/i.test(mer);
    if (x === 12) return pm ? 12 : 0;
    return pm ? x + 12 : x;
  };
  const s = String(line);
  if (/open 24 hours/i.test(s)) { for (let h = 0; h < 24; h++) set.add(h); return; }
  if (/closed/i.test(s)) return;
  for (const m of s.matchAll(re)) {
    let a = to24(m[1], m[3] || m[6]);
    // A partially-open first hour is not a recommendable hour. Closing already
    // works this way (h < b drops the 7:00–7:30 sliver of "closes 7:30 PM"),
    // but opening kept it: "9:30 AM" counted hour 9 as open, the quiet-hour 9
    // survived the clamp, and the writer told readers "come at 9–10am" to a
    // door that opens 9:30 (nice-parc-ph-nix, held at the gate 2026-08-08).
    if (m[2] && Number(m[2]) > 0) a += 1;
    let b = to24(m[4], m[6]);
    if (b <= a) b += 24;                       // closes after midnight
    for (let h = a; h < b; h++) set.add(h % 24);
  }
}

export function openHourSet(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const set = new Set();
  for (const line of lines) addOpenHoursFromLine(line, set);
  return set.size ? set : null;
}

// The stored busyness split is weekday/weekend, so the union-across-the-week set
// above cannot catch "weekendQuiet: 18" at a venue that closes weekends at 6 —
// hour 18 is open SOMEWHERE in the week. These sets follow the same split the
// reader sees. A group is null when the hours never mention its days (unknown ≠
// closed: no clamping then); an empty set means those days really are closed.
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKEND_NAMES = ['Saturday', 'Sunday'];
export function openHourSetsByGroup(lines) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const wd = { seen: false, set: new Set() };
  const we = { seen: false, set: new Set() };
  for (const line of lines) {
    const s = String(line);
    const isWd = WEEKDAY_NAMES.some((d) => s.startsWith(d));
    const isWe = !isWd && WEEKEND_NAMES.some((d) => s.startsWith(d));
    if (!isWd && !isWe) return null;   // can't attribute a line → clamp nothing
    const g = isWd ? wd : we;
    g.seen = true;
    addOpenHoursFromLine(s, g.set);
  }
  return { weekday: wd.seen ? wd.set : null, weekend: we.seen ? we.set : null };
}

// Intersect stored BestTime hours with the venue's real opening hours. BestTime
// measures the pavement, which does not stop when the doors do — unclamped, a
// 6 PM-closing folk village advertised "weekend quiet: 6–7 PM" on the live page.
// Returns the four clamped arrays + `changed`, or null when the opening hours
// are absent/unparseable (caller keeps the data exactly as it was).
export function clampBusynessHours(busyness, lines) {
  if (!busyness) return null;
  const groups = openHourSetsByGroup(lines);
  if (!groups) return null;
  const clampTo = (arr, set) =>
    set == null ? [...(arr ?? [])] : (arr ?? []).filter((h) => set.has(((h % 24) + 24) % 24));
  const out = {
    weekdayQuiet: clampTo(busyness.weekdayQuiet, groups.weekday),
    weekdayBusy: clampTo(busyness.weekdayBusy, groups.weekday),
    weekendQuiet: clampTo(busyness.weekendQuiet, groups.weekend),
    weekendBusy: clampTo(busyness.weekendBusy, groups.weekend),
  };
  out.changed = ['weekdayQuiet', 'weekdayBusy', 'weekendQuiet', 'weekendBusy']
    .some((k) => (busyness[k] ?? []).length !== out[k].length);
  return out;
}
