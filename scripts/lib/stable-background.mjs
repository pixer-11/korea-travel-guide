// Is an "invented-specifics" finding on an event or attraction page only stable
// background — a history date, a capacity, a line-up, a travel time?
//
// 2026-11-01: the weekly editor check reported 1,109 posts, 777 of the findings
// "invented-specifics". Twenty-four of them, drawn at random and checked
// against the web, came back 19 true, 1 false, 4 unverifiable — a church
// "finished in the 1670s", an arena's seat count, a band's members. The
// auditor's own definition is prices, opening hours and menu items, but it
// flagged encyclopedic background the writer is told to use (writer.mjs
// FACTS), and repair-prose's rule for the type is "remove the unverifiable
// detail" — so each week it deleted true facts from up to 60 posts and paid
// for it. The one false sentence (a mall "opened in 2024", really 2021) was a
// recent change, which the writer is now told to leave out unless given.
//
// Deterministic and narrow, like crowd-claim.mjs and record-claim.mjs: only
// event and attraction pages, and only quotes carrying no money, no clock time,
// no menu or stall word and no recent year. Venue pages (restaurants, cafés,
// hidden gems) keep every finding: a dish named on a small business's page is
// the invented-menu case the rule was written for. A year in the last decade
// keeps its finding too — that is where the false sentence came from, and the
// writer is now told to leave such years out (writer.mjs RECENT CHANGES).

const MONEY = new RegExp([
  '[$€£¥₩₫฿₹₱]',
  '\\b(?:usd|eur|thb|vnd|krw|jpy|sgd|aed|myr|hkd|twd|cny|rmb|inr|idr|php|rm|riel|dong|baht|won|yen|yuan|ringgit|rupiah|rupees?|pesos?|dirhams?|lira|kip|kyat|dinars?|riyals?|francs?|dollars?|euros?|pounds?|cents?)\\b',
  '\\b(?:price[sd]?|costs?|fees?|charges?|free|admission|pay|paid|cash|card)\\b',
  // A bare number priced without a currency: "Tickets are 20 per person".
  '\\bper (?:person|adult|child|head|ticket|entry|night|car|vehicle)\\b', '\\btickets? (?:are|cost|start|go|run)\\b',
].join('|'), 'i');
// Any three-letter currency code against a number, either side: "20 SGD",
// "AED 50". Case-sensitive, so "20 min" is not a currency.
const CODE_NEAR_NUMBER = /\d\s?[A-Z]{3}\b|\b[A-Z]{3}\s?\d/;
const CLOCK = new RegExp([
  '\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b',
  '\\b\\d{1,2}[:.]\\d{2}\\b',
  // A bare hour range ("9–5 daily", "from 10 to 18"), unless it is a span of minutes, distance or people.
  '\\b\\d{1,2}\\s*(?:[–-]|to)\\s*\\d{1,2}\\b(?!\\s*(?:min|hour|hr|km|kilomet|met|m\\b|mile|°|%|year|day|week|month|night|people|seat|step|storey|floor|percent))',
  '\\b(?:open|opens|opening|close|closes|closing|shut|shuts|until|midnight|noon)\\b',
  '\\b24\\s*/\\s*7\\b', '\\b24 hours\\b', 'round the clock',
].join('|'), 'i');
const MENU = /\b(?:menu|order|serves?|served|serving|dish|dishes|signature|specialt(?:y|ies)|offers?|sells?|sold|stalls?|vendors?|kiosks?|restaurants?)\b|\bcaf[eé]/i; // \b cannot follow an accented letter

const BACKGROUND_CATEGORIES = new Set(['event', 'attraction']);

/** True when the finding is background the writer was told to state, not a defect. */
export function isStableBackground(quote, category, year = new Date().getUTCFullYear()) {
  if (!BACKGROUND_CATEGORIES.has(category)) return false;
  const q = String(quote || '');
  if (!q.trim()) return false;
  const recent = (q.match(/\b(?:19|20)\d{2}\b/g) || []).some((y) => Number(y) >= year - 10);
  return !recent && !MONEY.test(q) && !CODE_NEAR_NUMBER.test(q) && !CLOCK.test(q) && !MENU.test(q);
}
