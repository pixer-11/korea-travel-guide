// Unit test for the itinerary-gate boost in buildRotatedQueue() (see the
// "// Itinerary-gate boost:" comment in scripts/generate.mjs). Exercises the
// same pure queue-building function main() calls, with hand-built inputs
// instead of real content/API calls — buildRotatedQueue takes no IO itself,
// so it is a genuine testable seam (exported for exactly this purpose).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRotatedQueue, postTopicKey } from './generate.mjs';

test('itinerary-gate boost pulls a region near the 12-post gate ahead of a region far from it', () => {
  // Both targets use a category OUTSIDE the near-roundup boost's set
  // (attraction/restaurant/trendy/hidden-gem), and regionCatCounts is left
  // empty, so the near-roundup boost can't interfere — only the itinerary-gate
  // boost can move these two relative to each other.
  const targets = [
    { query: 'small city museum', region: 'SmallCity', category: 'museum', country: 'Testland' },
    { query: 'gate city museum', region: 'GateCity', category: 'museum', country: 'Testland' },
  ];
  const countries = [{ name: 'Testland', regions: [], priority: 1 }];
  const done = new Set();

  // Baseline (no regionQualifyingCounts passed, defaults to an empty Map): with
  // no boost active, insertion order is preserved (SmallCity was listed first
  // above) — this is the control that proves the boost below is what moves it.
  const baseline = buildRotatedQueue(targets, done, countries, []);
  const baseSmallIdx = baseline.findIndex((t) => t.region === 'SmallCity');
  const baseGateIdx = baseline.findIndex((t) => t.region === 'GateCity');
  assert.ok(baseSmallIdx < baseGateIdx, 'sanity check: without the boost, SmallCity (listed first) sorts ahead of GateCity');

  // GateCity sits at 10 qualifying posts — inside the 9-11 near-gate window
  // (gateFor's 3-day threshold is 12). SmallCity sits at 3 — nowhere close.
  const regionQualifyingCounts = new Map([
    ['GateCity', 10],
    ['SmallCity', 3],
  ]);
  const boostedQueue = buildRotatedQueue(targets, done, countries, [], { regionQualifyingCounts });
  const gateIdx = boostedQueue.findIndex((t) => t.region === 'GateCity');
  const smallIdx = boostedQueue.findIndex((t) => t.region === 'SmallCity');

  assert.ok(gateIdx !== -1 && smallIdx !== -1, 'both targets should still be present in the queue');
  assert.ok(gateIdx < smallIdx, `a 10-qualifying-post region should sort ahead of a 3-post region once the itinerary-gate boost is active (gateIdx=${gateIdx}, smallIdx=${smallIdx})`);
});

test('itinerary-gate boost does not affect a region outside the 9-11 / 21-23 windows', () => {
  const targets = [
    { query: 'small city museum', region: 'SmallCity', category: 'museum', country: 'Testland' },
    { query: 'big city museum', region: 'BigCity', category: 'museum', country: 'Testland' },
  ];
  const countries = [{ name: 'Testland', regions: [], priority: 1 }];
  const done = new Set();

  // Neither 2 nor 30 falls in [9,11] or [21,23], so this should behave exactly
  // like the no-boost baseline: original (insertion) order preserved.
  const regionQualifyingCounts = new Map([
    ['BigCity', 30],
    ['SmallCity', 2],
  ]);
  const queue = buildRotatedQueue(targets, done, countries, [], { regionQualifyingCounts });
  const smallIdx = queue.findIndex((t) => t.region === 'SmallCity');
  const bigIdx = queue.findIndex((t) => t.region === 'BigCity');
  assert.ok(smallIdx < bigIdx, 'neither region is near a gate, so insertion order (SmallCity first) should be unchanged');
});

// ── postTopicKey: the retirement-proof duplicate layer ──
// The place.id and slug de-dupes read files on disk, so retiring a duplicate
// (delete + 301) made its landmark look uncovered — the bulk fill rebuilt
// "Lijiang Old Town" on 2026-08-14, two days after 8e62a0a1 retired it. These
// pin the collapse with the REAL twin frontmatters from that incident, and the
// reverse direction (two genuinely different places in one city must NOT
// collapse), since an over-matching key would silently skip real guides.
test('postTopicKey collapses the Lijiang word-order twins to one key', () => {
  const kept = 'title: "Old Town of Lijiang: Travel Guide (4.6★)"\nregion: "Lijiang"\n';
  const twin = 'title: "Lijiang Old Town: Travel Guide (4.6★)"\nregion: "Lijiang"\n';
  const a = postTopicKey(kept);
  assert.ok(a, 'key must parse from frontmatter');
  assert.equal(a, postTopicKey(twin), 'word-order twins of one landmark must collapse');
});

test('postTopicKey keeps two different places in the same city apart', () => {
  const oldTown = 'title: "Old Town of Lijiang: Travel Guide (4.6★)"\nregion: "Lijiang"\n';
  const pool = 'title: "Black Dragon Pool Park: Travel Guide (4.5★)"\nregion: "Lijiang"\n';
  assert.notEqual(postTopicKey(oldTown), postTopicKey(pool), 'different landmarks must keep distinct keys');
});

test('postTopicKey returns null when frontmatter has no title', () => {
  assert.equal(postTopicKey('region: "Lijiang"\n'), null);
});
