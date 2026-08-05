// Content-integrity gate. Run AFTER a publish/discover step: it scans every post
// for the failure modes we've hit before and prints a report. Exit code 1 if any
// issue is found, so the workflow can fire a Telegram warning (the post is already
// committed — this makes a problem loud instead of silently living on the site).
//
//   node scripts/validate-content.mjs
//
// STRUCTURE (2026-08-04): the per-post rules live in the exported, pure
// postProblems() so scripts/validate-content.test.mjs can exercise them without
// a repo full of markdown. Everything that needs to compare posts AGAINST EACH
// OTHER (duplicates, twin events) or read other files (essentials, wall thumbs,
// the refresh cursor) stays in main(). The split exists because this file is the
// most-used checker on the site and had no tests at all: a false positive here
// quarantines a perfectly good post, and nothing would have caught it.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { unsplashNum } from './lib/images.mjs';
import { OFFTOPIC } from './lib/offtopic.mjs';
import { topicKey, FILLER } from './lib/topic-key.mjs';
import { keyToken } from './lib/commons.mjs';
import { clampBusynessHours } from '../src/lib/hours.mjs';

const DIR = fileURLToPath(new URL('../src/content/posts/', import.meta.url));

// A frontmatter date → 'YYYY-MM-DD', whether YAML gave us a quoted string or a
// parsed Date object (unquoted dates; toISOString is safe — YAML timestamps
// without a time are read as UTC midnight).
const isoDay = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : '');

// Non-Latin scripts (Arabic/CJK/Thai/Japanese/Hangul/…) in a title mean Google's
// bilingual place name leaked into the English H1 — generate.mjs strips it now, so
// this catches any that slip through (or old posts).
const NON_LATIN = /[؀-ۿ一-鿿฀-๿぀-ヿ가-힯ༀ-࿿]/;

// The meta description is the page's SERP copy. clip()'s old word-trim fallback
// shipped 414 posts ending mid-clause ("…and best experienced", "…with") before
// the 2026-08-01 repair — a healthy description ends a sentence (terminal
// punctuation, optionally inside a closing quote/paren) with balanced parens.
const DESC_TERMINAL = /[.!?…](['"”’)\]]*)?$/;
const parensBalanced = (s) => (s.match(/[(（]/g) || []).length === (s.match(/[)）]/g) || []).length;

// Tool-call markup spilled into a frontmatter field. ipoh-han-chin-pet-soo
// shipped with its ENTIRE body inside quickAnswer as
// "…</quickAnswer>\n<parameter name=\"body\">You almost walk past it…" — the
// article rendered inside the quick-answer box, the real body was empty, and
// every Korean re-translation of it failed. audit-translations guards the
// translated copies; nothing guarded the English source until this.
const EN_SPILL = /<\/?(description|quickAnswer|title|body|faq|parameter|function_calls|invoke)\b|<parameter\s+name=/i;

// Business-type words are stripped before comparing photo credits to place names,
// because that is exactly how wrong-venue photos hid: "Dallas Pizza" and
// "California Pizza Kitchen" share "pizza", "Sansan Bistro" and "Sugar Bistro"
// share "bistro".
const GENERIC = new Set([
  'the', 'cafe', 'café', 'coffee', 'restaurant', 'bar', 'bistro', 'pizza', 'house',
  'shop', 'store', 'hotel', 'market', 'street', 'food', 'temple', 'museum', 'park',
  'garden', 'palace', 'tower', 'beach', 'thai', 'korean', 'japanese', 'chinese',
  'italian', 'indian', 'grill', 'kitchen', 'bakery', 'lounge', 'club', 'center',
  'centre', 'hall', 'gallery', 'tour', 'tours',
]);
const flat = (v) =>
  String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9가-힣]/g, '');
const words = (v) =>
  (String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9가-힣]{3,}/g) || [])
    .filter((w) => !GENERIC.has(w));

