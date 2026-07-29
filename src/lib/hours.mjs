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
