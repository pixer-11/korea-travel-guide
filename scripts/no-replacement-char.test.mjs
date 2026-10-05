// No broken letter (U+FFFD) ships. 2026-09-27..10-05 the batch translation
// reader cut multi-byte letters at network chunk boundaries and 523
// translations went live with one — in titles, meta descriptions and FAQ
// JSON-LD — while every checker passed: none of them looked for the one
// character that means "a letter was lost here". The translator now refuses it
// before writing (translate-posts.mjs); this catches every OTHER writer into
// src/, the class rather than the instance.
// data/ is left out on purpose: its audit ledgers quote broken text as evidence.
//   node --test scripts/no-replacement-char.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPLACEMENT_CHAR } from './lib/replacement-char.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEXT = /\.(md|mdx|json|ts|mjs|js|astro|css|ya?ml|txt|svg)$/;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (TEXT.test(e.name)) yield p;
  }
}

test('no file under src/ carries U+FFFD', () => {
  const hits = [];
  let seen = 0;
  for (const p of walk(join(ROOT, 'src'))) {
    seen++;
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((l, i) => { if (l.includes(REPLACEMENT_CHAR)) hits.push(`${relative(ROOT, p)}:${i + 1}`); });
  }
  // Must not pass blind: src/content/i18n alone holds thousands of files.
  assert.ok(seen > 5000, `only ${seen} files scanned`);
  assert.deepEqual(hits, [], `${hits.length} line(s) with a broken letter (U+FFFD) — repair with scripts/repair-replacement-chars.mjs:\n  ${hits.slice(0, 20).join('\n  ')}`);
});
