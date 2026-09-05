// The section writer must be surgical: build-essentials.mjs rewrites a country
// guide whole, and running that to add a sixth topic would also rewrite the
// visa/transport/money prose the owner has already reviewed.
//
//   node --test scripts/lib/essentials-section.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectEol, findSection, upsertSection, stampSectionReviewed } from './essentials-section.mjs';

const GUIDE = [
  '---',
  'country: "Japan"',
  'title: "Japan Travel Essentials"',
  'lastReviewed: 2026-09-01',
  'draft: false',
  '---',
  '',
  '**Quick answer:** Visa-free for most, IC card for transport.',
  '',
  '## Visa & entry',
  '',
  'Ninety days visa-free for most Western passports.',
  '',
  '## Getting around',
  '',
  'IC cards work on almost every train and bus.',
  '',
  '## Money & costs',
  '',
  'Cash still matters outside the big chains.',
  '',
  '## Official sources',
  '',
  '- [Immigration](https://www.moj.go.jp/)',
  '',
].join('\n');

test('inserts a new section directly after Getting around', () => {
  const out = upsertSection(GUIDE, { heading: 'Luggage storage', body: 'Coin lockers sit in every major station.' });
  const order = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['Visa & entry', 'Getting around', 'Luggage storage', 'Money & costs', 'Official sources']);
  assert.match(out, /## Luggage storage\n\nCoin lockers sit in every major station\.\n\n## Money & costs/);
});

test('leaves every other section byte-identical', () => {
  const out = upsertSection(GUIDE, { heading: 'Luggage storage', body: 'Coin lockers.' });
  for (const untouched of [
    'country: "Japan"',
    'lastReviewed: 2026-09-01',
    '**Quick answer:** Visa-free for most, IC card for transport.',
    'Ninety days visa-free for most Western passports.',
    'IC cards work on almost every train and bus.',
    'Cash still matters outside the big chains.',
    '- [Immigration](https://www.moj.go.jp/)',
  ]) assert.ok(out.includes(untouched), `lost: ${untouched}`);
});

test('replaces in place on a second run and is idempotent', () => {
  const once = upsertSection(GUIDE, { heading: 'Luggage storage', body: 'First text.' });
  const twice = upsertSection(once, { heading: 'Luggage storage', body: 'Second text.' });
  const thrice = upsertSection(twice, { heading: 'Luggage storage', body: 'Second text.' });
  assert.equal((twice.match(/## Luggage storage/g) || []).length, 1);
  assert.ok(!twice.includes('First text.'));
  assert.equal(thrice, twice);
});

test('preserves CRLF guides', () => {
  const crlf = GUIDE.replace(/\n/g, '\r\n');
  const out = upsertSection(crlf, { heading: 'Luggage storage', body: 'Coin lockers.' });
  assert.equal(detectEol(out), '\r\n');
  assert.ok(!/[^\r]\n/.test(out), 'a bare LF crept into a CRLF file');
});

test('falls back to before Official sources when the anchor is missing', () => {
  const noAnchor = GUIDE.replace('## Getting around', '## Transport notes');
  const out = upsertSection(noAnchor, { heading: 'Luggage storage', body: 'Coin lockers.' });
  const order = [...out.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(order.slice(-2), ['Luggage storage', 'Official sources']);
});

test('appends when neither anchor exists', () => {
  const bare = '---\ncountry: "X"\n---\n\nBody only.\n';
  const out = upsertSection(bare, { heading: 'Luggage storage', body: 'Coin lockers.' });
  assert.match(out, /Body only\.\n\n## Luggage storage\n\nCoin lockers\.\n/);
});

test('findSection returns null for an absent heading', () => {
  assert.equal(findSection(GUIDE, 'Luggage storage'), null);
  assert.ok(findSection(GUIDE, 'Getting around'));
});

test('stampSectionReviewed records the section date without touching lastReviewed', () => {
  const out = stampSectionReviewed(GUIDE, 'luggage-storage', '2026-09-05');
  assert.match(out, /sectionsReviewed:\n  luggage-storage: 2026-09-05/);
  assert.match(out, /lastReviewed: 2026-09-01/);
  const again = stampSectionReviewed(out, 'luggage-storage', '2026-09-09');
  assert.match(again, /luggage-storage: 2026-09-09/);
  assert.equal((again.match(/sectionsReviewed:/g) || []).length, 1);
  const second = stampSectionReviewed(again, 'dietary', '2026-09-10');
  assert.match(second, /luggage-storage: 2026-09-09/);
  assert.match(second, /dietary: 2026-09-10/);
});
