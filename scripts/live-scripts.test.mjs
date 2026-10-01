// The live checks (scripts/live/) run on a Linux runner twice a day, never in
// CI — so CI is the only place a broken one can be caught before the schedule
// finds it. Codex, 10-01: one of them did not even parse ("const BASE = BASE"),
// and three read the repo from C:/Users/... , a path the runner does not have.
//   node --test scripts/live-scripts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./live/', import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith('.mjs'));

test('there are live checks to look at', () => {
  assert.ok(files.length >= 10, `only ${files.length} files in scripts/live`);
});

test('every live check parses', () => {
  const bad = files.filter((f) => spawnSync(process.execPath, ['--check', DIR + f]).status !== 0);
  assert.deepEqual(bad, []);
});

test('no live check reads from one desk', () => {
  const bad = files.filter((f) => /[A-Z]:[\\/]+Users[\\/]|LOCALAPPDATA/i.test(readFileSync(DIR + f, 'utf8')));
  assert.deepEqual(bad, [], 'use ROOT from lib.mjs (the checkout), not a Windows path');
});

test('every check run-all lists exists, and every check is listed', () => {
  const runAll = readFileSync(DIR + 'run-all.mjs', 'utf8');
  const listed = [...runAll.matchAll(/\['([\w-]+\.mjs)'/g)].map((m) => m[1]);
  assert.deepEqual(listed.filter((f) => !files.includes(f)), []);
  const unlisted = files.filter((f) => !['lib.mjs', 'run-all.mjs'].includes(f) && !listed.includes(f));
  assert.deepEqual(unlisted, [], 'a check that run-all.mjs does not list never runs on the schedule');
});
