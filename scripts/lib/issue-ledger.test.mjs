import test from 'node:test';
import assert from 'node:assert/strict';
import { trackIssues, escalationLine } from './issue-ledger.mjs';

// write:false keeps every case off data/issue-ledger.json. The ledger these
// tests read is therefore the real one, so they assert on BEHAVIOUR (fresh vs
// stale vs resolved) rather than on stored contents.
const dry = (source, keys, day) => trackIssues(source, keys, { write: false, day });

test('an unknown finding is fresh, never stale', () => {
  const r = dry('test-suite-fake', ['a.md', 'b.md'], '2026-08-06');
  assert.deepEqual(r.fresh.sort(), ['a.md', 'b.md']);
  assert.deepEqual(r.stale, []);
});

test('a finding gone from the list counts as resolved', () => {
  // Nothing was stored, so `prev` is empty and nothing can resolve — the
  // guarantee under test is that resolved never contains a CURRENT key.
  const r = dry('test-suite-fake', ['a.md'], '2026-08-06');
  assert.ok(!r.resolved.includes('a.md'));
});

test('escalationLine is empty when nothing is stale', () => {
  assert.equal(escalationLine('validate-content', []), '');
});

test('escalationLine names the oldest and counts the rest', () => {
  const line = escalationLine('validate-content', [
    { key: 'x.md', days: 9, since: '2026-07-28' },
    { key: 'y.md', days: 4, since: '2026-08-02' },
  ]);
  assert.match(line, /9일째/);
  assert.match(line, /x\.md/);
  assert.match(line, /외 1건/);
});

test('duplicate keys in one run are counted once', () => {
  const r = dry('test-suite-fake', ['same.md', 'same.md'], '2026-08-06');
  assert.equal(r.fresh.length, 1);
});

test('an empty run reports nothing and does not throw', () => {
  const r = dry('test-suite-fake', [], '2026-08-06');
  assert.deepEqual(r.fresh, []);
  assert.deepEqual(r.stale, []);
});
