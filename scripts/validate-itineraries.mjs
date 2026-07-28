// Itinerary accuracy gate. This is the site's #1 rule enforced in code: no wrong
// information reaches an itinerary page. The core checks live in ONE place —
// validateItineraryData() below — used both by this file's CLI (standalone run
// in publish.yml, or against a fixture dir) AND by scripts/build-itineraries.mjs
// (validateItineraryFile(), called on the TEMP file before the atomic rename, so
// a bad regeneration can never replace a good live itinerary). Report/exit-code
// style copied from scripts/validate-content.mjs — print every issue, exit 1 if
// any were found.
//
//   node scripts/validate-itineraries.mjs                       # real content dirs
//   node scripts/validate-itineraries.mjs --fixture=<dir>       # a fixture dir (tests) —
//       <dir> must contain posts/, itineraries/, itineraries-i18n/ subfolders,
//       same layout as src/content/.
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { qualifyingPosts, gateFor } from '../src/lib/itinerary.mjs';
import { findProseViolations } from '../src/lib/prose-guard.mjs';

// Mirrors the TRANSIT_FLAT_MIN / DAY_BUDGET_MIN constants in src/lib/itinerary.mjs
// (not exported from there, so kept in sync by hand). src/lib/itinerary.mjs is the
// source of truth — if those numbers change there, change them here too.
const TRANSIT_FLAT_MIN = 30;
const DAY_BUDGET_MIN = 600;

// Prose-leak patterns (clock times / prices / opening-hours language never
// belong in AI connective prose — the page renders those facts from data,
// never from written text) live in src/lib/prose-guard.mjs, shared with
// scripts/build-itineraries.mjs so the two can never drift apart.
function scanProseLeak(issues, file, field, text) {
  const t = String(text ?? '');
  if (!t) return;
  if (findProseViolations(t).length) {
    issues.push(`PROSE-LEAK: ${file} — ${field}`);
  }
}

// ── round 2 (2026-07-28): structural/factual-consistency checks ────────────
// These catch prose that CONTRADICTS the file's own YAML — no invented facts,
// just prose that no longer agrees with the numbers/structure sitting next to
// it. Built against a real fact-check pass; the defects that motivated each
// check are noted inline.

// --- 1. STOP-COUNT-CLAIM ----------------------------------------------------
// Real defect: bangkok-3-days.md FAQ said "each day is built around four
// stops" while the actual per-day stop counts were 4/3/3 — true for day one
// only, not "each day".
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const NUM_TOKEN = `(?:${Object.keys(NUMBER_WORDS).join('|')}|\\d+)`;
const STOPS_CLAIM_RE = new RegExp(`\\b${NUM_TOKEN}[- ]stops?\\b`, 'gi');
const DAYS_CLAIM_RE = new RegExp(`\\b${NUM_TOKEN}[- ]days?\\b`, 'gi');

function parseNumberToken(tok) {
  if (/^\d+$/.test(tok)) return Number(tok);
  return NUMBER_WORDS[tok.toLowerCase()] ?? null;
}

