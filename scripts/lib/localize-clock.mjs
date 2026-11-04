// English clock times left inside a translation, rewritten the way each language writes them.
//
// 2026-11-04: 248 Chinese, 181 Japanese and 124 Korean pages carried 6,816 of
// them — 「宫殿每天11am至6pm开放」, 「7am～8amが最も空いている」, 「평일 9am부터」 —
// beside 13,000+ times per language the translator had written natively, and
// beside a crowd box that already said 上午9点 / 午前9時 / 오전 9시. The prompt's
// "KEEP EXACTLY AS-IS: … times" is read either way. Asking the model to convert
// would hand it 12am and 12pm to get wrong; a clock time has one right shape per
// language, so this is a rewrite, not a judgement — no model call, the same on
// every run (lib/localize-dates did the same for dates). Spanish is left alone:
// the crowd box prints 9am for Spanish too.
//
// The words are the ones the translator itself uses most (measured on the
// corpus, see clockWord in src/lib/hours.mjs): zh 早上8点 · 上午10点 · 中午12点 ·
// 下午3点 · 晚上9点 · 凌晨1点, minutes as 上午9:30; ja 午前9時30分 / 午後3時 /
// 午前0時; ko 오전 9시 30분 / 오후 3시 / 정오 / 자정 / 새벽 2시. A word the
// translator already put there ("早上8:30am", "저녁 5pm") is kept and only the
// English marker goes.
import { clockWord, clockNumber } from '../../src/lib/hours.mjs';

const LANGS = new Set(['ko', 'ja', 'zh']);
// Words a translator may already have put before the time. The first row only
// sets the scene (每晚 "every evening", 清晨, 一早) and is kept as it is — adding
// 晚上 after it read 「每晚晚上7:45」 (native review, 11-04).
const WORDS = '每晚|今晚|当晚|夜里|夜间|清晨|一早|早晨|深夜|凌晨|早上|上午|中午|下午|傍晚|晚上|午夜|午前|午後|朝|夜|새벽|오전|아침|낮|오후|저녁|밤';
const AM_WORD = /^(凌晨|早上|上午|午前|朝|새벽|오전|아침)$/;
const PM_WORD = /^(中午|下午|傍晚|晚上|午後|오후|저녁)$/;
// The English marker: am · AM · a.m. — never the period that ends a sentence:
// "9pm." keeps it, and so does "9 a.m." at the end of a line, where the
// abbreviation's dot was the sentence's too. Not a domain ("9am.com").
const MER = String.raw`[ ]?([AaPp])(?:\.[ ]?[Mm](?:\.(?![ \t]*(?:\r?\n|$)))?|[ ]?[Mm])(?![A-Za-z]|\.[A-Za-z])`;
const NUM = String.raw`(\d{1,2})(?:[:：](\d{2}))?`;
// [lead space][kept word][space] [start number [its marker] [sep]] end number + marker [trail space]
// The start of "9–11am" has no marker of its own; it takes the end's.
// Not the middle of a number ("10:30am" starts at the 1, not the 3) or of an
// address (foo@9am.com); a colon that ends a label (「出门玩之前：10:30am」) is
// punctuation, not minutes.
const START = String.raw`(?<![\w.@])(?<!\d[:：])`;
const RE = new RegExp(
  String.raw`([ \t]?)(?:(${WORDS})([ ]?))?${START}` +
  String.raw`(?:${NUM}(?:${MER})?([ ]?)([-–—~〜～至到])([ ]?))?` +
  String.raw`${NUM}${MER}([ \t]?)`,
  'g',
);
/** Any English clock token, for counting what is left. */
export const ENGLISH_CLOCK = new RegExp(String.raw`${START}${NUM}${MER}`, 'g');

// The K-pop groups 2PM and 2AM: uppercase, no space, beside a group or member
// word. The first apply run wrote Lee Junho's and Jay Park's band as 「男团下午2点
// 的成员」 / 「ボーイズグループ午後2時のメンバー」 / 「보이그룹 오후 2시 멤버」 on 15
// lines (native review, 11-04). A real 2PM is lowercase or follows a time word
// (「下午2PM演唱会开始」 is a time — Codex, 11-04).
const BAND = String.raw`(?<![\w.:：@/])(?<!(?:${WORDS})[ ]?)2(?:PM|AM)(?![A-Za-z0-9])(?=[ ]?(?:的?(?:成员|队长|舞台|演唱会|粉丝|歌迷)|男团|组合|の?(?:メンバー|リーダー|ステージ|ファン|コンサート)|として|(?:의 ?)?(?:멤버|리더|무대|팬|콘서트|출신)))|(?<=(?:男团|组合|团体|ボーイズグループ|グループ|보이그룹|그룹|아이돌)[ ]?)2(?:PM|AM)(?![A-Za-z0-9])`;
// Code (``` and ~~~ fences, `spans`), links, tags and the band are not clock times.
const PROTECTED = new RegExp(String.raw`(\x60\x60\x60[\s\S]*?\x60\x60\x60|~~~[\s\S]*?~~~|\x60[^\x60\n]*\x60|\]\([^)]*\)|https?:\/\/[^\s)）]+|<[^>\n]+>|${BAND})`, 'g');

