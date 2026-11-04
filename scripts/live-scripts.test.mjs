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

// 10-01's "bot surge" (2,688 visits against 45 readers) was these checks: the
// analytics block lives in lib.mjs's launch(), so a check that starts its own
// browser is counted as a reader by every analytics the site runs.
test('every check opens its browser through lib.mjs launch()', () => {
  const own = files.filter((f) => f !== 'lib.mjs'
    && /from\s+['"]playwright|chromium\s*\.\s*launch|\.launchPersistentContext/.test(readFileSync(DIR + f, 'utf8')));
  assert.deepEqual(own, [], 'import { launch } from ./lib.mjs — it blocks Plausible, GA4 and Cloudflare Web Analytics');
  const lib = readFileSync(DIR + 'lib.mjs', 'utf8');
  assert.match(lib, /isAnalyticsRequest/, 'lib.mjs must route through lib/live-analytics-block.mjs');
  assert.match(lib, /ctx\.route\(BLOCK,/, 'the block must be installed on every context launch() hands out');
  // The route alone let half of Cloudflare's reports through (sendBeacon on leaving a page).
  assert.match(lib, /navigator\.sendBeacon = /, 'the in-page sendBeacon lock is the half the route cannot hold');
  assert.match(lib, /CF_RUM_SOURCE/);
});

// 11-04: one link of 976 got no answer once and the hubs check went red; the
// browser's request client was the one way to read a page with no second try.
test('the browser request client tries a one-off once more, and only a one-off', async () => {
  const { retryRequest } = await import('./live/lib.mjs');
  const fake = (answers) => {
    const req = { calls: 0 };
    req.get = async () => {
      const a = answers[req.calls++];
      if (a instanceof Error) throw a;
      return { status: () => a, dispose: async () => {} };
    };
    req.head = req.get;
    return retryRequest(req, { wait: async () => {} });
  };
  let r = fake([new Error('socket hang up'), 200]);
  assert.equal((await r.get('/a/')).status(), 200);
  assert.equal(r.calls, 2);
  r = fake([503, 200]);
  assert.equal((await r.head('/a/')).status(), 200);
  assert.equal(r.calls, 2);
  r = fake([404, 200]);
  assert.equal((await r.get('/a/')).status(), 404, 'a real 404 is the answer, not retried');
  assert.equal(r.calls, 1);
  r = fake([new Error('down'), new Error('down')]);
  await assert.rejects(r.get('/a/'), /down/);
  assert.equal(r.calls, 2, 'a site that is really down fails on the second try');
  assert.equal(retryRequest(r), r, 'wrapping twice is a no-op');
  assert.match(readFileSync(DIR + 'lib.mjs', 'utf8'), /retryRequest\(ctx\.request\)/, 'launch() must install it on every context');
});

test('every check run-all lists exists, and every check is listed', () => {
  const runAll = readFileSync(DIR + 'run-all.mjs', 'utf8');
  const listed = [...runAll.matchAll(/\['([\w-]+\.mjs)'/g)].map((m) => m[1]);
  assert.deepEqual(listed.filter((f) => !files.includes(f)), []);
  const unlisted = files.filter((f) => !['lib.mjs', 'run-all.mjs'].includes(f) && !listed.includes(f));
  assert.deepEqual(unlisted, [], 'a check that run-all.mjs does not list never runs on the schedule');
});