// Scans title/description/quickAnswer/faq[].a/days[].intro for "N stops" or
// "N days" style claims and checks them against the file's own structure — a
// stops-claim must hold for EVERY day to count as true (a uniform claim), a
// days-claim is checked against d.days.
function checkStopCountClaims(file, d, issues) {
  const days = Array.isArray(d.itinerary) ? d.itinerary : [];
  const dayStopCounts = days.map((day) => (Array.isArray(day?.stops) ? day.stops.length : 0));
  const actualDays = Number(d.days) || days.length;

  const fields = [
    ['title', d.title],
    ['description', d.description],
    ['quickAnswer', d.quickAnswer],
    ...(d.faq || []).map((f, i) => [`faq[${i}].a`, f?.a]),
    ...days.map((day, i) => [`itinerary[${i}].intro`, day?.intro]),
  ];

  const seen = new Set();
  const flagOnce = (key, msg) => { if (!seen.has(key)) { seen.add(key); issues.push(msg); } };

  for (const [field, text] of fields) {
    const t = String(text ?? '');
    if (!t) continue;

    for (const m of t.matchAll(STOPS_CLAIM_RE)) {
      const numTok = /(?:\d+|[a-z]+)/i.exec(m[0])[0];
      const n = parseNumberToken(numTok);
      if (n == null || !dayStopCounts.length) continue;
      if (!dayStopCounts.every((c) => c === n)) {
        flagOnce(`stops:${field}:${m[0]}`, `STOP-COUNT-CLAIM: ${file} — ${field} claims "${m[0].trim()}" but per-day stop counts are [${dayStopCounts.join(', ')}]`);
      }
    }

    for (const m of t.matchAll(DAYS_CLAIM_RE)) {
      const numTok = /(?:\d+|[a-z]+)/i.exec(m[0])[0];
      const n = parseNumberToken(numTok);
      if (n == null) continue;
      if (n !== actualDays) {
        flagOnce(`days:${field}:${m[0]}`, `STOP-COUNT-CLAIM: ${file} — ${field} claims "${m[0].trim()}" but the itinerary has ${actualDays} day(s)`);
      }
    }
  }
}

// --- 2. DURATION-CONTRADICTION ---------------------------------------------
// Real defects: Chatuchak's why said "the several hours budgeted" for a
// 90-minute dwellMin; Cheonggyecheon's why said "hour-long" for a 120-minute
// dwellMin. Small local table — deliberately coarse, this is a contradiction
// check, not a duration parser (src/lib/itinerary.mjs's dwellMinutes() is the
// parser; this only needs to catch prose that flatly disagrees with a number).
function parseDurationClaim(text) {
  const t = String(text || '');
  let m;
  if ((m = /\bhour-long\b/i.exec(t))) return { phrase: m[0], minutes: 60 };
  if ((m = /\ba\s+couple\s+of\s+hours\b/i.exec(t))) return { phrase: m[0], minutes: 120 };
  if ((m = /\bseveral\s+hours\b/i.exec(t))) return { phrase: m[0], minutes: 210 }; // "several" ≥ 180; representative midpoint
  if ((m = /\bhalf(?:\s+a)?[- ]?day\b/i.exec(t))) return { phrase: m[0], minutes: 240 };
  if ((m = /\b(?:a\s+)?quick\s+(?:stop|visit)\b/i.exec(t))) return { phrase: m[0], minutes: 30 };
  if ((m = /\b(\d+(?:\.\d+)?)\s*hours?\b/i.exec(t))) return { phrase: m[0], minutes: Math.round(Number(m[1]) * 60) };
  if ((m = /\b(\d+)\s*-?\s*minutes?\b/i.exec(t))) return { phrase: m[0], minutes: Number(m[1]) };
  return null;
}

// "Differs by more than 50%" measured against the SMALLER of the two figures —
// an exact double (60 vs 120, 90 vs ~180 — both real defects above) reads as a
// 100% difference under this measure, so it's unambiguously caught rather than
// landing exactly on a 50%-of-the-larger-value boundary.
function relativeDurationDiff(claimedMin, dwellMin) {
  const lo = Math.min(claimedMin, dwellMin);
  if (lo <= 0) return Infinity;
  return Math.abs(claimedMin - dwellMin) / lo;
}

function checkDurationContradiction(file, di, s, issues) {
  const claim = parseDurationClaim(s?.why);
  if (!claim) return;
  const dwell = Number(s?.dwellMin);
  if (!Number.isFinite(dwell) || dwell <= 0) return;
  if (relativeDurationDiff(claim.minutes, dwell) > 0.5) {
    issues.push(`DURATION-CONTRADICTION: ${file} — day ${di + 1} stop "${s.slug}" why says "${claim.phrase}" (~${claim.minutes} min) but dwellMin is ${dwell}`);
  }
}