/** English clock tokens left in prose (the band and code do not count). */
export const englishClocks = (text) => String(text ?? '').split(PROTECTED)
  .flatMap((chunk, i) => (i % 2 ? [] : chunk.match(ENGLISH_CLOCK) || []));
export const countEnglishClock = (text) => englishClocks(text).length;

const half = (x) => (x < 12 ? 'am' : 'pm');
const sameWord = (a, b) => a === b || (/^(早上|上午)$/.test(a) && /^(早上|上午)$/.test(b));

/** One clock time as { word, rest } or { solo } (정오 / 자정, a word with no number). */
function part(x, mm, lang, kept, { clock = false } = {}) {
  // 9:00am is 9点 / 9時 / 9시 — unless the other end of a Chinese range reads
  // 6:45, where 下午4:00–6:45 is one shape and 下午4点–6:45 two.
  const mins = mm && (mm !== '00' || clock) ? mm : clock ? '00' : null;
  let word = kept && !(AM_WORD.test(kept) && x >= 12) && !(PM_WORD.test(kept) && x < 12) ? kept : null;
  if (lang === 'ko') {
    if (!word && !mins && x === 12) return { solo: '정오', x };
    if (!word && !mins && x === 0) return { solo: '자정', x };
    word ??= x >= 1 && x <= 3 ? '새벽' : x < 12 ? '오전' : '오후';
    const n = x === 0 ? 0 : x % 12 || 12;
    return { word, x, rest: mins ? `${n}시 ${Number(mins)}분` : `${n}시` };
  }
  if (lang === 'ja') {
    // Noon is 正午 (984 in the corpus to 125 for 午後12時, which the Meiji
    // decree reads as midnight). Midnight to 2am is 深夜 (深夜0時 189 to 42;
    // 深夜1時·2時 also lead), which keeps 「午前7時〜深夜2時」 from reading as one
    // morning.
    if (!word && !mins && x === 12) return { solo: '正午', x };
    word ??= x <= 2 ? '深夜' : clockWord(x, 'ja');
    const n = clockNumber(x, 'ja');
    return { word, x, rest: mins ? `${n}時${Number(mins)}分` : `${n}時` };
  }
  word ??= clockWord(x, 'zh');
  if (x === 0 && mins) return { word: word === '午夜' ? '凌晨' : word, x, rest: `0:${mins}` };
  return { word, x, rest: mins ? `${clockNumber(x, 'zh')}:${mins}` : `${clockNumber(x, 'zh')}点` };
}

const to24 = (h, pm) => (Number(h) % 12) + (pm ? 12 : 0);
// Han, kana and full-width punctuation (，。：（）〜).
const cjk = (c) => /[　-〿぀-ヿ㐀-鿿＀-￯]/.test(c || '');

