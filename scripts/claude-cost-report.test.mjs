// monthLine: month-to-date Claude spend and its forecast against the limit.
//   node --test scripts/claude-cost-report.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { monthLine } from './claude-cost-report.mjs';

const row = (ts, usd) => ({ ts, day: ts.slice(0, 10), models: { 'claude-opus-5-5': { calls: 1, usd } } });

test('forecasts the UTC month linearly and warns past 85% of the cap', () => {
  // 5 days into October, $134 -> 134/5*31 = $831 against $800
  const rows = [row('2026-10-01T03:00:00Z', 60), row('2026-10-04T03:00:00Z', 74), row('2026-09-30T23:00:00Z', 500)];
  const l = monthLine(rows, new Date('2026-10-06T00:00:00Z'), 800);
  assert.match(l, /누적 \$134 \/ 한도 \$800/);
  assert.match(l, /월말 예상 \$831/);
  assert.match(l, /⚠️ 한도 근접/);
});

test('a quiet month says so without a warning, and an empty one says nothing', () => {
  const l = monthLine([row('2026-10-02T00:00:00Z', 10)], new Date('2026-10-11T00:00:00Z'), 800);
  assert.match(l, /월말 예상 \$31/);
  assert.doesNotMatch(l, /⚠️/);
  assert.equal(monthLine([row('2026-09-30T23:59:00Z', 10)], new Date('2026-10-01T01:00:00Z'), 800), '');
});

test('the month boundary is UTC: 09-30 23:30 UTC (10-01 KST) belongs to September', () => {
  const l = monthLine([row('2026-09-30T23:30:00Z', 99), row('2026-10-01T00:30:00Z', 1)], new Date('2026-10-02T00:00:00Z'), 800);
  assert.match(l, /누적 \$1 /);
});