// --- 3 & 4. AREA-CLAIM-UNSUPPORTED / UNIVERSAL-AREA-CLAIM -------------------
// Real defects: tokyo day 1 named an area a stop (Ise Sueyoshi, near
// Roppongi/Omotesando) wasn't actually in; bangkok day 3 claimed to "stay" in
// Sukhumvit/Ekkamai while one stop (Saladaeng, at Silom/Rama IV) was attested
// in neither. Shared candidate-area extraction below is deliberately
// conservative — favors missing a real claim over flagging harmless prose
// (verified against all three real launch-city files while building this).
const AREA_SUFFIX_RE = /\b([A-Z][a-zA-Z]+-(?:dong|gu|ro|gil|cho|ku|jo|machi|ch[oō]me))\b/g;
const AREA_AND_LIST_RE = /\b([A-Z][a-zA-Z]{2,})\s+and\s+([A-Z][a-zA-Z]{2,})(?:'s)?\s+(?:neighbou?rhoods?|districts?|areas?|side)\b/gi;
const AREA_SLASH_PAIR_RE = /\b([A-Z][a-zA-Z]{2,})\/([A-Z][a-zA-Z]{2,})(?:\/([A-Z][a-zA-Z]{2,}))?\b/g;

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).filter(Boolean);
}

