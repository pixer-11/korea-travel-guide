// No English-literal aria-label in a component: screen readers read it on
// every localized page too. Seven breadcrumbs and the footer's social nav said
// "breadcrumb" / "Wander Atlas on social media" on /ko/, /ja/, /es/, /zh/
// while their own key t('a11y.breadcrumb') existed (2026-10-05 audit).
//   node --test scripts/aria-label-literal.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const BRAND_ONLY = new Set(['iPhone / Android']);
const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? (f === 'content' ? [] : walk(p)) : f.endsWith('.astro') ? [p] : [];
});

test('aria-labels go through t(), not English literals', () => {
  const bad = [];
  let files = 0;
  for (const p of walk(SRC)) {
    files++;
    for (const m of readFileSync(p, 'utf8').matchAll(/aria-label="([A-Za-z][^"]*)"/g)) {
      if (!BRAND_ONLY.has(m[1])) bad.push(`${p.slice(SRC.length)}: "${m[1]}"`);
    }
  }
  assert.ok(files > 50, `only ${files} components read`);
  assert.deepEqual(bad, []);
});
