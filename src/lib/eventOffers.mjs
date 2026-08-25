// ─────────────────────────────────────────────────────────────
//  What may be stored as an Event's offer and performer.
//
//  Two callers need the identical rule and must not drift apart: the
//  discovery search that writes new event posts (scripts/discover-events.mjs)
//  and the backfill that fills in the older ones
//  (scripts/backfill-event-offers.mjs). The organizer field learned this the
//  hard way — its rule lived in two prompts and only one of them said "never
//  guess" — so the judgement lives here, once, with tests.
//
//  The governing principle is the same one that removed our fake organizers
//  on 2026-08-07: an absent optional property is worth strictly more than a
//  wrong one. Everything below is a reason to store NOTHING.
// ─────────────────────────────────────────────────────────────

// Secondary-market sellers. Not the event's own offer, and half of them are
// dead links or scalper listings a year later.
const RESELLER = /viagogo|stubhub|seatgeek|vividseats|ticketswap|gigsberg|tickpick/i;
// Aggregators, guides and listings — someone else's sales funnel, not the
// organiser's. (Our own affiliate partners included: an offer must point at
// the event, not at us.)
const NOT_AN_OFFER = /tripadvisor|klook|getyourguide|viator|wikipedia|facebook\.com|instagram\.com|wanderatlasguides\.com/i;

/**
 * The stored `eventOffers` object, or null when nothing is verifiable.
 * @param {{url?: unknown, free?: unknown, currency?: unknown}} raw
 */
export function normalizeOffer(raw = {}) {
  /** @type {{url?: string, free?: boolean, currency?: string}} */
  const out = {};
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  // https only: an http ticket page in 2026 is either dead or not the official one.
  if (/^https:\/\/[^\s"'<>]+$/.test(url) && !RESELLER.test(url) && !NOT_AN_OFFER.test(url)) {
    out.url = url;
  }
  if (raw.free === true) {
    const cur = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : '';
    // schema.org needs a currency alongside price 0. Without one, "free"
    // cannot be stated in structured data at all — so it is not stated.
    if (/^[A-Z]{3}$/.test(cur)) { out.free = true; out.currency = cur; }
  }
  return out.url || out.free ? out : null;
}

/**
 * The stored `eventPerformer`, or null.
 * Only a named act performing as itself. A festival line-up is never stored:
 * the line-up changes every edition while the page stays up, so saving one
 * turns a true fact into a false one with no edit at all.
 * @param {{name?: unknown, kind?: unknown}} raw
 */
export function normalizePerformer(raw = {}) {
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const kind = raw.kind === 'person' || raw.kind === 'group' ? raw.kind : null;
  if (!name || !kind) return null;
  if (name.length > 80) return null;
  // Words that mean the model described a line-up instead of naming an act.
  if (/various|multiple|line-?up|artists|and more|tba|tbd|unknown/i.test(name)) return null;
  return { name, kind };
}