// Strips wrapping punctuation and a trailing possessive but KEEPS internal
// hyphens and accented letters — a plain [^A-Za-z] strip mangles real place
// names ("Usadan-ro" -> "Usadanro", "Sensō-ji" -> "Sensji"), which produced
// garbage candidates that could never match anything (a false positive, not a
// real defect). \p{L} is any Unicode letter, so "ō" survives.
function cleanCapWord(raw) {
  let w = String(raw || '').replace(/^[^\p{L}]+/u, '').replace(/[^\p{L}]+$/u, '');
  w = w.replace(/['’]s$/iu, '').replace(/[^\p{L}]+$/u, '');
  return w;
}
const CAP_WORD_RE = /^[A-Z][\p{L}-]+$/u;

function extractAreaCandidates(label, intro) {
  const candidates = new Set();
  const combined = `${label || ''}. ${intro || ''}`;

  for (const m of combined.matchAll(AREA_SUFFIX_RE)) candidates.add(m[1]);
  for (const m of combined.matchAll(AREA_AND_LIST_RE)) { candidates.add(m[1]); candidates.add(m[2]); }
  for (const m of combined.matchAll(AREA_SLASH_PAIR_RE)) {
    candidates.add(m[1]); candidates.add(m[2]);
    if (m[3]) candidates.add(m[3]);
  }

  // Multi-word capitalized phrases (2+ consecutive Capitalized Words), skipping
  // each sentence's first word — that word is almost always "Day"/"This"/"The"/
  // "It's"/a label's opening flourish word, not a place reference.
  for (const sentence of splitSentences(combined)) {
    const words = sentence.split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const w = cleanCapWord(words[i]);
      if (!CAP_WORD_RE.test(w)) continue;
      const phrase = [w];
      let j = i + 1;
      while (j < words.length) {
        const w2 = cleanCapWord(words[j]);
        if (CAP_WORD_RE.test(w2)) { phrase.push(w2); j++; } else break;
      }
      if (phrase.length >= 2) candidates.add(phrase.join(' '));
    }
  }

  return candidates;
}

function filterAreaCandidates(candidates, city, country, stopTitles) {
  const out = new Set();
  const cityWords = new Set(String(city || '').toLowerCase().split(/\s+/).filter(Boolean));
  const countryWords = new Set(String(country || '').toLowerCase().split(/\s+/).filter(Boolean));
  for (const term of candidates) {
    if (!term) continue;
    if (term === city || term === country) continue;
    // A phrase like "Sensō-ji Tokyo" is really just "Sensō-ji, in Tokyo" —
    // drop the city/country word rather than treat the whole phrase as an
    // unattested area claim.
    const words = term.toLowerCase().split(/\s+/);
    if (words.some((w) => cityWords.has(w) || countryWords.has(w))) continue;
    if (stopTitles.some((t) => t.toLowerCase().includes(term.toLowerCase()))) continue;
    out.add(term);
  }
  return out;
}

// The venue's OWN account of its area — address is the hard fact, but a
// post's description/quickAnswer/body are all real, human-legible prose about
// that venue too (e.g. "sit together in Bangkok's Old City near the Chao
// Phraya River" lives in a post's `description` frontmatter field, not its
// markdown body — checking body alone missed it and produced a false
// AREA-CLAIM-UNSUPPORTED on real content).
function attestationText(post) {
  if (!post) return '';
  const d = post.data || {};
  const addr = d.place?.address || '';
  const desc = d.description || '';
  const qa = d.quickAnswer || '';
  const body = post.body || '';
  return `${addr} ${desc} ${qa} ${body}`;
}

// Exact phrase match first; for a genuine multi-word phrase, fall back to "any
// significant (4+ char) word of the phrase appears" — a decorative label like
// "Yoyogi Nights" shouldn't need the literal string "Yoyogi Nights" to appear
// in a post's address to count as supported, just "Yoyogi" somewhere.
function isAttested(term, texts) {
  if (texts.some((t) => t.includes(term))) return true;
  const words = term.split(/\s+/).filter((w) => w.length >= 4);
  if (words.length > 1) return words.some((w) => texts.some((t) => t.includes(w)));
  return false;
}

const UNIVERSAL_AREA_PATTERNS = [
  /\ball (?:in|around|within)\b/i,
  /\bstays? (?:in|inside|east of|west of|north of|south of)\b/i,
  /\bentirely in\b/i,
  /\bthroughout\b/i,
];

// Small connector words a universal-claim phrase commonly has between it and
// the area name ("stays entirely in THE Harborview district").
const UNIVERSAL_CONNECTOR_WORDS = new Set(['the', 'in', 'within', 'around', 'near']);

// check3's general candidate extraction deliberately ignores lone single
// capitalized words (too noisy generally — see extractAreaCandidates). But
// right after a UNIVERSAL claim phrase, a single word IS a high-confidence
// area name ("stays entirely in Harborview") — position, not capitalization
// alone, is the signal here, so this extraction is scoped to check 4 only.
function extractUniversalAreaTerms(text) {
  const terms = new Set();
  for (const pattern of UNIVERSAL_AREA_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    for (const m of text.matchAll(re)) {
      const rest = text.slice(m.index + m[0].length);
      const clause = rest.split(/[.!?]/)[0] || '';
      for (const raw of clause.trim().split(/\s+/)) {
        const w = cleanCapWord(raw);
        if (CAP_WORD_RE.test(w)) { terms.add(w); continue; }
        if (UNIVERSAL_CONNECTOR_WORDS.has(raw.toLowerCase().replace(/[^a-z]/g, ''))) continue;
        break; // first non-connector, non-capitalized word ends the area-name run
      }
    }
  }
  return terms;
}

function checkAreaClaims(file, day, di, postsById, city, country, issues) {
  const stops = Array.isArray(day?.stops) ? day.stops : [];
  const stopPosts = stops.map((s) => ({ slug: s?.slug, post: postsById.get(s?.slug) }));
  const stopTitles = stopPosts.map(({ post }) => post?.data?.title || '').filter(Boolean);
  const candidates = filterAreaCandidates(extractAreaCandidates(day?.label, day?.intro), city, country, stopTitles);

  const resolvedStops = stopPosts.filter(({ post }) => post);
  if (!resolvedStops.length) return; // nothing to check attestation against

  // 3. AREA-CLAIM-UNSUPPORTED — at least ONE stop of the day must attest each candidate.
  if (candidates.size) {
    const allTexts = resolvedStops.map(({ post }) => attestationText(post));
    for (const term of candidates) {
      if (!isAttested(term, allTexts)) {
        issues.push(`AREA-CLAIM-UNSUPPORTED: ${file} — day ${di + 1} names "${term}" but no stop of that day attests it`);
      }
    }
  }

  // 4. UNIVERSAL-AREA-CLAIM — if the day claims to stay entirely within these
  // area(s), EVERY stop (not just one) must attest at least one of them.
  const text = `${day?.label || ''}. ${day?.intro || ''}`;
  if (!UNIVERSAL_AREA_PATTERNS.some((re) => re.test(text))) return;
  const terms = filterAreaCandidates(new Set([...candidates, ...extractUniversalAreaTerms(text)]), city, country, stopTitles);
  if (!terms.size) return;
  for (const { slug, post } of resolvedStops) {
    const stopText = attestationText(post);
    if (![...terms].some((term) => isAttested(term, [stopText]))) {
      issues.push(`UNIVERSAL-AREA-CLAIM: ${file} — day ${di + 1} claims to stay within ${[...terms].join('/')} but stop "${slug}" isn't attested there`);
    }
  }
}

// --- 5. SLOT-TIME-CONFLICT --------------------------------------------------
// Real defects: tokyo's Ise Sueyoshi ("Evening dinner service is the standard
// time slot") was slotted lunch; bangkok's Somsak (bar-club energy, "after
// 9pm") was slotted afternoon.
//
// src/lib/itinerary.mjs DOES export a preferredSlot(post) helper (added for the
// solver's own R2 day-planning heuristic), and the brief for this check said to
// import and reuse it rather than write a second copy. It was tried first here
// — but it matches on the BARE words "evening"/"dinner"/"night" anywhere in a
// post's body, which is right for a soft planning nudge (worst case: a slightly
// suboptimal running order) but wrong for a hard CI gate. Tested against the
// three real launch-city files, it false-positived on the majority of stops —
// e.g. seoul-gwangjang-market's guide recommends going in the MORNING
// specifically to beat "the evening wave of tour groups", which preferredSlot
// reads as an evening-preference signal because it only checks for the word
// "evening", not what the sentence around it says. That's the opposite of
// this check's job (a hard, low-false-positive contradiction gate), so this
// check uses its own narrower patterns instead — the ones actually specified
// for this check (dinner/evening EXCLUSIVITY language, "after Npm", "bar-club"
// energy — not just any mention of an evening activity).
// NOTE on "after Npm": the brief for this check specified /\bafter \d{1,2}
// ?pm\b/i as a fourth evening-only signal (from bangkok-somsak's "bar-club
// energy, especially after 9pm"). Tried as specified — it also matched
// seoul-ikseon-dong ("the bar scene picks up after 7pm on weekend nights",
// describing one evening aspect of a mixed day/night neighbourhood the
// itinerary correctly visits at lunch) and seoul-cheonggyecheon ("joggers use
// the lower path at dawn and after 9pm" — a BOTH-ends-of-day usage note, not
// an evening-only claim). Both are real posts, not fixtures, so this is a
// measured false-positive rate, not a hypothetical. For bangkok-somsak
// specifically the "bar-club" pattern below already fires on the same
// sentence, so dropping "after Npm" loses no real detection from the
// documented defects while removing two confirmed false positives.
const EVENING_ONLY_PATTERNS = [
  /\bdinner\s*(?:only|service is the standard)\b/i,
  /\bevening[- ]only\b/i,
  /\bbar[- ]club\b/i,
];
const MORNING_ONLY_PATTERNS = [
  /\bbreakfast[- ]only\b/i,
  /\bbrunch[- ]only\b/i,
  /\bmorning[- ]only\b/i,
];

function slotSignal(post) {
  const text = `${post?.data?.title || ''} ${post?.body || ''}`;
  if (EVENING_ONLY_PATTERNS.some((re) => re.test(text))) return 'evening';
  if (MORNING_ONLY_PATTERNS.some((re) => re.test(text))) return 'morning';
  return null;
}

function checkSlotTimeConflict(file, di, s, post, issues) {
  if (!post) return;
  const signal = slotSignal(post);
  if (signal === 'evening' && s.slot !== 'evening') {
    issues.push(`SLOT-TIME-CONFLICT: ${file} — day ${di + 1} stop "${s.slug}" reads as evening-only but is slotted "${s.slot}"`);
  } else if (signal === 'morning' && s.slot === 'evening') {
    issues.push(`SLOT-TIME-CONFLICT: ${file} — day ${di + 1} stop "${s.slug}" reads as breakfast/brunch-only but is slotted "evening"`);
  }
}

// --- 6. TRANSIT-MINUTES-PRESENT --------------------------------------------
// The solver sets walkToNext.minutes to null for a transit leg (src/lib/
// itinerary.mjs walkLeg() — "we never estimate actual transit times"). Any
// non-null minutes on a transit leg is a regression reintroducing a walking-
// pace estimate for a subway/ferry hop we can't stand behind.
function checkTransitMinutes(file, di, s, issues) {
  const leg = s?.walkToNext;
  if (leg && leg.transit === true && leg.minutes !== null && leg.minutes !== undefined) {
    issues.push(`TRANSIT-MINUTES-PRESENT: ${file} — day ${di + 1} stop "${s.slug}" walkToNext is transit but minutes=${leg.minutes} (should be null)`);
  }
}

export async function walkMd(dir, rel = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { out.push(...(await walkMd(p, `${rel}${e.name}/`))); continue; }
    if (e.name.endsWith('.md')) out.push({ path: p, rel: `${rel}${e.name}` });
  }
  return out;
}

