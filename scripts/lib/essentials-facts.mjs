// ─────────────────────────────────────────────────────────────
//  STRUCTURED FACTS FOR THE ESSENTIALS PAGE — ONLY WHAT THE GUIDE SAYS
//
//  2026-09-30 redesign (픽서님's "호주 필수정보 개선안"): the page shows visa
//  cards, a transit table, a daily-budget figure, a month-by-region grid and
//  emergency cards. The design tool that drew it said plainly that its season
//  colours and city blurbs were its own invention. This module is what keeps
//  the live page from doing the same: every card is EXTRACTED from the
//  country's own reviewed essentials text, and a card whose numbers or proper
//  names do not appear in that text is dropped, not shown. A dropped card falls
//  back to the prose it came from — the page loses a widget, never a fact.
//
//  Pure functions only (no I/O, no model calls) so the rules are testable.
//  scripts/build-essentials-facts.mjs does the calling and writing.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { numbersIn, unsupportedNumbers, unsupportedNames } from './section-guards.mjs';

export const SUMMARY_KEYS = ['entry', 'money', 'season', 'transport'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Short stable hash of the English guide body — facts are reused only while it matches. */
export function bodyHash(body) {
  return createHash('sha1').update(String(body ?? '').replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12);
}

/** The prose between "## <heading>" and the next "## ", keyed by section order. */
export function sectionsOf(body) {
  const text = String(body ?? '').replace(/\r\n/g, '\n');
  const parts = text.split(/^## /m);
  const lead = parts.shift() ?? '';
  return { lead, sections: parts.map((p) => ({ heading: p.split('\n')[0].trim(), text: p.slice(p.indexOf('\n') + 1) })) };
}

// Every string a card would put on the page.
function stringsOf(value) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object') return Object.values(value).flatMap(stringsOf);
  return [];
}

// Fields that ARE a name — a city, a transit card, a visa, a phone number. The
// shared unsupportedNames check skips a lone capitalised word at the start of a
// sentence (an ordinary word wearing a capital), and a card field is exactly
// that shape: "Perth" and "SmartRider" sailed through as sentence openers
// (test, 2026-09-30). For these fields the whole value must be in the guide.
const NAME_FIELDS = ['name', 'code', 'city', 'card', 'number'];

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100 };
/** The source with every spelled-out number followed by its digits ("three (3)"). */
export function withDigits(source) {
  return String(source ?? '').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|ninety|hundred)\b/gi,
    (w) => `${w} (${NUMBER_WORDS[w.toLowerCase()]})`);
}

/**
 * Every number in `text` as a whole token — commas dropped, decimals kept,
 * leading zeros kept ("000" stays "000"), years INCLUDED. The shared
 * numbersIn skips 1900–2099 as years and unsupportedNumbers matches by
 * substring, so "6 months" passed on a "16 days" and "THB 2,000" on nothing
 * at all (review, 2026-09-30).
 */
export function numberTokens(text) {
  const plain = String(text ?? '').replace(/\]\((https?:\/\/[^)\s]+)\)/g, ']()');
  return [...new Set((plain.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,(?=\d{3}\b)/g, '').replace(/,$/, '')))];
}

/** Numbers in `text` that are not a whole number token of `source`. */
export function unsupportedNumberTokens(text, source) {
  const have = new Set(numberTokens(withDigits(source)));
  return numberTokens(text).filter((n) => !have.has(n));
}

