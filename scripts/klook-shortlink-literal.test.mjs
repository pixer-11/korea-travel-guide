// A raw klook.tpx.lv short link in a component bypasses our /go/klook relay:
// English home, no SubID, no per-page reporting. Three copies were left from
// before the relay existed (2026-10-05 audit). The relay itself (worker/)
// uses the short link on purpose and is not scanned here.
//   node --test scripts/klook-shortlink-literal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? (f === 'content' ? [] : walk(p)) : /\.(astro|ts|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

test('no component links the raw Klook short link', () => {
  const files = walk(SRC);
  assert.ok(files.length > 100);
  const bad = files.filter((p) => readFileSync(p, 'utf8').includes('klook.tpx.lv')).map((p) => p.slice(SRC.length));
  assert.deepEqual(bad, []);
});
