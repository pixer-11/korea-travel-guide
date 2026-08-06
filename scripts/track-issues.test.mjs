import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKERS } from './track-issues.mjs';

// The ledger is only as good as these parsers. If one stops matching, the
// ledger silently reports "nothing open" — indistinguishable from a clean
// site, which is the exact failure mode this whole mechanism exists to end.
// Each fixture below is REAL output copied from a run on 2026-08-06.
const byName = Object.fromEntries(CHECKERS.map((c) => [c.name, c]));

test('validate-content: per-post codes and the duplicate pair', () => {
  const out = `❌ 7 content issue(s) across 647 posts + 17 essentials:

  • DUPLICATE event coverage (weeknd): jakarta-the-weeknd-after-hours-til-dawn-tour.md, jakarta-the-weeknd-after-hours-til-dawn-world-tour.md
  • UNVERIFIED-PHOTO: bangkok-saladaeng.md — published 13 days ago and its hero has never been through the vision check
  • UNVERIFIED-PHOTO: bangkok-the-grand-palace.md — published 13 days ago and its hero has never been through the vision check
`;
  const keys = byName['validate-content'].keys(out);
  assert.ok(keys.length >= 3, `parsed only ${keys.length}: ${JSON.stringify(keys)}`);
  assert.ok(keys.some((k) => k.includes('bangkok-saladaeng.md')), JSON.stringify(keys));
  assert.ok(keys.some((k) => k.startsWith('UNVERIFIED-PHOTO')), JSON.stringify(keys));
  assert.ok(keys.some((k) => /DUPLICATE/.test(k)), JSON.stringify(keys));
});

test('validate-content: the same finding yields the same key twice', () => {
  const line = '  • UNVERIFIED-PHOTO: bangkok-saladaeng.md — published 13 days ago\n';
  const a = byName['validate-content'].keys(line);
  const b = byName['validate-content'].keys(line.replace('13 days', '14 days'));
  // The age in the message changes daily; the KEY must not, or nothing ages.
  assert.deepEqual(a, b);
});

test('audit-translations: file and defect code', () => {
  const out = `🌐 Translation language audit — 3199 file(s) scanned, 516 draft(s) skipped
❌ 11 file(s) flagged:

  • posts/ja/ayutthaya-wat-mahathat.md: broken-bold
  • posts/ko/new-york-conservatory-garden.md: broken-bold
`;
  const keys = byName['audit-translations'].keys(out);
  assert.equal(keys.length, 2, JSON.stringify(keys));
  assert.ok(keys[0].includes('ayutthaya-wat-mahathat.md'), JSON.stringify(keys));
  assert.ok(keys[0].includes('broken-bold'), JSON.stringify(keys));
});

test('a clean run parses to zero keys, not to junk', () => {
  for (const c of CHECKERS) {
    assert.deepEqual(c.keys('✓ 646 posts clean — no slash regions, placeholders, dup images.\n'), [],
      `${c.name} invented keys from a clean report`);
  }
});

test('every checker has a name, a command and a parser', () => {
  for (const c of CHECKERS) {
    assert.ok(c.name && c.cmd && typeof c.keys === 'function', `incomplete checker: ${c.name}`);
    assert.match(c.cmd, /^node scripts\//);
  }
});
