// How long the event candidate loop keeps asking Commons for the NEXT file —
// shared by the night patrol (backfill-photos-alt) and the width upgrader,
// which have twice grown diverging copies of the same rule.
//
// Three different failures pull this number in three directions:
//
//   Too short, counted wrong. Filename identity refusals cost no vision call,
//   but they were spending the twelve turns that exist to find four
//   VISION-WORTHY files. Phuket burned eleven of twelve on refusals and never
//   reached the ~35 large CC-BY files that name the festival outright
//   (2026-08-30). So a free refusal buys its own extra turn.
//
//   Too long. Digging deeper only helps when the search is finding real
//   things. When it is not, more turns just drag more junk in front of
//   vision — and vision cannot tell acts apart (the documented blind spot,
//   F1_Rocks_Singapore). The U-Know post refused sixteen files in a row
//   ("Do you know? - DPLA -" scanned book pages) and the seventeenth was a
//   file called U-know.JPG that the filename gate has no reason to stop.
//   A RUN of refusals with nothing usable between them is the signal that
//   the search itself is off the rails, and the honest answer there is to
//   stop: an event may publish photoless by policy, and no photo is far
//   cheaper than another act's photo.
//
//   Unbounded. Every turn is still a Commons search, so there is a ceiling.
//
// Measured on the three live posts this was built against (2026-08-30):
// longest refusal run was 0 for Phuket, 6 for paris-plk (healthy — real
// candidates in between), 16 for U-Know (dead end).
export const MAX_CANDIDATE_TURNS = 12;
export const CANDIDATE_TURN_CEILING = 30;
export const DEAD_END_REFUSALS = 10;
// A post whose hero is SHARED with another live post is a different search
// from a post with a wrong hero: the act's best files are usually already
// taken (by the twin, and by every other city of the same tour), so the first
// four vision-worthy candidates are the leftovers — a bar sign, three files
// under 1024px (jakarta-the-weeknd, 2026-09-03) — while the large concert
// files sat a few turns further down. Ask for twice as many before vision
// judges; the turn ceiling and the dead-end rule still apply unchanged.
export const SHARED_HERO_WANT = 8;

export function candidateBudget({ want = 4 } = {}) {
  let turn = 0, free = 0, streak = 0, found = 0;
  return {
    get turn() { return turn; },
    get found() { return found; },
    get streak() { return streak; },
    keepGoing() {
      return found < want
        && turn < Math.min(MAX_CANDIDATE_TURNS + free, CANDIDATE_TURN_CEILING)
        && streak < DEAD_END_REFUSALS;
    },
    turned() { turn++; },
    // The filename says this is some other act. Free, and evidence — if it
    // keeps happening with nothing in between — that the search is lost.
    refused() { free++; streak++; },
    // Vision already judged this file for this post. Free too, but the
    // opposite evidence: the search IS reaching files real enough to have
    // been looked at, so it does not count toward the dead-end run.
    alreadyJudged() { free++; streak = 0; },
    accepted() { found++; streak = 0; },
  };
}
