// No HTML entities in titles or descriptions.
//
// 2026-09-24: a Korean translation stored "ITZY 세 번째 월드투어 &lt;TUNNEL
// VISION&gt;" and a Chinese one "Cheaper &amp; Better". Astro escapes text
// again when it renders, so the reader saw the entity itself — in the events
// list, the <title> and the search snippet. The translator returned escaped
// text; frontmatter is plain YAML and must hold the characters.
//
//   node --test scripts/lib/html-entity-titles.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../src/content/', import.meta.url);
const ENTITY = /&(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/i;

function* mdFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* mdFiles(p);
    else if (name.endsWith('.md')) yield p;
  }
}

test('no title or description carries an HTML entity', () => {
  const bad = [];
  let seen = 0;
  for (const file of mdFiles(ROOT.pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
    const text = readFileSync(file, 'utf8');
    const fm = text.startsWith('---') ? text.slice(3, text.indexOf('\n---', 3)) : '';
    for (const line of fm.split(/\r?\n/)) {
      if (/^(title|description):/.test(line)) {
        seen++;
        if (ENTITY.test(line)) bad.push(`${file.split(/[\\/]content[\\/]/)[1]}: ${line.slice(0, 90)}`);
      }
    }
  }
  assert.ok(seen > 1000, `only ${seen} title/description lines read — the walk is broken`);
  assert.deepEqual(bad, []);
});