// Returns {data, body} — body is needed by the area-attestation and
// slot-conflict checks (post prose, not just frontmatter facts).
export async function readPost(path) {
  const raw = await readFile(path, 'utf8');
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;
  let data;
  try {
    data = yaml.load(raw.slice(4, end));
  } catch {
    return null;
  }
  if (!data) return null;
  return { data, body: raw.slice(end + 4).trim() };
}

// Kept for callers that only want the frontmatter (itinerary/i18n files never
// need a body, only posts do).
export async function readFrontmatter(path) {
  const parsed = await readPost(path);
  return parsed ? parsed.data : null;
}

// Loads every post under `dir` into {id, data, body} triples.
export async function loadPostsFrom(dir) {
  const out = [];
  for (const { path, rel } of await walkMd(dir)) {
    const parsed = await readPost(path);
    if (!parsed) continue;
    out.push({ id: rel.replace(/\.md$/, ''), data: parsed.data, body: parsed.body });
  }
  return out;
}

// ── THE core check — pure, no IO. Validates one itinerary's already-parsed
// frontmatter object against a posts index. This is the single implementation
// every caller (CLI sweep below, and build-itineraries.mjs pre-rename gate)
// goes through — there is no second copy of these rules anywhere else.
// `postsById` maps post id -> {id, data, body}; `postsList` is the same posts
// as an array (needed for the packedAvailable recount). ──────────────────────
export function validateItineraryData(file, data, postsById, postsList) {
  const issues = [];
  const d = data || {};

  scanProseLeak(issues, file, 'title', d.title);
  scanProseLeak(issues, file, 'description', d.description);
  scanProseLeak(issues, file, 'quickAnswer', d.quickAnswer);
  (d.faq || []).forEach((f, i) => {
    scanProseLeak(issues, file, `faq[${i}].q`, f?.q);
    scanProseLeak(issues, file, `faq[${i}].a`, f?.a);
  });

  checkStopCountClaims(file, d, issues);

  const days = Array.isArray(d.itinerary) ? d.itinerary : [];
  const seenSlugs = new Set();
  const dupSlugs = new Set();

  days.forEach((day, di) => {
    if (!String(day?.label ?? '').trim()) issues.push(`EMPTY-LABEL: ${file} — day ${di + 1}`);
    if (!String(day?.intro ?? '').trim()) issues.push(`EMPTY-INTRO: ${file} — day ${di + 1}`);
    scanProseLeak(issues, file, `itinerary[${di}].label`, day?.label);
    scanProseLeak(issues, file, `itinerary[${di}].intro`, day?.intro);

    if (postsById) checkAreaClaims(file, day, di, postsById, d.city, d.country, issues);

    const stops = Array.isArray(day?.stops) ? day.stops : [];
    if (stops.length < 3 || stops.length > 5) {
      issues.push(`DAY-STOP-COUNT: ${file} — day ${di + 1} has ${stops.length} stop(s) (need 3-5)`);
    }

    let dayTotalMin = 0;

    stops.forEach((s, si) => {
      const slug = s?.slug;
      if (!slug) { issues.push(`MISSING-SLUG: ${file} — day ${di + 1} stop ${si + 1}`); return; }

      if (seenSlugs.has(slug)) dupSlugs.add(slug);
      seenSlugs.add(slug);

      const post = postsById ? postsById.get(slug) : null;
      if (!post) {
        issues.push(`MISSING-POST: ${file} — stop slug "${slug}" has no matching post`);
      } else {
        const pd = post.data || {};
        if (pd.draft) issues.push(`DRAFT-POST: ${file} — stop slug "${slug}" resolves to a draft post`);
        const pl = pd.place || {};
        if (typeof pl.lat !== 'number' || typeof pl.lng !== 'number') {
          issues.push(`MISSING-COORDS: ${file} — stop slug "${slug}" has no numeric place.lat/lng`);
        }
        if (String(pl.businessStatus || '').startsWith('CLOSED')) {
          issues.push(`CLOSED-VENUE: ${file} — stop slug "${slug}" businessStatus is "${pl.businessStatus}"`);
        }
        if (s.slot === 'lunch' && pd.category !== 'restaurant') {
          issues.push(`LUNCH-NOT-RESTAURANT: ${file} — stop slug "${slug}" (day ${di + 1}) is category "${pd.category}", not restaurant`);
        }
        checkSlotTimeConflict(file, di, s, post, issues);
      }

      if (!String(s?.why ?? '').trim()) issues.push(`EMPTY-WHY: ${file} — day ${di + 1} stop "${slug}"`);
      scanProseLeak(issues, file, `itinerary[${di}].stops[${si}].why`, s?.why);
      checkDurationContradiction(file, di, s, issues);
      checkTransitMinutes(file, di, s, issues);

      dayTotalMin += Number(s?.dwellMin) || 0;
      const leg = s?.walkToNext;
      if (leg) {
        dayTotalMin += leg.transit ? TRANSIT_FLAT_MIN : (Number(leg.minutes) || 0);
        if (leg.transit === false && Number(leg.km) > 2) {
          issues.push(`WALK-TOO-FAR: ${file} — day ${di + 1} stop "${slug}" walkToNext.km=${leg.km} but transit=false (>2km)`);
        }
      }
    });

    if (dayTotalMin > DAY_BUDGET_MIN) {
      issues.push(`DAY-BUDGET-EXCEEDED: ${file} — day ${di + 1} totals ${dayTotalMin} min (budget ${DAY_BUDGET_MIN})`);
    }
  });

  for (const slug of dupSlugs) issues.push(`DUPLICATE-SLUG: ${file} — "${slug}" appears more than once across the itinerary`);

  // packedAvailable is only true if the city's LIVE qualifying count still
  // clears the gate — recounted from posts, never trusted from the frontmatter.
  if (d.packedAvailable && postsList) {
    const cityPosts = postsList.filter((p) => p.data.region === d.city);
    const q = qualifyingPosts(cityPosts);
    if (!gateFor(q.length).packed) {
      issues.push(`PACKED-GATE-FAIL: ${file} — packedAvailable=true but only ${q.length} live qualifying post(s) for "${d.city}" (gate needs 15)`);
    }
  }

  return issues;
}

