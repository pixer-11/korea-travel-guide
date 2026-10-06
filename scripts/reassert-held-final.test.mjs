// heldFinal means "stays unpublished". On 2026-10-06 a remote-first rebase
// left four held twins at draft: false; scripts/reassert-held-final.mjs puts
// them back after every bot push, and this keeps main honest in CI.
//   node --test scripts/reassert-held-final.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { heldButPublished } from './reassert-held-final.mjs';

test('a held post that is not a draft is found; a held draft and an unheld post are not', () => {
  const d = mkdtempSync(join(tmpdir(), 'held-'));
  writeFileSync(join(d, 'a.md'), "---\ntitle: A\ndraft: false\nheldFinal: 'twin of b'\n---\nx\n");
  writeFileSync(join(d, 'b.md'), "---\ntitle: B\ndraft: true\nheldFinal: 'twin'\n---\nx\n");
  writeFileSync(join(d, 'c.md'), '---\ntitle: C\ndraft: false\n---\nx\n');
  writeFileSync(join(d, 'd.md'), "---\ntitle: D\nheldFinal: >-\n  long reason\n---\nx\n");
  assert.deepEqual(heldButPublished(d).sort(), ['a', 'd']);
});

test('no post on main is held and published at once', () => {
  assert.deepEqual(heldButPublished(), []);
});
