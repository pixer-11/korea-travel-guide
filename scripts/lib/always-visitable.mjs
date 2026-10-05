// Exterior-only heritage landmarks: Google's status describes a BUSINESS, and
// some of these addresses have no business to describe. 37 Kerbau Road is the
// last Chinese villa in Little India — a painted facade you photograph from the
// street, never enter — and Google files it CLOSED_TEMPORARILY because the
// shophouse tenant behind the facade is between occupants. The building is
// there, the street is public, and the visit is unchanged; holding the guide
// tells a reader a landmark has shut when it has not (2026-09-16).
//
// Keyed by place.id, never by slug, so a place record swapped underneath us
// falls back out of the exemption. Each entry needs a dated reason: this list
// is the one way a non-OPERATIONAL venue reaches readers, so it stays short and
// covers only places whose VISIT does not depend on a business being open.
//
// One list for every tool that acts on businessStatus (2026-10-05). It lived
// only in audit-closed-venues, so the place-details backfill drafted this post
// every afternoon, the photo patrol marked it closed every night, and the held
// repair republished it every morning — re-translating it into four languages
// each time (three days running in the cost ledger).
export const ALWAYS_VISITABLE = new Map([
  ['ChIJX0z5sbgZ2jERbP7t9-0hs_E', '2026-09-16: Former House of Tan Teng Niah — exterior-only heritage facade on a public street; Google tracks the tenancy behind it'],
]);

/** True when this place may stay published whatever Google says about the business there. */
export const isAlwaysVisitable = (placeId) => ALWAYS_VISITABLE.has(String(placeId ?? '').replace(/^['"]|['"]$/g, ''));