// Same single-implementation treatment for a translation file — validated
// against its source itinerary's stopsHash plus its own prose-sanity/leak rules.
export function validateI18nEntry(file, data, itById) {
  const issues = [];
  const d = data || {};
  const source = d.slug ? itById.get(d.slug) : null;

  if (!source) {
    issues.push(`ORPHAN-TRANSLATION: ${file} — no source itinerary "${d.slug}"`);
  } else if (d.sourceHash !== source.stopsHash) {
    issues.push(`STALE-TRANSLATION: ${file}`);
  }

  scanProseLeak(issues, file, 'title', d.title);
  scanProseLeak(issues, file, 'description', d.description);
  scanProseLeak(issues, file, 'quickAnswer', d.quickAnswer);
  (d.faq || []).forEach((f, i) => {
    scanProseLeak(issues, file, `faq[${i}].q`, f?.q);
    scanProseLeak(issues, file, `faq[${i}].a`, f?.a);
  });
  (d.days || []).forEach((day, i) => {
    if (!String(day?.label ?? '').trim()) issues.push(`EMPTY-LABEL: ${file} — days[${i}]`);
    if (!String(day?.intro ?? '').trim()) issues.push(`EMPTY-INTRO: ${file} — days[${i}]`);
    scanProseLeak(issues, file, `days[${i}].label`, day?.label);
    scanProseLeak(issues, file, `days[${i}].intro`, day?.intro);
  });
  for (const [slug, why] of Object.entries(d.whys || {})) {
    if (!String(why ?? '').trim()) issues.push(`EMPTY-WHY: ${file} — whys[${slug}]`);
    scanProseLeak(issues, file, `whys[${slug}]`, why);
  }
  for (const [slug, why] of Object.entries(d.rainWhys || {})) scanProseLeak(issues, file, `rainWhys[${slug}]`, why);

  return issues;
}

