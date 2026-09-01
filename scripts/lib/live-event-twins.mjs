// ─────────────────────────────────────────────────────────────
//  ONE EVENT, ONE LIVE PAGE — the pairing rule, in one place.
//
//  While an event sits in quarantine the discovery run can find the same show
//  again under another phrasing and publish that one instead. Any path that
//  later releases the parked twin then puts two pages up for one event.
//
//  release-photoless-events learned this on 2026-08-16 and grew the anchored
//  check below (two weaker keys leaked first: a topic key split "The Sounds
//  Project 2026" from a live "The Sounds Project Vol. 9" on the word "vol",
//  and an exact-date key split the F✦FOREVER Kuala Lumpur show recorded once
//  as 08-07 and once as 08-07~08-08 — overlap catches both).
//
//  It stayed inside that one script, so the OTHER release path never knew it:
//  on 2026-08-31 backfill-photos-alt republished the very pair the comment
//  names — jakarta-the-sounds-project-2026 next to the live Vol. 9 — plus a
//  second LALALA Fest twin, because a verified new photo lifts the draft flag
//  and nothing there asked whether the event was already covered. Both paths
//  now share this module: one rule, one place to fix it.
// ─────────────────────────────────────────────────────────────
import { keyToken } from './commons.mjs';

/** act/anchor word + country — stable across the phrasing a discovery run picked that day. */
export const anchorOf = (d) => `${keyToken(String(d.title))}|${d.country ?? 'South Korea'}`;
export const spanOf = (d) => [
  String(d.eventStartDate ?? '').slice(0, 10),
  String(d.eventEndDate ?? d.eventStartDate ?? '').slice(0, 10),
];
export const overlaps = (a, b) => Boolean(a[0] && b[0] && a[0] <= b[1] && b[0] <= a[1]);

/**
 * An index of the events already published, asked one question: is this draft
 * a second guide to something that is live?
 * @returns {{note: (d: object) => void, alreadyLive: (d: object) => boolean, size: () => number}}
 */
export function twinIndex() {
  const byAnchor = new Map();
  return {
    note(d) {
      const k = anchorOf(d);
      if (!k.startsWith('|')) (byAnchor.get(k) ?? byAnchor.set(k, []).get(k)).push(spanOf(d));
    },
    alreadyLive(d) {
      const k = anchorOf(d);
      if (k.startsWith('|')) return false; // no anchor word ('Italian Grand Prix') — nothing to match on
      return (byAnchor.get(k) ?? []).some((s) => overlaps(s, spanOf(d)));
    },
    size: () => byAnchor.size,
  };
}
