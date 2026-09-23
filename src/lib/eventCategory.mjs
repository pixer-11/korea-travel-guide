// Which filter chip does an event belong under on the events hubs?
//
// There is no category field on event posts, and the hubs need one so a
// festival-seeker does not have to read past thirty K-pop tour dates
// (events redesign, 2026-09-24). It is DERIVED, deterministically, from two
// things we already store and can stand behind:
//
//   1. eventPerformer — set only when the event IS that act performing, so a
//      performer means a concert. Checked first.
//   2. the ENGLISH title — word lists below, in a fixed order.
//
// The English title on purpose, same reasoning as eventName.mjs: the
// translated titles are free translations with no shared vocabulary, and a
// chip that changes with the page's language would file one event two ways.
//
// When nothing matches the answer is 'other'. A wrong label is worse than no
// label — a reader who picks "Sports" and finds a tomato fight stops trusting
// the chips — so every list is a list of words that are unambiguous in this
// corpus, not a guess at what an event "probably" is.

import { eventSchemaName } from './eventName.mjs';

export const EVENT_CATEGORIES = ['concerts', 'sports', 'festivals', 'exhibitions', 'other'];

// Sports come before festivals: "Formula 1 … Grand Prix" never says festival,
// but a "Fireworks Festival" never says grand prix either, so the order only
// matters for the rare title with both — and a race with a fan festival
// attached is still a race.
const SPORTS = new RegExp(
  [
    String.raw`\bmarathon`, String.raw`\bhalf[- ]marathon`, String.raw`\btriathlon`, String.raw`\bironman\b`,
    String.raw`\braces?\b`, String.raw`\bgrand prix\b`, String.raw`\bprix\b`, String.raw`\bgp\b`,
    String.raw`\bformula (?:1|one|e)\b`, String.raw`\bf1\b`, String.raw`\bmotogp\b`, String.raw`\bsuperbike`,
    // "Open" is a tournament only when it is not an "Open Air" / "Open House".
    String.raw`\bopen\b(?!\s*(?:air|house|studio|day))`,
    String.raw`\bcup\b`, String.raw`\bchampionships?\b`, String.raw`\bleague\b`, String.raw`\bmatch(?:es)?\b`,
    String.raw`\btournament\b`, String.raw`\bmasters\b`, String.raw`\bbasho\b`, String.raw`\bsumo\b`,
    String.raw`\btennis\b`, String.raw`\bfootball\b`, String.raw`\bsoccer\b`, String.raw`\bbaseball\b`,
    String.raw`\bbasketball\b`, String.raw`volley(?:ball)?\b`, String.raw`\bbadminton\b`, String.raw`\bbwf\b`,
    String.raw`\bsnooker\b`, String.raw`\bgolf\b`, String.raw`\brugby\b`, String.raw`\bcricket\b`,
    String.raw`\bufc\b`, String.raw`\bfight\b`, String.raw`\bboxing\b`, String.raw`\bwrestling\b`,
    String.raw`\bolympiad\b`, String.raw`\bolympics?\b`, String.raw`\bgames\b`, String.raw`\bathletics\b`,
    String.raw`\baquatics\b`, String.raw`\bswimming\b`, String.raw`\bcycling\b`,
    String.raw`\btour de france\b`, String.raw`\bvuelta\b`, String.raw`\bgiro d'italia\b`,
    String.raw`\bpalio\b`, String.raw`\bcsio\b`, String.raw`\bequestrian\b`, String.raw`\bderby\b`,
    String.raw`\bregatta\b`, String.raw`\s+vs\.?\s+`,
  ].join('|'),
  'i',
);

const FESTIVALS = /\bfestivals?\b|\bfestival\b|\bfest\b|\bmatsuri\b|\bfiesta\b|\bcarnival\b|\bjazztival\b|\bfête\b|\bfete\b/i;

// "show" is an exhibition only as a trade/fan show — "roadshow" is marketing
// and "Live Show"/"Concert Show" are performances, so those are excluded.
const EXHIBITIONS = new RegExp(
  [
    String.raw`\bexhibitions?\b`, String.raw`\bexpo\b`, String.raw`\bmuseum\b`, String.raw`\bgallery\b`,
    String.raw`\bart\b`, String.raw`\barts\b`, String.raw`\bbiennale\b`, String.raw`\bbiennial\b`,
    String.raw`\btriennale\b`, String.raw`\bart fair\b`,
    String.raw`(?<!road)(?<!live )(?<!concert )\bshow\b`,
    String.raw`\bcomic[- ]?con\b`, String.raw`\bcomiket\b`, String.raw`\bcomic market\b`,
  ].join('|'),
  'i',
);

// A tour or a concert with no performer recorded ("BTS World Tour",
// "Stray Kids Concert", "David Byrne Live in Bangkok"). Checked LAST, after
// sports, because "Tour de France" and "World Athletics Continental Tour" are
// tours too.
const CONCERTS = /\bconcerts?\b|\blive in\b|\blive\s*[–—-]|\bworld tour\b|\btour\b|\bresidency\b|\brecital\b|\bfeaturing\b/i;

/**
 * @param {{ title?: string, eventPerformer?: { name?: string } | null }} data
 * @returns {'concerts'|'sports'|'festivals'|'exhibitions'|'other'}
 */
export function eventCategory(data) {
  const title = eventSchemaName(data?.title ?? '');
  if (data?.eventPerformer?.name) return 'concerts';
  if (SPORTS.test(title)) return 'sports';
  if (FESTIVALS.test(title)) return 'festivals';
  if (EXHIBITIONS.test(title)) return 'exhibitions';
  if (CONCERTS.test(title)) return 'concerts';
  return 'other';
}
