import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveBusyness, hasBusynessConflict } from './busyness.mjs';

// The real record that exposed this: Lyon's Café Joyeux, weekend quiet 9-16 and
// weekend busy 11-18, overlapping at 11-16.
const LYON = {
  weekdayQuiet: [9],
  weekdayBusy: [15],
  weekendQuiet: [9, 10, 11, 12, 13, 14, 15, 16],
  weekendBusy: [11, 12, 13, 14, 15, 16, 17, 18],
};

test('a contested hour is busy, not quiet', () => {
  const r = resolveBusyness(LYON);
  assert.deepEqual(r.weekendQuiet, [9, 10], 'only the uncontested hours stay quiet');
  assert.deepEqual(r.weekendBusy, [11, 12, 13, 14, 15, 16, 17, 18], 'busy is untouched');
  for (const h of r.weekendQuiet) assert.ok(!r.weekendBusy.includes(h), `hour ${h} in both lists`);
});

test('weekday is resolved by the same rule', () => {
  const r = resolveBusyness({ weekdayQuiet: [9, 15], weekdayBusy: [15] });
  assert.deepEqual(r.weekdayQuiet, [9]);
});

// The reverse direction: a filter that "fixes" contradictions by dropping
// everything would also pass the test above. These make sure clean data — the
// other 94% — survives untouched.
test('clean data is not altered', () => {
  const clean = {
    weekdayQuiet: [8, 9, 16],
    weekdayBusy: [],
    weekendQuiet: [8],
    weekendBusy: [10, 11, 12, 13, 14, 15],
  };
  const r = resolveBusyness(clean);
  assert.deepEqual(r.weekdayQuiet, [8, 9, 16]);
  assert.deepEqual(r.weekendQuiet, [8]);
  assert.deepEqual(r.weekendBusy, [10, 11, 12, 13, 14, 15]);
});

test('quiet hours survive when there is no busy list at all', () => {
  const r = resolveBusyness({ weekendQuiet: [7, 8] });
  assert.deepEqual(r.weekendQuiet, [7, 8], 'nothing to subtract, nothing removed');
  assert.deepEqual(r.weekendBusy, []);
});

test('output is always arrays and always sorted', () => {
  const r = resolveBusyness({ weekendQuiet: [16, 8, 12], weekendBusy: [12] });
  assert.deepEqual(r.weekendQuiet, [8, 16]);
  const empty = resolveBusyness(null);
  for (const k of ['weekdayQuiet', 'weekdayBusy', 'weekendQuiet', 'weekendBusy']) {
    assert.deepEqual(empty[k], [], `${k} should be [] for a null block`);
  }
  assert.deepEqual(resolveBusyness(undefined).weekendQuiet, []);
});

test('conflict detector fires on real conflicts only', () => {
  assert.equal(hasBusynessConflict(LYON), true);
  assert.equal(hasBusynessConflict({ weekendQuiet: [8], weekendBusy: [10, 11] }), false);
  assert.equal(hasBusynessConflict({ weekendQuiet: [], weekendBusy: [] }), false);
  assert.equal(hasBusynessConflict(null), false);
  assert.equal(hasBusynessConflict({ weekdayQuiet: [15], weekdayBusy: [15] }), true);
});
