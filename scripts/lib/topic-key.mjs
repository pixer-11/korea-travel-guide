// Shared near-duplicate topic key. Normalizes a post's title + region into a
// sorted token key so same-city name variants collapse to one key — e.g.
// "ChinaJoy 2026: What to Know (Shanghai)" and "ChinaJoy: What to Know (Shanghai)"
// both become "chinajoy shanghai". Used by BOTH validate-content.mjs (post-publish
// detection) and discover-events.mjs (generation-time prevention) so the two rules
// can never drift apart. Region is included so different cities that share a
// generic noun ("Tower", "Local Restaurant") do NOT collapse.
export const FILLER = new Set(['the', 'and', 'with', 'what', 'know', 'guide', 'visitor', 'visitors', 'where', 'eat', '2026', '2027']);

export const topicKey = (title, region) => {
  // "Dates, Tickets" is the event suffix in use since 2026-08-07; "What to
  // Know" covers the back catalogue. Both must strip to the same key or a
  // re-discovered event would dodge the duplicate guard across the rename.
  const name = String(title).split(/:\s*(?:What to Know|Where to Eat|A Visitor|Dates, Tickets)/i)[0];
  return `${name} ${region}`
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !FILLER.has(w))
    .sort().join(' ');
};