// The translator chose a Korean particle for the English token, read 피엠/에이엠
// with a final consonant: 「9pm이」「4pm을」「5pm과」. After 시 or 정오 (a final
// vowel) it takes its other form; after 분 or 자정 it stays. 이 before 고/며/면/
// 지만/다… is the copula and stays (「9시이고」 is right). The first apply run
// wrote 「오후 6시–9시이 가장 한산합니다」 (native review, 11-04).
const VOWEL_END = '';
const KO_PARTICLE = [
  [/^이(?=[\s,.!?;:)\]」』”"'…·]|$)/, '가'], [/^이나(?=[\s,.]|$)/, '나'], [/^이랑/, '랑'],
  [/^은/, '는'], [/^을/, '를'], [/^과/, '와'], [/^으로/, '로'],
];
const fixParticles = (s) => s.replace(new RegExp(`${VOWEL_END}([^${VOWEL_END}]*)`, 'g'), (_, rest) => {
  for (const [re, to] of KO_PARTICLE) if (re.test(rest)) return rest.replace(re, to);
  return rest;
});
// "9am부터 10am까지" and 「7amから10amまで」 are a range too: inside one half of the
// day the second time drops the word, as the translator writes it (「午前N時から
// M時」 731 to 35; 「저녁 5시부터 오후 9시까지」 mixed two words for one evening).
const LINK = { ko: /^ ?(부터|에서) ?$/, ja: /^から$/ };

function convertChunk(text, lang) {
  let prev = null;
  // A text that already holds the marker character would have its own
  // particles "fixed" (Codex, 11-04): then the particle pass stays off.
  const marks = !text.includes(VOWEL_END);
  const done = text.replace(RE, (m, lead, kept, keptSp, h1, m1, mer1, sepL, sep, sepR, h2, m2, mer2, trail, offset, whole) => {
    // Korean puts a space after the word. Chinese and Japanese do not — but a
    // translator that spaced its own word from the number (「早上 6:30」, the
    // pangu style some pages use throughout) keeps that space.
    const sp = lang === 'ko' ? ' ' : kept && keptSp ? keptSp : '';
    // A path segment (/posts/9am/) is not prose either.
    const core = m.slice(lead.length, m.length - trail.length);
    if (whole[offset + lead.length - 1] === '/' && whole[offset + lead.length + core.length] === '/') return m;
    const pm2 = /p/i.test(mer2);
    const x2 = to24(h2, pm2);
    let out;
    if (h1 != null) {
      // The start's own marker, or the end's — "11–1pm" is 11am to 1pm, "10–12pm"
      // 10am to noon, "12–2pm" noon to 2pm, "11–2am" 11pm to 2am.
      const a = Number(h1) % 12, b = Number(h2) % 12;
      const pm1 = mer1 ? /p/i.test(mer1) : Number(h1) === 12 ? pm2 : Number(h2) === 12 || a > b ? !pm2 : pm2;
      const x1 = to24(h1, pm1);
      const clock = lang === 'zh' && [m1, m2].some((mm) => mm && mm !== '00');
      const p = part(x1, m1, lang, kept, { clock }), q = part(x2, m2, lang, null, { clock });
      const one = (r) => r.solo ?? `${r.word}${sp}${r.rest}`;
      // The word is said once only inside one stretch of the day — never across midnight.
      const collapse = !p.solo && !q.solo && x2 > x1 && (sameWord(p.word, q.word) || (kept && p.word === kept && half(x1) === half(x2)));
      const s = lang === 'ko' ? `${sepL}${sep}${sepR}` : sep;
      out = `${one(p)}${s}${collapse ? q.rest : one(q)}`;
    } else {
      const p = part(x2, m2, lang, kept);
      const linked = !kept && prev && !prev.solo && !p.solo && x2 > prev.x && half(x2) === half(prev.x)
        && LINK[lang]?.test(whole.slice(prev.end, offset + lead.length));
      out = p.solo ?? (linked ? p.rest : `${p.word}${sp}${p.rest}`);
      prev = { end: offset + m.length, x: x2, solo: !!p.solo };
    }
    if (h1 != null) prev = null;
    if (lang === 'ko') return `${lead}${out}${marks && /(시|정오)$/.test(out) ? VOWEL_END : ''}${trail}`;
    // Chinese and Japanese put no space between two of their own characters, so
    // a space the English token stood behind goes once 上午/午前 replaces it —
    // only then. A space beside a digit or Latin letter (「早上 6:30–9:00 开门」,
    // the page's own spacing) or after an ASCII colon (YAML's 「a: 7:00 AM」,
    // which broke the file when it went, 11-04) stays — unless the space before
    // went, when one left after 「早上8:30」 would stand alone.
    const before = whole[offset - 1], after = whole[offset + m.length];
    const keepLead = lead && !(cjk(before) && cjk(out[0]));
    const keepTrail = trail && !(cjk(after) && (cjk(out[out.length - 1]) || (lead && !keepLead)));
    return `${keepLead ? lead : ''}${out}${keepTrail ? trail : ''}`;
  });
  return lang === 'ko' && marks ? fixParticles(done) : done;
}

/** Rewrite English clock times ("11am", "9–11am", "7:30am–4pm", "早上8:30am") for `lang`. */
export function localizeClock(text, lang) {
  if (!LANGS.has(lang) || typeof text !== 'string' || !/\d[ ]?[AaPp]\.?[ ]?[Mm]/.test(text)) return text;
  return text
    .split(PROTECTED)
    .map((chunk, i) => (i % 2 ? chunk : convertChunk(chunk, lang)))
    .join('');
}
