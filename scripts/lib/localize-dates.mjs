// English dates left inside a translation, rewritten the way each language writes them.
//
// 2026-10-09: nineteen translations carried the source's date verbatim — "하롱베이
// 헤리티지 마라톤은 November 22, 2026에 개최됩니다", "October 31부터 November 1,
// 2026까지". The translator leaves a date alone when it reads like a fixed token,
// and nothing downstream looked. A date has one right shape per language, so this
// is a rewrite, not a judgement: no model call, the same on every run.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const M = '(January|February|March|April|May|June|July|August|September|October|November|December)';
const num = (m) => MONTHS.indexOf(m.toLowerCase()) + 1;

const FMT = {
  ko: { one: (y, m, d) => `${y ? `${y}년 ` : ''}${m}월 ${d}일`, range: (y, m, a, b) => `${y ? `${y}년 ` : ''}${m}월 ${a}~${b}일` },
  ja: { one: (y, m, d) => `${y ? `${y}年` : ''}${m}月${d}日`, range: (y, m, a, b) => `${y ? `${y}年` : ''}${m}月${a}日〜${b}日` },
  zh: { one: (y, m, d) => `${y ? `${y}年` : ''}${m}月${d}日`, range: (y, m, a, b) => `${y ? `${y}年` : ''}${m}月${a}日至${b}日` },
  es: { one: (y, m, d) => `${d} de ${ES[m - 1]}${y ? ` de ${y}` : ''}`, range: (y, m, a, b) => `${a}–${b} de ${ES[m - 1]}${y ? ` de ${y}` : ''}` },
};

/** Rewrite "November 22, 2026", "November 7-8, 2026" and a bare "October 31" for `lang`. */
export function localizeEnglishDates(text, lang) {
  const f = FMT[lang];
  if (!f || !text || !/[A-Z][a-z]+ \d/.test(text)) return text;
  return String(text)
    .replace(new RegExp(`\\b${M} (\\d{1,2})\\s*[-–]\\s*(\\d{1,2}),? (\\d{4})\\b`, 'g'), (_, m, a, b, y) => f.range(y, num(m), Number(a), Number(b)))
    .replace(new RegExp(`\\b${M} (\\d{1,2}),? (\\d{4})\\b`, 'g'), (_, m, d, y) => f.one(y, num(m), Number(d)))
    // A range with no year, "November 7-8에" (it read "11월 7일-8에" without this).
    .replace(new RegExp(`\\b${M} (\\d{1,2})\\s*[-–]\\s*(\\d{1,2})(?!\\d|\\s*[A-Za-z])`, 'g'), (_, m, a, b) => f.range('', num(m), Number(a), Number(b)))
    // A bare "October 31" — only when no letter or digit follows ("October 31부터",
    // "October 31," ), never inside an English title like "May 18 Memorial".
    .replace(new RegExp(`\\b${M} (\\d{1,2})(?!\\d|\\s*[A-Za-z])`, 'g'), (_, m, d) => f.one('', num(m), Number(d)));
}
