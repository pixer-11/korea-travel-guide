import test from 'node:test';
import assert from 'node:assert/strict';
import { compareCohort, verdict, kindOf, langOf, MIN_COHORT } from './cohort.mjs';

const rows = (pairs) => pairs.map(([url, impressions]) => ({ keys: [url], impressions, clicks: 0 }));
// A cohort of n pages each earning `imp` impressions, so tests can clear MIN_COHORT
// without listing forty URLs by hand.
const many = (n, imp, prefix = 'https://x.test/posts/p') =>
  rows(Array.from({ length: n }, (_, i) => [`${prefix}${i}/`, imp]));

test('a real decline fires the alarm', () => {
  const prev = many(40, 10);
  const next = many(40, 3);
  const c = compareCohort(prev, next);
  assert.equal(c.size, 40);
  assert.equal(verdict(c).level, 'alarm');
});

test('a steady week does NOT fire — the guard must not cry wolf', () => {
  const prev = many(40, 10);
  const next = many(40, 10);
  assert.equal(verdict(compareCohort(prev, next)).level, 'ok');
  // Ordinary wobble stays quiet too.
  assert.equal(verdict(compareCohort(many(40, 10), many(40, 9))).level, 'ok');
});

test('growth is never reported as a decline', () => {
  const c = compareCohort(many(40, 10), many(40, 25));
  assert.ok(c.delta > 0);
  assert.equal(verdict(c).level, 'ok');
});

test('the tail-collapse case: most pages survive, but impressions halve', () => {
  // 08-13~24's actual shape — 70% of the cohort still appeared, yet the cohort's
  // impressions fell 60%. A survival-rate-only check would have called this healthy.
  const prev = many(40, 12);
  const next = [...many(28, 7), ...rows([['https://x.test/posts/gone/', 0]])];
  const c = compareCohort(prev, next);
  assert.equal(c.survived, 28);
  assert.ok(c.survivalRate >= 0.69, `survival ${c.survivalRate}`);
  assert.equal(verdict(c).level, 'alarm');
});

test('single-impression pages are excluded — they measure randomness, not the site', () => {
  const prev = [...many(40, 10), ...many(200, 1, 'https://x.test/posts/noise')];
  const next = many(40, 10); // every noise page vanished; the cohort is unaffected
  const c = compareCohort(prev, next);
  assert.equal(c.size, 40);
  assert.equal(verdict(c).level, 'ok');
});

test('a small cohort is reported as insufficient, not as a verdict', () => {
  const c = compareCohort(many(MIN_COHORT - 1, 10), many(MIN_COHORT - 1, 1));
  assert.equal(verdict(c).level, 'insufficient');
});

test('an empty cohort has a null delta, never 0%', () => {
  const c = compareCohort([], []);
  assert.equal(c.size, 0);
  assert.equal(c.delta, null);
  assert.equal(c.survivalRate, null);
  assert.equal(verdict(c).level, 'insufficient');
});

test('the cohort is fixed by the earlier window — new pages cannot mask a loss', () => {
  const prev = many(40, 10);
  const next = [...many(40, 2), ...many(60, 50, 'https://x.test/posts/brandnew')];
  const c = compareCohort(prev, next);
  assert.equal(c.size, 40);
  assert.equal(verdict(c).level, 'alarm', 'a flood of new pages must not hide the old ones dying');
});

test('breakdown separates the tool pages from the posts', () => {
  const prev = rows([
    ['https://x.test/posts/a/', 10],
    ['https://x.test/tools/when-to-go/japan/march/', 10],
  ]);
  const next = rows([
    ['https://x.test/posts/a/', 10],
    ['https://x.test/tools/when-to-go/japan/march/', 1],
  ]);
  const c = compareCohort(prev, next);
  assert.equal(c.byKind.posts.after, 10);
  assert.equal(c.byKind.tools.after, 1);
});

test('url classification', () => {
  assert.equal(kindOf('https://x.test/ko/tools/when-to-go/india/september/'), 'tools');
  assert.equal(kindOf('https://x.test/posts/bangkok-somsak/'), 'posts');
  assert.equal(kindOf('https://x.test/about/'), 'other');
  assert.equal(langOf('https://x.test/ko/posts/a/'), 'ko');
  assert.equal(langOf('https://x.test/posts/a/'), 'en');
  // A two-letter path segment that is not one of our locales is not a language.
  assert.equal(langOf('https://x.test/eu/posts/a/'), 'en');
});

test('worst list names the biggest absolute losers, largest first', () => {
  const prev = rows([['https://x.test/posts/big/', 100], ['https://x.test/posts/small/', 10]]);
  const next = rows([['https://x.test/posts/big/', 40], ['https://x.test/posts/small/', 1]]);
  const c = compareCohort(prev, next);
  assert.equal(c.worst[0].url, 'https://x.test/posts/big/');
  assert.equal(c.worst.length, 2);
});
