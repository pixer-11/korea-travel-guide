// ─────────────────────────────────────────────────────────────
//  City pass card (Go City through Travelpayouts, 3.4–6%, cookie 90 days;
//  2026-10-04 픽서님 "순서대로 다 처리해").
//
//  Only where a pass pays: an itinerary whose PAID stops the pass actually
//  covers, read off Go City's own attraction list (gocity.com/en/<city>/
//  attractions, 10-04). Dubai, Los Angeles and Singapore were checked and
//  left out: their plans are mostly free places (Codex: "a pass on a plan of
//  free stops costs trust").
//  - New York 3 days: Top of the Rock, One World Observatory, the Statue of
//    Liberty ferry — all three paid stops.
//  - Barcelona 3 days: Casa Batlló, Sagrada Família (a guided tour in the
//    pass), Mirador Torre Glòries, La Pedrera, Park Güell (hosted entry) —
//    five of seven.
//
//  Links are the dashboard's own short links, copied, never typed: Go City's
//  short link goes straight to Partnerize (prf.hn) with pubref <token>-754088,
//  not through tp.media, so a per-city URL cannot be built here. Each one was
//  followed to Go City's city page with subId1=<token>-754088 before use.
//  No prices on our pages.
// ─────────────────────────────────────────────────────────────

export const GOCITY = {
  'new-york-3-days': {
    href: 'https://gocity.tpx.lv/gQzWzgHu',
    covers: ['new-york-top-of-the-rock', 'new-york-one-world-observatory', 'new-york-statue-of-liberty'],
  },
  'barcelona-3-days': {
    href: 'https://gocity.tpx.lv/FY2uT2EY',
    covers: ['barcelona-casa-batllo', 'barcelona-basilica-of-the-sagrada-familia', 'barcelona-mirador-torre-glories', 'barcelona-la-pedrera-casa-mila', 'barcelona-park-guell'],
  },
};

/** The pass card's data for one itinerary, or null where a pass does not pay. */
export const gocityFor = (itineraryId) => GOCITY[itineraryId] ?? null;
