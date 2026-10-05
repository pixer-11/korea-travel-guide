// Are two event guides about the SAME event? One rule for the discovery run
// (before anything is written) and for validate-content (after) — the two had
// drifted into separate copies, and a test file kept a third.
//
// 2026-10-05: four same-event pairs were live, two with a date a week off:
//   "EDC Korea (Electric Daisy Carnival)" / "Electric Daisy Carnival (EDC) Korea 2026"
//       — anchor words 'edc' vs 'electric'
//   "Charlie Puth Seoul 2026" Oct 11 / "Charlie Puth Concert" Oct 17-18
//       — same anchor, but outside the 3-day window
//   "5SOS: Everyone's A Star!" Manila / "5 Seconds of Summer: …" Pasay
//       — same arena, region spelled as the district
//   "Pertamina Grand Prix of Indonesia" Mandalika / "MotoGP Indonesia" Lombok
//       — same circuit, region spelled as the island
// A shared name word alone is NOT enough — widening to that found 12 false
// pairs in the 278 live events — so it must come with the same city or the
// same venue.
import { keyToken, tokens as nameTokens, ANCHOR_STOP } from './commons.mjs';
import { eventSchemaName } from '../../src/lib/eventName.mjs';
import { canonicalRegion } from '../../src/lib/region-alias.mjs';

export const TWIN_WINDOW_DAYS = 10;

// Words every venue name shares; what is left names the place.
const VENUE_GENERIC = new Set(['the', 'of', 'and', 'at', 'international', 'national', 'street', 'circuit', 'arena', 'stadium',
  'resort', 'entertainment', 'hall', 'center', 'centre', 'park', 'convention', 'exhibition', 'theatre', 'theater', 'dome',
  'ground', 'grounds', 'complex', 'venue', 'city', 'club', 'square', 'plaza', 'auditorium', 'indoor', 'outdoor']);
const venueTokens = (v) => new Set(String(v ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !VENUE_GENERIC.has(t)));

const isoDay = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10));

/** The comparable shape of one event (an existing post or a discovery candidate). */
export function eventKey({ title, country, region, start, end, venue }) {
  const schemaName = eventSchemaName(String(title ?? ''));
  const s = isoDay(start);
  const geo = new Set(nameTokens(`${region ?? ''} ${country ?? ''}`));
  const v = venueTokens(venue);
  return {
    country: String(country ?? ''),
    region: canonicalRegion(String(region ?? '').toLowerCase()) || String(region ?? '').toLowerCase(),
    anchor: keyToken(schemaName, `${region} ${country}`) || '',
    // The city, country and venue are not part of an event's NAME: "Istanbul
    // Marathon" and "WTT Contender Istanbul" share only the city, "PLK Stade
    // de France" and "Jay-Z Stade de France" only the stadium.
    toks: new Set(nameTokens(schemaName).filter((t) => !ANCHOR_STOP.has(t) && !/^(19|20)\d{2}$/.test(t)
      && !geo.has(t) && !v.has(t))),
    start: s,
    end: isoDay(end) || s,
    venue: v,
  };
}

const sameVenue = (a, b) => {
  if (!a.size || !b.size) return false;
  const shared = [...a].filter((t) => b.has(t)).length;
  return shared >= 2 || (shared === 1 && (a.size === 1 || b.size === 1));
};

/** True when a and b (eventKey shapes) are the same event. */
export function isEventTwin(a, b) {
  if (a.country !== b.country) return false;
  const dated = a.start && b.start;
  const days = dated ? Math.abs(new Date(a.start) - new Date(b.start)) / 864e5 : 0;
  const overlap = dated && a.start <= (b.end || b.start) && b.start <= (a.end || a.start);
  const close = !dated || overlap || days <= 3;          // the old window
  const within = !dated || overlap || days <= TWIN_WINDOW_DAYS;
  if (!within) return false;
  const place = (a.region && a.region === b.region) || sameVenue(a.venue, b.venue);
  const anchor = a.anchor && a.anchor === b.anchor;
  // The anchor alone still needs the old 3-day window: "Palermo Marathon" and
  // "Ravenna Marathon" share it a week apart. Further apart, or with only a
  // shared name word, the same city or venue has to agree too.
  if (anchor && close) return true;
  const shared = [...a.toks].some((t) => b.toks.has(t));
  if ((anchor || shared) && place) return true;
  // generic titles (no distinctive words at all): same city and the same
  // first day — "2026 Vietnam National Games" and "Miss Charm 2026" overlap
  // in Ho Chi Minh City and are not one event.
  return (!a.toks.size || !b.toks.size) && !!a.region && a.region === b.region && (!dated || a.start === b.start);
}