// Price claims the prose states as fact. Kept narrow on purpose: a bare number
// ("open until 6") is not a price, and a currency symbol next to digits or a
// named-currency amount is unambiguous in every locale the site publishes in.
const PRICE_FREE = /\b(free (entry|admission|to enter|of charge)|admission is free|no (entry|admission) fee|entry is free)\b/i;
const PRICE_MONEY = /(?:₩|KRW|\$|US\$|€|£|¥|฿|RM|₱|₫|Rp|S\$|HK\$)\s?\d[\d,.]*|\b\d[\d,]*\s?(?:won|baht|yen|euros?|dollars?|pesos?|ringgit|rupiah|dong)\b/i;
const STALE_PRICE_DAYS = 365;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

/**
 * Read one post file's raw text into the shape every rule below expects.
 * Exported so tests can build a post the same way the real run does.
 * Returns null for anything unparseable or drafted (not on the site).
 */
export function parsePost(f, t) {
  // Parse the YAML frontmatter properly — a regex can't read a `credit: >-` folded
  // scalar or a quoted URL reliably, which produced empty urls → a phantom
  // "DUPLICATE image ×N" (all the empties collapsing to one key).
  let fm;
  try { fm = yaml.load(t.slice(4, t.indexOf('\n---', 3))); } catch { return null; }
  if (!fm) return null;
  if (fm.draft) return null; // unpublished (e.g. quarantined awaiting a real photo) — not on the site
  return {
    f,
    region: fm.region || '',
    category: fm.category || '',
    title: fm.title || '',
    url: (fm.heroImage && fm.heroImage.url) || '',
    credit: (fm.heroImage && fm.heroImage.credit) || '',
    license: (fm.heroImage && fm.heroImage.license) || '',
    placeId: (fm.place && fm.place.id) || '',
    placeName: (fm.place && fm.place.name) || '',
    country: fm.country || '',
    description: fm.description || '',
    quickAnswer: fm.quickAnswer || '',
    // Reader-visible, and serialised into FAQPage schema — so it needs the same
    // scrutiny as the body. It was not exposed here at all until 2026-08-05,
    // which is why the ended-event tense rule could never see it.
    faq: Array.isArray(fm.faq) ? fm.faq : [],
    eventStart: fm.eventStartDate || '',
    eventEnd: fm.eventEndDate || fm.eventStartDate || '',
    gallery: (fm.gallery || []).map((g) => g && g.url).filter(Boolean),
    heroCredit: (fm.heroImage && fm.heroImage.credit) || '',
    rating: (fm.place && fm.place.rating) || 0,
    phone: (fm.place && fm.place.phone) || '',
    busyness: (fm.place && fm.place.busyness) || null,
    openingHours: (fm.place && fm.place.openingHours) || null,
    // Unquoted YAML dates arrive as Date OBJECTS; String() on those gives
    // "Tue Jul 21 2026 …", whose first 10 chars re-parse as the year 2001 —
    // which made 84 fresh posts look 25 years stale on this check's first run.
    pubDate: isoDay(fm.pubDate),
    updatedDate: isoDay(fm.updatedDate),
    body: t.slice(t.indexOf(String.fromCharCode(10) + "---", 3) + 4),
  };
}

/**
 * Every rule that judges ONE post on its own. Pure: same post in, same list out.
 * `today` is injectable so the ended-event rule is testable and can't quietly
 * change behaviour as the calendar moves.
 */