// ── file-based entry point for scripts/build-itineraries.mjs ───────────────
// Validates a SINGLE itinerary file (typically a not-yet-renamed temp file) and
// returns its issues array (empty = clean). Pass `posts` (an already-loaded
// {id, data, body}[] array, e.g. the city's posts the caller has in memory) to
// avoid re-reading every post off disk; otherwise posts are loaded from
// `postsDir` (defaults to the real src/content/posts/). `label` overrides the
// file label used in issue strings — useful because a temp path looks like
// "seoul-3-days.md.tmp-1234-5678" and the caller usually wants the clean name.
export async function validateItineraryFile(filePath, { posts, postsDir, label } = {}) {
  const postsList = posts || await loadPostsFrom(postsDir || fileURLToPath(new URL('../src/content/posts/', import.meta.url)));
  const postsById = new Map(postsList.map((p) => [p.id, p]));
  const parsed = await readPost(filePath);
  const fileLabel = label || basename(filePath);
  if (!parsed) return [`PARSE-ERROR: could not parse frontmatter in ${fileLabel}`];
  return validateItineraryData(fileLabel, parsed.data, postsById, postsList);
}

// ── CLI ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

async function main() {
  const fixtureArg = process.argv.find((a) => a.startsWith('--fixture='));
  const FIXTURE_DIR = fixtureArg ? fixtureArg.slice('--fixture='.length) : null;
  const ROOT = FIXTURE_DIR
    ? resolve(process.cwd(), FIXTURE_DIR)
    : fileURLToPath(new URL('../src/content/', import.meta.url));

  const postsList = await loadPostsFrom(join(ROOT, 'posts'));
  const postsById = new Map(postsList.map((p) => [p.id, p]));

  const issues = [];

  const itineraries = [];
  for (const { path, rel } of await walkMd(join(ROOT, 'itineraries'))) {
    const parsed = await readPost(path);
    if (!parsed) { issues.push(`PARSE-ERROR: could not parse frontmatter in itineraries/${rel}`); continue; }
    itineraries.push({ id: rel.replace(/\.md$/, ''), file: `itineraries/${rel}`, data: parsed.data });
  }
  for (const it of itineraries) issues.push(...validateItineraryData(it.file, it.data, postsById, postsList));

  const i18nEntries = [];
  for (const { path, rel } of await walkMd(join(ROOT, 'itineraries-i18n'))) {
    const parsed = await readPost(path);
    if (!parsed) { issues.push(`PARSE-ERROR: could not parse frontmatter in itineraries-i18n/${rel}`); continue; }
    i18nEntries.push({ file: `itineraries-i18n/${rel}`, data: parsed.data });
  }
  const itById = new Map(itineraries.map((it) => [it.id, it.data]));
  for (const entry of i18nEntries) issues.push(...validateI18nEntry(entry.file, entry.data, itById));

  if (issues.length) {
    console.log(`❌ ${issues.length} itinerary issue(s) across ${itineraries.length} itinerary file(s) + ${i18nEntries.length} translation file(s):\n`);
    for (const i of issues) console.log(`  • ${i}`);
    process.exit(1);
  }
  if (itineraries.length === 0) {
    console.log('✓ no itinerary files found — nothing to validate yet.');
  } else {
    console.log(`✓ ${itineraries.length} itinerary file(s) + ${i18nEntries.length} translation file(s) clean.`);
  }
}

if (isMain) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
