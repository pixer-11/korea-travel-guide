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

// 2026-10-05: 304 quarantined posts × 5 languages put _redirects at 2,027
// rules, past Cloudflare's 2,000 cap, and the deploy stopped. Quarantine now
// goes to the worker as a table; _redirects must stay well under the cap and
// must not carry a held post's rescue any more.
test('_redirects stays under the cap; every held post is in the worker table instead', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { regionRedirects, quarantineRedirectMap } = await import('../../astro.config.mjs');
  const lines = regionRedirects();
  assert.ok(lines.length < 1600, `${lines.length} rules — Cloudflare drops everything past 2,000`);
  const held = readdirSync('src/content/posts')
    .filter((f) => f.endsWith('.md') && /(?:^|\n)draft:\s*true/.test(readFileSync(`src/content/posts/${f}`, 'utf8').split('---')[1] || ''))
    .map((f) => f.replace(/\.md$/, ''));
  const table = quarantineRedirectMap();
  assert.deepEqual(Object.keys(table).sort(), held.sort());
  for (const v of Object.values(table)) assert.match(v, /^$|^[a-z0-9%-]+$/, `table value ${v}`);
  const ownLine = new Set(lines.map((l) => l.split(' ')[0]));
  for (const slug of held) assert.ok(!ownLine.has(`/posts/${slug}/`) || lines.some((l) => l.startsWith(`/posts/${slug}/ /posts/`)), `${slug} still has a _redirects line`);
});

