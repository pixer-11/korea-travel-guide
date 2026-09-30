import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSections, carryExtraSections, requiredOnly } from './essentials-sections.mjs';

const guide = (extra = '') => [
  '**Quick answer:** Short.',
  '## Visa & entry\n\nVisa text.',
  '## Getting around\n\nTransit text.',
  extra,
  '## Money & costs\n\nMoney text.',
  '## Best time to visit\n\nSeason text.',
  '## Emergencies & safety\n\nCall 112.',
  '## Official sources\n\n- [Gov](https://gov.example)',
].filter(Boolean).join('\n\n');

const LUGGAGE = '## Luggage storage\n\nLockers cost ¥400.\n\nSources:\n- [Lockers](https://lockers.example)';

test('a rewrite keeps a section this script does not write, in the place it held', () => {
  const out = carryExtraSections(guide(LUGGAGE), guide().replace('Transit text.', 'New transit text.'));
  const heads = splitSections(out).map((s) => s.h);
  assert.deepEqual(heads, ['', '## Visa & entry', '## Getting around', '## Luggage storage', '## Money & costs', '## Best time to visit', '## Emergencies & safety', '## Official sources']);
  assert.ok(out.includes('Lockers cost ¥400.') && out.includes('New transit text.'));
});

test('nothing to carry leaves the new guide exactly as written', () => {
  const fresh = guide().replace('Visa text.', 'Updated visa text.');
  assert.equal(carryExtraSections(guide(), fresh), fresh);
});

test('a same-named section the model wrote is replaced by the checked one, not duplicated', () => {
  const out = carryExtraSections(guide(LUGGAGE), guide('## Luggage storage\n\nLockers cost ¥999.'));
  assert.equal(out.split('## Luggage storage').length, 2);
  assert.ok(out.includes('¥400') && !out.includes('¥999'));
});

test('if the heading it sat before is gone, the section lands before the sources', () => {
  const noMoney = guide().replace('## Money & costs\n\nMoney text.\n\n', '');
  const heads = splitSections(carryExtraSections(guide(LUGGAGE), noMoney)).map((s) => s.h);
  assert.equal(heads.at(-2), '## Luggage storage');
  assert.equal(heads.at(-1), '## Official sources');
});

test('the model is shown only the sections it writes', () => {
  const base = requiredOnly(guide(LUGGAGE));
  assert.ok(!base.includes('Luggage') && base.includes('**Quick answer:**') && base.includes('## Official sources'));
});
