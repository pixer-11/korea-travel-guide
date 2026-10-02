import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRedirectRules } from './redirect-rules.mjs';

test('a rule repeated word for word is dropped, not shipped twice', () => {
  const r = mergeRedirectRules('', ['/regions/goyang-si/ /regions/goyang/ 301', '/regions/goyang-si/ /regions/goyang/ 301']);
  assert.deepEqual(r.lines, ['/regions/goyang-si/ /regions/goyang/ 301']);
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.conflicts, []);
});

test('a duplicate of a rule already in the file is dropped too', () => {
  const r = mergeRedirectRules('/a/ /b/ 301\n', ['/a/  /b/   301', '/c/ /d/ 301']);
  assert.deepEqual(r.lines, ['/c/ /d/ 301']);
});

test('the same source sent to two places is reported, never silently kept', () => {
  const r = mergeRedirectRules('', ['/regions/washington/ /regions/washington-dc/ 301', '/regions/washington/ / 301']);
  assert.equal(r.conflicts.length, 1);
  assert.match(r.conflicts[0], /washington-dc/);
});

test('comments and blank lines pass through and are never counted as rules', () => {
  const r = mergeRedirectRules('# head\n\n', ['# region slug 301s', '', '/x/ /y/ 301']);
  assert.deepEqual(r.lines, ['# region slug 301s', '', '/x/ /y/ 301']);
  assert.equal(r.dropped, 0);
});

// The real generator over the real repo: the 2026-10-02 duplicate only showed
// up at Cloudflare's upload step, after a full build. This catches it in CI.
test('the region redirects this repo generates name every source path once', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { regionRedirects } = await import('../../astro.config.mjs');
  const raw = regionRedirects();
  assert.ok(raw.length > 100, `expected the real rule list, got ${raw.length} lines`);
  const pub = existsSync('public/_redirects') ? readFileSync('public/_redirects', 'utf8') : '';
  const r = mergeRedirectRules(pub, raw);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.dropped, 0, 'a generator repeats a rule another one already wrote');
});