/** Why a card cannot be shown, or null when every number and name is in the source. */
export function unsupportedIn(card, source) {
  if (card && typeof card === 'object') {
    const hay = String(source ?? '').toLowerCase();
    for (const f of NAME_FIELDS) {
      const v = typeof card[f] === 'string' ? card[f].trim() : '';
      if (!v) continue;
      // A phone number must be a whole number in the guide: "11" is inside "112".
      if (f === 'number') {
        const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(?<![\\d])${esc}(?![\\d])`).test(String(source ?? ''))) continue;
        return `number "${v}" not in the guide`;
      }
      if (hay.includes(v.toLowerCase())) continue;
      // A visa route's NAME may be a plain description ("Visa-exempt entry")
      // rather than a proper noun: every word of four letters or more must be
      // in the guide. Cities, cards and phone numbers stay verbatim.
      if (f === 'name') {
        const words = v.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
        if (words.length && words.every((w) => hay.includes(w))) continue;
      }
      return `${f} "${v}" not in the guide`;
    }
  }
  const fields = stringsOf(card);
  // The guide writes "three months" and a card says "3 months" — the same
  // fact; withDigits offers the digits alongside the prose (Australia's ETA
  // card was refused over exactly that, 2026-09-30).
  const nums = unsupportedNumberTokens(fields.join('\n'), source);
  if (nums.length) return `numbers not in the guide: ${nums.join(', ')}`;
  // Fields that name places or people (a season row's region, its places, a
  // visa's "who") get a lowercase word in front so their first word is not
  // excused as a sentence opener: joined bare, a row "Tasmania / Hobart"
  // passed on a guide that names neither (review, 09-30). Headline fields keep
  // the excuse — "Police", "Tap", "Cash" open them as ordinary words.
  // Only on a season row (it carries months) are `label` and `sub` places;
  // elsewhere they are headlines ("Depends on your passport", "Plus a
  // e-Arrival card", "Police, fire, ambulance") whose first word is ordinary.
  const isRow = card && typeof card === 'object' && 'best' in card;
  const STRICT = new Set(['who', ...(isRow ? ['label', 'sub'] : [])]);
  const parts = card && typeof card === 'object' && !Array.isArray(card)
    ? Object.entries(card).filter(([, v]) => typeof v === 'string').map(([k, v]) => (STRICT.has(k) ? `and ${v}` : v))
    : fields;
  // Month names are checked by the month rules, not as proper nouns: "Feb-Apr"
  // is a range, not a name the guide must spell identically.
  const monthWord = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/g;
  const names = unsupportedNames(parts.map((p) => p.replace(monthWord, 'month')).join('\n'), [withDigits(source)]);
  if (names.length) return `names not in the guide: ${names.join(', ')}`;
  return null;
}

/** Months 1-12 → contiguous runs, wrapping December→January ([12,1,2] is one run). */
export function monthRuns(months) {
  const set = [...new Set((months || []).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
  if (!set.length) return [];
  const runs = [];
  let start = set[0], prev = set[0];
  for (const m of set.slice(1)) {
    if (m === prev + 1) { prev = m; continue; }
    runs.push([start, prev]); start = prev = m;
  }
  runs.push([start, prev]);
  if (runs.length > 1 && runs[0][0] === 1 && runs.at(-1)[1] === 12) {
    const first = runs.shift();
    runs[runs.length - 1] = [runs.at(-1)[0], first[1]];
  }
  return runs;
}

/**
 * A month claim is only as good as the words behind it: each run's first and
 * last month must be NAMED in the guide's best-time text ("May to October",
 * "December–February"). A model that turns "shoulder seasons" into a colour
 * for June has nothing to point at, and the row is refused.
 */
export function unsupportedMonths(months, source) {
  const missing = [];
  for (const [a, b] of monthRuns(months)) {
    if (a === b) {
      if (!monthNamed(a, source)) missing.push(MONTHS[a - 1]);
      continue;
    }
    // A run must be written AS a run — "May to October", "December–February",
    // "between November and April". Both ends merely appearing somewhere let
    // "March to May" vouch for May→March, eleven months (review, 2026-09-30).
    // …or with every month in it named ("April, May, September, and October"
    // — Spain). The May→March run still fails: June to February are named
    // nowhere.
    const span = [];
    for (let m = a; ; m = (m % 12) + 1) { span.push(m); if (m === b) break; }
    if (!monthRunNamed(a, b, source) && !span.every((m) => monthNamed(m, source))) missing.push(`${MONTHS[a - 1]}–${MONTHS[b - 1]}`);
  }
  return missing;
}

const monthPattern = (m) => {
  const cap = MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1);
  return `(?:${cap}|${cap.slice(0, 3)}${m === 9 ? '|Sept' : ''})\\.?`;
};
/** Is the run a..b written as a range in `source`? */
export function monthRunNamed(a, b, source) {
  const re = new RegExp(`\\b${monthPattern(a)}\\s*(?:to|through|until|till|and|[–—-])\\s*(?:(?:early|mid|late|the end of)[- ])?${monthPattern(b)}\\b`);
  return re.test(String(source ?? ''));
}

/**
 * Is month `m` NAMED in `source`? Capitalised, as English writes a month:
 * lowercase "may" is the verb ("you may find"), which made "March to May …
 * you may" vouch for an eleven-month run (review, 2026-09-30). Common
 * abbreviations count ("Sept", "Sep", "Oct").
 */
export function monthNamed(m, source) {
  const name = MONTHS[m - 1];
  const cap = name[0].toUpperCase() + name.slice(1);
  const abbr = cap.slice(0, 3);
  const extra = m === 9 ? '|Sept' : '';
  return new RegExp(`\\b(?:${cap}|${abbr}${extra})\\b`).test(String(source ?? ''));
}

/** Month numbers whose English names appear in `text` (for cards that name months in words). */
export function monthsNamedIn(text) {
  return MONTHS.map((_, i) => i + 1).filter((m) => monthNamed(m, text));
}

const clean = (s) => (typeof s === 'string' ? s.trim() : '');

// A list the model sometimes sends as a map ({ entry: {...}, money: {...} })
// or as one bare item. keyed: carry the map key into the item as `key`.
function list(v, keyed = false) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    if (keyed && !('key' in v)) return Object.entries(v).map(([k, x]) => (x && typeof x === 'object' ? { key: k, ...x } : { key: k }));
    return [v];
  }
  return [];
}

/**
 * Tool replies arrive in two wrong shapes as well as the right one: the whole
 * payload nested under a single key ({ facts: {...} } — Australia's first run,
 * 2026-09-30) and objects/arrays serialized as JSON strings. Unwrap both.
 */
export function normalizeToolOutput(out, expectedKeys) {
  const parse = (v) => {
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { return parse(JSON.parse(v)); } catch { return v; } }
    if (Array.isArray(v)) return v.map(parse);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, parse(x)]));
    return v;
  };
  let o = parse(out);
  for (let i = 0; i < 2 && o && typeof o === 'object' && !expectedKeys.some((k) => k in o); i++) {
    const inner = Object.values(o).find((v) => v && typeof v === 'object' && expectedKeys.some((k) => k in v));
    if (!inner) break;
    o = inner;
  }
  return o;
}

/**
 * Validate the model's English extraction against the guide. Returns the
 * facts that survive plus a log of what was dropped and why.
 */
export function vetFacts(raw, body) {
  const { lead, sections } = sectionsOf(body);
  const byKey = {};
  for (const s of sections) {
    const h = s.heading.toLowerCase();
    if (h.startsWith('visa')) byKey.visa = s.text;
    else if (h.startsWith('getting')) byKey.transport = s.text;
    else if (h.startsWith('money')) byKey.money = s.text;
    else if (h.startsWith('best time')) byKey.season = s.text;
    else if (h.startsWith('emergenc')) byKey.emergency = s.text;
  }
  const all = String(body ?? '');
  const dropped = [];
  const keep = (where, card, source) => {
    const why = unsupportedIn(card, source);
    if (why) { dropped.push(`${where}: ${why}`); return false; }
    return true;
  };

  const out = { summary: [], visa: { cards: [], warnings: [] }, transport: { rows: [], tips: [] },
    money: { budget: null, tips: [] }, season: { best: [], rows: [] }, emergency: { numbers: [], chips: [] } };

  for (const key of SUMMARY_KEYS) {
    const c = list(raw?.summary, true).find((x) => x?.key === key);
    if (!c || !clean(c.title)) continue;
    const card = { key, title: clean(c.title), sub: clean(c.sub) };
    if (card.title.length > 28 || card.sub.length > 60) { dropped.push(`summary.${key}: too long for a card`); continue; }
    // Each card against ITS section (plus the quick answer), not the whole
    // guide: "June to August best" passed because "August" was in the
    // emergencies section (review, 2026-09-30). A month a card names must be
    // named in the best-time section.
    const own = { entry: byKey.visa, money: byKey.money, season: byKey.season, transport: byKey.transport }[key] ?? '';
    const named = monthsNamedIn(`${card.title} ${card.sub}`);
    const stray = named.filter((m) => !monthNamed(m, byKey.season ?? ''));
    if (stray.length) { dropped.push(`summary.${key}: months not named in the best-time section (${stray.map((m) => MONTHS[m - 1]).join(', ')})`); continue; }
    if (keep(`summary.${key}`, card, `${own}\n${lead}`)) out.summary.push(card);
  }

  for (const c of list(raw?.visa?.cards).slice(0, 4)) {
    const card = { name: clean(c.name), code: clean(c.code), who: clean(c.who), cost: clean(c.cost), stay: clean(c.stay), note: clean(c.note) };
    if (!card.name) continue;
    // A card cell holds a phrase, not the paragraph it came from. An overlong
    // cell is emptied, not the card: Australia's ETA lost its whole card over
    // a nine-country "who" list (2026-09-30).
    for (const [f, max] of [['cost', 40], ['stay', 40], ['who', 90], ['note', 120]]) {
      if (card[f].length > max) { dropped.push(`visa.${card.name}.${f}: too long for a card cell`); card[f] = ''; }
    }
    if (keep(`visa.${card.name}`, card, byKey.visa ?? '')) out.visa.cards.push(card);
  }
  for (const w of list(raw?.visa?.warnings).slice(0, 3)) {
    const card = { title: clean(w.title), text: clean(w.text) };
    if (card.title && keep(`visa.warning`, card, byKey.visa ?? '')) out.visa.warnings.push(card);
  }

  for (const r of list(raw?.transport?.rows).slice(0, 8)) {
    const row = { city: clean(r.city), card: clean(r.card), contactless: ['yes', 'soon', 'no'].includes(r.contactless) ? r.contactless : '' };
    if (!row.city || !row.card) continue;
    if (keep(`transport.${row.city}`, row, byKey.transport ?? '')) out.transport.rows.push(row);
  }
  // A table of one city is a sentence wearing a table's clothes.
  if (out.transport.rows.length < 2) out.transport.rows = [];
  for (const t of list(raw?.transport?.tips).slice(0, 3)) {
    const card = { title: clean(t.title), text: clean(t.text) };
    if (card.title && keep('transport.tip', card, byKey.transport ?? '')) out.transport.tips.push(card);
  }

  const b = raw?.money?.budget;
  if (b && clean(b.amount)) {
    const card = { amount: clean(b.amount), label: clean(b.label), note: clean(b.note) };
    // The budget is the one figure on the page with nothing else to lean on:
    // it must carry a number, and that number must be in the money section.
    // …and it must be a whole-trip daily budget. Malaysia's "MYR 6 to 12" was
    // the guide's cost of RAIL AND BUS per day; the card showed it as the
    // daily budget, in the page's largest type (review, 2026-09-30). A label
    // that names one spending category is not a budget for the trip.
    const oneCategory = /\b(transport|transit|rail|bus|train|metro|taxi|grab|fuel|meal|meals|food|street food|drink|coffee|beer|hotel|hostel|room|accommodation|sim|data)\b/i;
    if (!numberTokens(card.amount).length) dropped.push('money.budget: no figure');
    else if (oneCategory.test(`${card.label} ${card.amount}`)) dropped.push(`money.budget: a single spending category, not a daily trip budget ("${card.label}")`);
    else if (keep('money.budget', card, byKey.money ?? '')) out.money.budget = card;
  }
  for (const t of list(raw?.money?.tips).slice(0, 4)) {
    const card = { title: clean(t.title), text: clean(t.text) };
    if (card.title && keep('money.tip', card, byKey.money ?? '')) out.money.tips.push(card);
  }

  const seasonText = byKey.season ?? '';
  const best = list(raw?.season?.best).filter((m) => Number.isInteger(m));
  const missBest = unsupportedMonths(best, seasonText);
  if (best.length && !missBest.length) out.season.best = [...new Set(best)].sort((a, b) => a - b);
  else if (best.length) dropped.push(`season.best: months not named in the guide (${missBest.join(', ')})`);
  for (const r of list(raw?.season?.rows).slice(0, 5)) {
    const row = { label: clean(r.label), sub: clean(r.sub), best: list(r.best).filter(Number.isInteger), busy: list(r.busy).filter(Number.isInteger), avoid: list(r.avoid).filter(Number.isInteger) };
    if (!row.label || !row.best.length) continue;
    const miss = [...unsupportedMonths(row.best, seasonText), ...unsupportedMonths(row.busy, seasonText), ...unsupportedMonths(row.avoid, seasonText)];
    if (miss.length) { dropped.push(`season.${row.label}: months not named in the guide (${miss.join(', ')})`); continue; }
    // One state per month; best wins, then busy.
    row.busy = row.busy.filter((m) => !row.best.includes(m));
    row.avoid = row.avoid.filter((m) => !row.best.includes(m) && !row.busy.includes(m));
    // `best` rides along so unsupportedIn knows this label names a place.
    if (keep(`season.${row.label}`, { label: row.label, sub: row.sub, best: row.best }, seasonText)) out.season.rows.push(row);
  }

  for (const n of list(raw?.emergency?.numbers).slice(0, 4)) {
    const card = { number: clean(n.number), label: clean(n.label), note: clean(n.note) };
    if (!card.number) continue;
    if (keep(`emergency.${card.number}`, card, byKey.emergency ?? '')) out.emergency.numbers.push(card);
  }
  for (const c of list(raw?.emergency?.chips).slice(0, 5)) {
    const chip = clean(c);
    if (chip && chip.length <= 40 && keep('emergency.chip', chip, byKey.emergency ?? '')) out.emergency.chips.push(chip);
  }

  return { facts: out, dropped };
}

/**
 * A translated copy of the vetted facts must carry the same shape and the same
 * numbers. Anything else — a dropped card, a "3개월" that became "6개월" — and
 * that language keeps no facts at all (the page shows its prose instead).
 */
export function translationProblems(en, tr) {
  const problems = [];
  // "24/7" is one idea, not the numbers 24 and 7: Korean says 24시간 연중무휴,
  // and the strict set match refused that in five countries (2026-09-30).
  // A brand whose name is a number is a name: 7-Eleven is 세븐일레븐 in Korean.
  const norm = (x) => String(x).replace(/24\s*\/\s*7/g, '24').replace(/\b7[-‑]?(?:Eleven|11)\b|セブン-?イレブン|세븐일레븐|7-ELEVEN/gi, 'SEVENELEVEN');
  const walk = (a, b, path) => {
    if (typeof a === 'string') {
      a = norm(a);
      if (typeof b === 'string') b = norm(b);
      if (typeof b !== 'string' || (a && !b.trim())) { problems.push(`${path}: missing`); return; }
      // Whole-number tokens both ways (years included). Every English number
      // must survive, and the translation may ADD none — "up to 3 months" →
      // "최대 3개월 (연장 시 12개월)" passed the one-way check (review, 09-30).
      // Allowed extras: 1–12, which CJK uses to write month names (3월, 3月).
      // Must survive: the digits English actually WROTE. "six months" may
      // become "seis meses" — only digits are owed. May be added: those digits,
      // spelled-out English numbers now written as digits ("three" → 3개월),
      // and 1–12 for CJK month names.
      const want = numberTokens(a);
      const allowed = numberTokens(withDigits(a));
      const got = numberTokens(b);
      const lost = want.filter((n) => !got.includes(n));
      const added = got.filter((n) => !allowed.includes(n) && !(Number(n) >= 1 && Number(n) <= 12 && /^\d{1,2}$/.test(n)));
      if (lost.length || added.length) problems.push(`${path}: numbers ${want.join(',')} → ${got.join(',')}`);
      return;
    }
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || b.length !== a.length) { problems.push(`${path}: length ${a.length} → ${Array.isArray(b) ? b.length : 'none'}`); return; }
      a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
      return;
    }
    if (a && typeof a === 'object') {
      if (!b || typeof b !== 'object') { problems.push(`${path}: missing`); return; }
      for (const k of Object.keys(a)) walk(a[k], b[k], path ? `${path}.${k}` : k);
    }
  };
  walk(en, tr, '');
  return problems;
}

/**
 * Drop only what a translation got wrong, not the whole language. A problem in
 * a `sub` or `note` blanks that field; anywhere else it removes the list item
 * it sits in — from BOTH copies, so English and translation stay index-aligned
 * for withStructureFrom. Returns null when the problem is structural (a whole
 * section missing or a list of the wrong length): that language keeps no facts.
 *
 * Why (2026-09-30): "2 to 3 million rupiah" → "200만~300만 루피아" and
 * "68°F to 86°F" → "20~30°C" are correct translations the digit check cannot
 * follow, and one such tip threw away all four Turkish pages' cards.
 */
export function pruneProblems(en, tr, problems) {
  const e = structuredClone(en);
  const t = structuredClone(tr);
  const removals = new Map(); // "money.tips" → Set(index)
  for (const p of problems) {
    const path = p.split(':')[0];
    // No list index in the path ("visa: missing", "summary: length 4 → none")
    // means a whole section is wrong — nothing to prune around.
    const m = path.match(/^(.*?)\[(\d+)\](?:\.([a-z]+))?/i);
    if (!m) return null;
    const [, listPath, idx, field] = m;
    if (field === 'sub' || field === 'note') {
      const blank = (o) => { const item = listPath.split('.').reduce((a, k) => a?.[k], o)?.[Number(idx)]; if (item) item[field] = ''; };
      blank(e); blank(t);
    } else {
      if (!removals.has(listPath)) removals.set(listPath, new Set());
      removals.get(listPath).add(Number(idx));
    }
  }
  for (const [listPath, idxs] of removals) {
    for (const o of [e, t]) {
      const keys = listPath.split('.');
      const parent = keys.slice(0, -1).reduce((a, k) => a?.[k], o);
      const last = keys.at(-1);
      if (parent && Array.isArray(parent[last])) parent[last] = parent[last].filter((_, i) => !idxs.has(i));
    }
  }
  return { en: e, tr: t };
}

/** Copy the non-text fields (keys, months, contactless states) from English. */
export function withStructureFrom(en, tr) {
  const out = structuredClone(tr);
  out.summary = en.summary.map((c, i) => ({ ...out.summary?.[i], key: c.key }));
  out.transport.rows = en.transport.rows.map((r, i) => ({ ...out.transport.rows?.[i], contactless: r.contactless }));
  out.season.best = en.season.best;
  out.season.rows = en.season.rows.map((r, i) => ({ ...out.season.rows?.[i], best: r.best, busy: r.busy, avoid: r.avoid }));
  if (en.money.budget === null) out.money.budget = null;
  // A field English left empty stays empty in every language: the translator
  // filling `cost: ""` with "수수료 AUD 50" had nothing to be checked against
  // and would have shown (review, 2026-09-30).
  const blankWhereEmpty = (e, t) => {
    if (!e || !t || typeof e !== 'object') return;
    for (const k of Object.keys(t)) {
      if (e[k] === '' && typeof t[k] === 'string') t[k] = '';
      else if (e[k] && typeof e[k] === 'object') blankWhereEmpty(e[k], t[k]);
    }
  };
  blankWhereEmpty(en, out);
  return out;
}

/** Text-only view (what gets translated and compared): months/states removed. */
export function textView(facts) {
  const v = structuredClone(facts);
  v.summary = v.summary.map(({ title, sub }) => ({ title, sub }));
  v.transport.rows = v.transport.rows.map(({ city, card }) => ({ city, card }));
  delete v.season.best;
  v.season.rows = v.season.rows.map(({ label, sub }) => ({ label, sub }));
  return v;
}
