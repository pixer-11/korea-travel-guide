import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlugTargets, isTargeted } from './refresh-targets.mjs';

test('no flag and no env means the usual rotation', () => {
  const t = parseSlugTargets([], {});
  assert.equal(t.size, 0);
  assert.equal(isTargeted('anything.md', t), true);
});

test('--slugs picks exactly those posts', () => {
  const t = parseSlugTargets(['node', 'refresh.mjs', '--slugs=tokyo-smith-wollensky,madrid-el-campero'], {});
  assert.deepEqual([...t], ['tokyo-smith-wollensky', 'madrid-el-campero']);
  assert.equal(isTargeted('tokyo-smith-wollensky.md', t), true);
  assert.equal(isTargeted('tokyo-samaa-samaa.md', t), false);
});

test('a pasted filename works, and spaces are trimmed', () => {
  const t = parseSlugTargets(['--slugs= tokyo-smith-wollensky.md , madrid-el-campero '], {});
  assert.deepEqual([...t], ['tokyo-smith-wollensky', 'madrid-el-campero']);
});

// The workflow_dispatch input arrives as an environment variable.
test('REFRESH_SLUGS is read when no flag is given', () => {
  const t = parseSlugTargets([], { REFRESH_SLUGS: 'tokyo-smith-wollensky' });
  assert.equal(isTargeted('tokyo-smith-wollensky.md', t), true);
  assert.equal(isTargeted('tokyo-tokyo-tower.md', t), false);
});

// An empty input is how the daily cron calls it. If that parsed as "target the
// post named empty string", the unattended run would check nothing and report
// success — the quiet failure this rule most needs to avoid.
test('an empty or blank input does NOT narrow the run', () => {
  for (const raw of ['', '   ', ',', ' , , ']) {
    const t = parseSlugTargets([], { REFRESH_SLUGS: raw });
    assert.equal(t.size, 0, `"${raw}" narrowed the run`);
    assert.equal(isTargeted('tokyo-tokyo-tower.md', t), true);
  }
});

test('the flag wins over the environment', () => {
  const t = parseSlugTargets(['--slugs=from-flag'], { REFRESH_SLUGS: 'from-env' });
  assert.deepEqual([...t], ['from-flag']);
});