export function postProblems(p, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const issues = [];

  if (p.region.includes('/')) issues.push(`SLASH in region "${p.region}" — breaks /regions route: ${p.f}`);
  const d = p.description.trim();
  if (d && (!DESC_TERMINAL.test(d) || !parensBalanced(d))) {
    issues.push(`TRUNCATED-DESCRIPTION: ${p.f} — ends "…${d.slice(-50)}"`);
  }
  for (const [field, v] of [['description', p.description], ['quickAnswer', p.quickAnswer], ['title', p.title]]) {
    if (EN_SPILL.test(v)) issues.push(`TOOL-SPILL in ${field}: ${p.f} — "${v.match(EN_SPILL)[0]}"`);
  }
  if (!p.url || p.url.includes('placeholder')) issues.push(`PLACEHOLDER/no image [${p.category}]: ${p.f}`);
  if (NON_LATIN.test(p.title)) issues.push(`NON-LATIN script in title "${p.title.slice(0, 40)}…": ${p.f}`);
  if ((p.title.match(/\//g) || []).length >= 2) issues.push(`QUERY-LIKE title (multiple "/"): ${p.f}`);
  // "A Visitor's Guide" filler was stripped site-wide (backfill-titles.mjs) and
  // generate.mjs builds titles via lib/titles.mjs which never adds it — so ANY
  // occurrence means the title rule regressed. Also flag a city echoed twice
  // ("… Abu Dhabi: … in Abu Dhabi"), which the de-echo in makeTitle prevents.
  if (/:\s*A Visitor'?s Guide/i.test(p.title)) issues.push(`FILLER "A Visitor's Guide" in title (title-rule regression): ${p.f}`);
  // Catch a city echo that WE introduced in the suffix — i.e. the city appears in
  // both the name half (before ": ") and again in the suffix half. A city that's
  // repeated only inside the raw place name (e.g. "Gyukatsu Kyoto Katsugyu Kyoto")
  // is Google's data, not ours, so it's excluded.
  if (p.region && p.category !== 'event' && p.title.includes(': ')) {
    const reg = new RegExp(`\\b${p.region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const [head, ...rest] = p.title.split(': ');
    const tail = rest.join(': ');
    if (reg.test(head) && reg.test(tail)) issues.push(`CITY echoed in name + suffix ("${p.region}"): ${p.f}`);
  }

  // Obvious hero-image MISMATCHES: a keyword-collision Wikimedia file whose subject
  // is clearly unrelated to a venue. These are exactly the failures the 2026-07-24
  // image audit found (a restaurant showing a moth specimen / a dune-bashing car /
  // US-Navy admirals / a British-Museum statue / an antique print / a foreign
  // geograph shot). Flag every Wikimedia hero that hits the off-topic blocklist so
  // a new post with one gets caught at publish time instead of living on the site.
  if (p.url && p.license === 'wikimedia') {
    const hay = decodeURIComponent(p.url) + ' ' + p.credit;
    if (OFFTOPIC.test(hay)) {
      const fileName = (decodeURIComponent(p.url).split('/').pop() || '').replace(/\.(jpg|jpeg|png|svg).*$/i, '').slice(0, 48);
      issues.push(`IMAGE MISMATCH suspect [${p.category}] "${p.region}" — off-topic hero (${fileName}): ${p.f}`);
    }
  }

  // A title left dangling on a connector — the de-echo rule stripped the city out of
  // "Classical Gardens of Suzhou" and shipped "Classical Gardens of: Suzhou …".
  if (/\b(of|the|de|du|des|at|in|on|and|for|el|la|le|les)\s*:\s/i.test(p.title) || /[&@+\-–—/]\s*:\s/.test(p.title)) {
    issues.push(`BROKEN TITLE (dangling connector before ":"): ${p.f} — "${p.title}"`);
  }

  // A place.name that is really a leftover search-tag dump ("x / y restaurant / z vegan /")
  // renders in the fact box AND the schema.
  if (p.placeName && (p.placeName.split('/').length > 2 || p.placeName.length > 90)) {
    issues.push(`GARBLED place.name (looks like a search-query dump): ${p.f} — "${p.placeName.slice(0, 70)}…"`);
  }

  // An event with no machine-readable start date can't sort, expire, or emit Event
  // schema — the date is usually sitting in the prose.
  if (p.category === 'event' && !p.eventStart) issues.push(`EVENT missing eventStartDate: ${p.f}`);
  // 35 Korean posts shipped with no country at all. Nothing crashed — the field
  // just read `undefined`, so they were skipped by the climate backfill, missing
  // from country hubs, and the Instagram card printed "Busan, undefined".
  if (!p.country) issues.push(`MISSING-COUNTRY: ${p.f} — dropped from country hubs, facts and social cards`);
  // A finished event still promising "tickets go on sale" or "the lineup will be
  // announced" reads as a live listing to anyone who lands on it from search.
  // The page already carries an "event ended" label, but the PROSE has to agree.
  // Deliberately narrow: only phrases that promise a FUTURE act of the event
  // itself. Descriptive futures ("street circuits mean the cars will run through
  // the city") are timeless and must not be flagged — checked 2026-08-04, all 11
  // ended events were clean and this rule stayed quiet on them.
  // Two blind spots, both found live on 2026-08-05 while this rule reported zero:
  //  · it read ONLY p.body, so the Quick Answer box and the FAQ — the two most
  //    prominent surfaces, and the FAQ is also serialised into FAQPage schema —
  //    were never examined. 9 of 11 ended events were carrying future-tense text
  //    in one of them.
  //  · the four phrases missed the commonest shapes: "once released", "closer to
  //    the event", "haven't been confirmed", "expect the lineup to drop".
  // Still deliberately narrow: it must promise a FUTURE act OF THE EVENT. A
  // timeless descriptive future ("street circuits mean the cars will run through
  // the city") is not flagged.
  if (p.category === 'event' && p.eventEnd && isoDay(p.eventEnd) < today) {
    const FUTURE_PROMISE = /\b(tickets\s+(?:go|will go)\s+on\s+sale|(?:the\s+)?(?:full\s+)?lineup\s+(?:will|has yet to|have yet to)\b|will\s+be\s+(?:announced|confirmed|revealed|published|released)|is\s+expected\s+to\s+be\s+(?:announced|confirmed)|once\s+(?:released|published|announced|confirmed|they'?re?\s+released)|closer\s+to\s+the\s+(?:event|date|festival|show)|(?:haven'?t|hasn'?t|weren'?t|wasn'?t)\s+been\s+(?:announced|confirmed|released)|yet\s+to\s+be\s+(?:announced|confirmed|released)|expect\s+(?:the\s+)?(?:full\s+)?(?:lineup|set times|schedule)[^.]{0,40}\bto\s+drop\b)/i;
    // Every reader-visible prose surface, not just the body.
    const surfaces = [
      ['prose', p.body],
      ['quickAnswer', p.quickAnswer],
      // ANSWERS only. A question may legitimately be phrased forward ("Where do
      // tickets go on sale?") — it is the answer that must not promise a future
      // act. Including questions flagged seoul-stray-kids-concert, whose answer
      // is a timeless "K-pop shows typically sell through Interpark or Yes24".
      ['FAQ', Array.isArray(p.faq) ? p.faq.map((x) => x?.a ?? '').join(' ') : ''],
    ];
    for (const [where, text] of surfaces) {
      const m = String(text || '').match(FUTURE_PROMISE);
      if (m) {
        issues.push(`ENDED-EVENT-FUTURE-TENSE: ${p.f} — ended ${isoDay(p.eventEnd)} but the ${where} still says "${m[0]}"`);
        break;
      }
    }
  }

  // A rating written into the prose freezes at the moment it was written, while the
  // fact box on the same page keeps being refreshed from Google. Gwangjang Market
  // shipped "a 4.3 rating" above a box reading 4.2. Prose should characterise and
  // leave the live number to the box — the writer prompt now says so — but an older
  // post can still drift when Google updates its figure.
  if (p.rating && p.body) {
    const m = p.body.match(/\b([1-5]\.\d)\s*(?:\/\s*5\b|rating|stars?|점)/i);
    if (m && Math.abs(parseFloat(m[1]) - p.rating) >= 0.05) {
      issues.push(`STALE-RATING: ${p.f} — prose says ${m[1]}, live data says ${p.rating}`);
    }
  }

  // tel: links dial what the phone field holds, and the site's core reader is on
  // a FOREIGN SIM — a national-format number ("054-853-0109") fails the moment
  // they tap it abroad. 236 posts shipped that way because the Details fetch
  // preferred nationalPhoneNumber. places.mjs is now international-first and
  // repair-phone-international.mjs converted the backlog; this keeps it that way.
  if (p.phone && !String(p.phone).trim().startsWith('+')) {
    issues.push(`LOCAL-PHONE: ${p.f} — "${p.phone}" has no +country-code, tel: link fails from a foreign SIM`);
  }

  // Stored quiet/busy hours outside the venue's own opening hours: BestTime
  // measures the pavement, not the business, so unclamped data advertised
  // "weekend quiet: 6–7 PM" beside a fact box closing at 6 on 57 live pages.
  // Every write path clamps now (generate, backfill-busyness, the hours
  // backfill); this catches any new path that forgets.
  if (p.busyness) {
    const res = clampBusynessHours(p.busyness, p.openingHours);
    if (res?.changed) {
      issues.push(`BUSYNESS-OUTSIDE-HOURS: ${p.f} — quiet/busy hours fall outside opening hours (run scripts/repair-busyness-hours.mjs --apply)`);
    }
  }

  // A Foursquare photo whose credit names a DIFFERENT business than the article.
  // The vision gate cannot catch this: a real photo of a real café IS a plausible
  // café, so a picture of California Pizza Kitchen passes on a Dallas Pizza post.
  // Only the credit line knows, and nothing was reading it — four posts shipped
  // that way, including a Thai massage parlour illustrating a restaurant.
  if (p.placeName && /foursquare/i.test(p.credit)) {
    const credited = (p.heroCredit.match(/\(([^)]+)\)/) || [])[1];
    if (credited) {
      const a = flat(p.placeName), b = flat(credited);
      const sameName = a.includes(b) || b.includes(a);            // same name, different spelling
      const mine = words(p.placeName), theirs = new Set(words(credited));
      const properNounMatch = mine.length && mine.some((w) => theirs.has(w));
      if (!sameName && !properNounMatch) {
        issues.push(`PHOTO-WRONG-VENUE: ${p.f} — post is "${p.placeName}", photo credits "${credited}"`);
      }
    }
  }

  // A price the site states as fact goes stale silently — a temple that started
  // charging admission, an 80-baht plate that is now 120. Every page already
  // carries the "details can change, verify before visiting" disclosure
  // (ui.ts post.disclosureBody), so this is not about hedging the wording; it is
  // about the FIGURE aging out. 63 live posts name a price or promise free
  // entry, and the weekly refresh rotation only re-checks Google's fields — it
  // never re-reads the prose. The window is deliberately long: a claim six
  // months old is normal travel-guide practice, one past a year is a guess.
  // Silent today by construction (the oldest post is weeks old) — it arms
  // itself as the site ages, which is the point.
  if (p.body && (PRICE_FREE.test(p.body) || PRICE_MONEY.test(p.body))) {
    const last = p.updatedDate || p.pubDate;
    if (last && daysBetween(last, today) > STALE_PRICE_DAYS) {
      const claim = (p.body.match(PRICE_FREE) || p.body.match(PRICE_MONEY))[0];
      issues.push(`STALE-PRICE-CLAIM: ${p.f} — "${claim}" unverified since ${last} (>${STALE_PRICE_DAYS} days)`);
    }
  }

  // A post whose in-body photo IS its hero shows the same picture twice. The rule
  // is two DIFFERENT photos, or one — never the same one billed as two. The
  // cross-post check compares heroes BETWEEN posts, so it was structurally
  // blind to this: 17 posts shipped that way, most created by the alt-source hero
  // swap choosing an image that was already sitting in the gallery.
  if (p.url && p.gallery.includes(p.url)) {
    issues.push(`SAME-PHOTO-TWICE: ${p.f} — the in-body photo is the hero image`);
  }

  return issues;
}

/**
 * Cross-checks the posts against the vision audit's verdict store.
 *
 * Found the hard way on 2026-08-04: chiang-mai-the-baristro-asian-style had
 * been judged MISMATCH ("레스토랑이 아닌 뷰티 제품 진열") at 12:46 on 08-03 and
 * was still live a day later. visual-audit only started quarantining on the
 * spot later that same day, so this verdict landed in the window where a
 * MISMATCH was recorded and nothing acted on it — and the 04:35 patrol only
 * repairs posts that are already drafts, so no routine could ever reach it.
 * A known-wrong photo sitting published is the exact failure the whole photo
 * pipeline exists to prevent, and nothing was checking for the gap between
 * "we know" and "we did something".
 *
 * Pure, so the rules can be tested without a repo or an audit file.
 */
export function photoVerificationProblems(posts, store, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const issues = [];
  const SEP = String.fromCharCode(1); // visual-audit joins slug and url with it
  const VENUE = new Set(['restaurant', 'trendy', 'hidden-gem', 'attraction']);
  const unverified = [];
  for (const p of posts) {
    if (!VENUE.has(p.category) || !p.url) continue;
    const v = store[`${p.f.replace(/\.md$/, '')}${SEP}${p.url}`];
    if (v && /MISMATCH/.test(String(v.verdict))) {
      issues.push(`UNQUARANTINED-MISMATCH: ${p.f} — photo judged wrong on ${String(v.at).slice(0, 10)} (${v.reasonKo || v.reason || '?'}) but the post is still published`);
      continue;
    }
    // A brand-new post is legitimately unjudged until that night's audit runs;
    // one still unjudged days later means the audit is not reaching it.
    if (!v) {
      const age = daysBetween(p.updatedDate || p.pubDate, today);
      if (Number.isFinite(age) && age > 3) unverified.push({ f: p.f, age });
    }
  }
  for (const u of unverified.slice(0, 5)) {
    issues.push(`UNVERIFIED-PHOTO: ${u.f} — published ${u.age} days ago and its hero has never been through the vision check`);
  }
  if (unverified.length > 5) {
    issues.push(`UNVERIFIED-PHOTO: "${unverified.length}건" total — the visual audit is not keeping up (check the 21:40 run)`);
  }
  return issues;
}

async function main() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.md'));
  const posts = [];
  for (const f of files) {
    const p = parsePost(f, await readFile(join(DIR, f), 'utf8'));
    if (p) posts.push(p);
  }

  const issues = [];
  const dupBy = (keyFn, label) => {
    const m = new Map();
    for (const p of posts) { const k = keyFn(p); if (!k) continue; (m.get(k) || m.set(k, []).get(k)).push(p); }
    for (const [k, ps] of m) if (ps.length > 1) issues.push(`${label} ×${ps.length}: ${ps.map((p) => p.f).join(', ')}`);
  };

  for (const p of posts) issues.push(...postProblems(p));

  // Two posts about the same event on the same date in the same city = duplicate
  // coverage, and if their dates DISAGREE one of them is telling readers a lie.
  {
    // Anchored, not title-token-equal. ELEVEN live pairs — the same MAMAMOO show,
    // the same MotoGP round, the same Vuelta — slipped the old check, because
    // each twin was discovered days apart under different phrasing ("Manila
    // Stop" vs "2026 World Tour") and their sorted tokens never matched. The
    // act's anchor word, the country, and overlapping dates identify an event no
    // matter how the discovery run phrased it that day.
    const evs = posts.filter((p) => p.category === 'event' && p.eventStart);
    const near = (a, b) => Math.abs(new Date(a) - new Date(b)) <= 3 * 864e5;
    for (let i = 0; i < evs.length; i++) {
      for (let j = i + 1; j < evs.length; j++) {
        const a = evs[i], b = evs[j];
        const anchor = keyToken(a.title);
        if (!anchor || anchor !== keyToken(b.title) || a.country !== b.country) continue;
        const overlap = near(a.eventStart, b.eventStart) || (String(a.eventStart) <= String(b.eventEnd) && String(b.eventStart) <= String(a.eventEnd));
        if (!overlap) continue;
        const sameDates = String(a.eventStart) === String(b.eventStart) && String(a.eventEnd) === String(b.eventEnd);
        issues.push(sameDates
          ? `DUPLICATE event coverage (${anchor}): ${a.f}, ${b.f}`
          : `CONTRADICTORY event dates (${anchor}, ${a.eventStart}~${a.eventEnd} vs ${b.eventStart}~${b.eventEnd}): ${a.f}, ${b.f}`);
      }
    }
  }
  dupBy((p) => (p.url && !p.url.includes('placeholder') ? unsplashNum(p.url) || p.url : ''), 'DUPLICATE image');
  dupBy((p) => p.placeId, 'DUPLICATE place.id');

  // The gap between "the vision audit knows this photo is wrong" and "the post
  // came down". See photoVerificationProblems.
  try {
    const store = JSON.parse(
      await readFile(fileURLToPath(new URL('../data/visual-audit.json', import.meta.url)), 'utf8')
    );
    issues.push(...photoVerificationProblems(posts, store));
  } catch { /* no audit file yet — nothing to cross-check */ }

  // Placeholder text that reached readers. "undefined" got into 10 region entries
  // as String(undefined) and rendered in the visible intro, the meta description
  // and the FAQPage structured data on 11 live pages, because the components fall
  // back with `??` and a non-empty string is not nullish. Generated copy is checked
  // here rather than trusted, since nothing else reads these files before a build.
  try {
    const regionsPath = fileURLToPath(new URL('../src/i18n/regions.json', import.meta.url));
    const regions = JSON.parse(await readFile(regionsPath, 'utf8'));
    const BAD = /^(undefined|null|n\/a|tbd|todo)$/i;
    for (const [region, langs] of Object.entries(regions)) {
      for (const [lang, fields] of Object.entries(langs || {})) {
        if (!fields || typeof fields !== 'object') continue;
        for (const [field, value] of Object.entries(fields)) {
          if (typeof value === 'string' && (BAD.test(value.trim()) || !value.trim())) {
            issues.push(`PLACEHOLDER-TEXT: regions.json ${region}/${lang}.${field} = "${value}"`);
          }
        }
      }
    }
  } catch { /* file absent in a partial checkout — not this check's business */ }

  // Only for posts WITHOUT a place.id (events/placeless) — venue posts are already
  // de-duped by place.id above, and non-ASCII venue names (Vietnamese/Korean) would
  // otherwise collapse to just the city and false-positive.
  dupBy((p) => (!p.placeId ? topicKey(p.title, p.region) : ''), 'DUPLICATE topic (near-identical post)');

  // Essentials completeness — each non-draft country guide must carry all 6 H2
  // sections. A truncated guide (the max_tokens bug) is worse than none: the topic
  // hubs advertise these countries and a half-written page erodes trust + E-E-A-T.
  const ESS_DIR = fileURLToPath(new URL('../src/content/essentials/', import.meta.url));
  const REQUIRED_ESS = [
    '## Visa & entry', '## Getting around', '## Money & costs',
    '## Best time to visit', '## Emergencies & safety', '## Official sources',
  ];
  let essCount = 0;
  for (const f of (await readdir(ESS_DIR)).filter((f) => f.endsWith('.md'))) {
    const t = await readFile(join(ESS_DIR, f), 'utf8');
    if (/^draft:\s*true/m.test(t)) continue;
    essCount++;
    const miss = REQUIRED_ESS.filter((h) => !t.includes(h));
    if (miss.length) issues.push(`ESSENTIALS ${f} incomplete — missing: ${miss.join(', ')}`);
  }

  // Wall-thumb coverage — the crowd tool + region tiles render a BLANK card when
  // a hero's self-hosted 640px thumb is missing (hero replaced without running
  // build-wall; user caught 20+ blank cards live). Alarm on any gap.
  {
    const { createHash } = await import('node:crypto');
    const { existsSync } = await import('node:fs');
    const wallDir = fileURLToPath(new URL('../public/wall/', import.meta.url));
    let missing = 0;
    for (const p of posts) {
      if (!p.url || p.url.includes('placeholder')) continue;
      const name = createHash('sha1').update(p.url).digest('hex').slice(0, 16) + '.webp';
      if (!existsSync(join(wallDir, name))) { missing++; if (missing <= 5) issues.push(`WALL THUMB missing for ${p.f} — card renders blank (run scripts/build-wall.mjs)`); }
    }
    if (missing > 5) issues.push(`WALL THUMB missing on ${missing} post(s) total — run scripts/build-wall.mjs`);
  }

  // Re-check watchdog. The weekly refresh job rotates oldest-checked-first through
  // every place.id post (data/refresh-cursor.json records when). Before the cursor
  // existed the rotation restarted alphabetically every week, so posts m–z were
  // NEVER re-checked and a closed venue could sit live indefinitely. 480 posts at
  // 40/week is an ~84-day cycle; 120 days means the rotation has genuinely stalled
  // (cursor not advancing, workflow dead, or quota starving it) — not merely "your
  // turn hasn't come yet". Posts the cursor hasn't reached fall back to their own
  // updatedDate/pubDate, so a fresh site stays quiet and the alarm arms over time.
  {
    let cursorChecked = {};
    try {
      cursorChecked = JSON.parse(
        await readFile(fileURLToPath(new URL('../data/refresh-cursor.json', import.meta.url)), 'utf8')
      )?.checked ?? {};
    } catch { /* no cursor yet — fall back to post dates below */ }
    const STALE_RECHECK_DAYS = 120;
    const cutoff = Date.now() - STALE_RECHECK_DAYS * 864e5;
    const stale = [];
    for (const p of posts) {
      if (!p.placeId) continue;
      const last = cursorChecked[p.f] || p.updatedDate || p.pubDate;
      if (last && new Date(last).getTime() < cutoff) stale.push({ f: p.f, last });
    }
    for (const s of stale.slice(0, 5)) {
      issues.push(`STALE-RECHECK: ${s.f} — venue data not re-checked since ${s.last} (>${STALE_RECHECK_DAYS} days; weekly refresh rotation may be stuck)`);
    }
    // The count is quoted so the Korean rendering keeps it (facts() reads quotes).
    if (stale.length > 5) issues.push(`STALE-RECHECK: "${stale.length}건" overdue in total — check data/refresh-cursor.json and the refresh workflow`);
  }

  // Unescaped tilde gate — ALL collections. CJK ranges ("4~5월") are GFM
  // strikethrough markers; a pair struck out whole paragraphs on 308 posts once and
  // then again on essentials translations because the first fix was posts-only.
  // This walks EVERY content dir so no future collection can regress silently.
  const CONTENT_ROOT = fileURLToPath(new URL('../src/content/', import.meta.url));
  async function tildeWalk(dir, rel = '') {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { await tildeWalk(p, `${rel}${e.name}/`); continue; }
      if (!e.name.endsWith('.md')) continue;
      const raw = await readFile(p, 'utf8');
      const fmEnd = raw.indexOf('\n---', 3);
      const body = fmEnd === -1 ? raw : raw.slice(fmEnd + 4);
      if (/(^|[^\\])~/.test(body)) issues.push(`TILDE unescaped in ${rel}${e.name} body — renders as strikethrough (escape as \\~)`);
      // The writer's own transition line — "Now I have enough information to
      // write the guide." — shipped as the first paragraph of ten essentials
      // pages in five languages (2026-08-01): a web-search run interleaves
      // working notes between tool calls, and build-essentials joined every
      // text block. The generator now strips it at the source; this catches
      // any future leak the moment it lands in ANY collection, ANY language.
      const firstLine = body.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
      if (/^(Now I\b|I now\b|I have (all|enough|sufficient)\b)|충분한 정보|정보가 모였|정보를 확보|작성할 준비가|十分な情報|ガイドを作成します|información suficiente|Ya contamos con|Ahora cuento con|足够的信息|掌握了足够/.test(firstLine)) {
        issues.push(`LLM-NOTE leaked in ${rel}${e.name} — first body line is the writer talking to itself`);
      }
    }
  }
  await tildeWalk(CONTENT_ROOT);

  if (issues.length) {
    console.log(`❌ ${issues.length} content issue(s) across ${posts.length} posts + ${essCount} essentials:\n`);
    for (const i of issues) console.log(`  • ${i}`);
    process.exit(1);
  }
  console.log(`✓ ${posts.length} posts clean — no slash regions, placeholders, dup images, dup places, or near-dup topics.`);
}

// ── CLI (only when executed directly, not when imported) ─────
if (process.argv[1]?.endsWith('validate-content.mjs')) await main();
