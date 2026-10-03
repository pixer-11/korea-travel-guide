// City pass card (lib/gocity.mjs, 2026-10-04): every plan it names exists,
// every stop it claims is in that plan, and the link is a dashboard short link.
//   node --test src/lib/gocity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { GOCITY, gocityFor } from './gocity.mjs';

test('each pass plan exists and contains the stops it claims (2+)', () => {
  for (const [id, p] of Object.entries(GOCITY)) {
    const f = new URL(`../content/itineraries/${id}.md`, import.meta.url);
    assert.ok(existsSync(f), `${id}: no such itinerary`);
    const src = readFileSync(f, 'utf8');
    const missing = p.covers.filter((slug) => !src.includes(`slug: ${slug}`));
    assert.deepEqual(missing, [], `${id}: stops not in the plan`);
    assert.ok(p.covers.length >= 2, `${id}: a pass for fewer than two paid stops does not pay`);
    // Copied from the Travelpayouts dashboard, never typed (kiwitaxi I/l, 07-27).
    assert.match(p.href, /^https:\/\/gocity\.tpx\.lv\/[A-Za-z0-9]+$/, id);
  }
});

test('plans without a pass get no card', () => {
  assert.equal(gocityFor('dubai-3-days'), null);
  assert.equal(gocityFor('seoul-3-days'), null);
});
