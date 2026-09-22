import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveTwinIndex, liveTwinOf, noteLive } from './live-twin.mjs';
import { readFrontmatter } from './frontmatter-edit.mjs';

/** Write one post file into a scratch posts dir. */
const post = (dir, slug, fields) => {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : v}`);
  if (fields.place) {
    lines.push('place:');
    for (const [k, v] of Object.entries(fields.place)) lines.push(`  ${k}: '${v}'`);
  }
  writeFileSync(join(dir, `${slug}.md`), `---\n${lines.join('\n')}\n---\n\nBody.\n`, 'utf8');
};

const withDir = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'live-twin-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const twin = (dir, slug) => {
  const raw = readFileSync(join(dir, `${slug}.md`), 'utf8');
  return liveTwinOf(slug, readFrontmatter(raw), liveTwinIndex(dir));
};

test('a quarantined post whose place.id is already live names its twin', () => {
  withDir((dir) => {
    post(dir, 'singapore-lau-pa-sat', { title: 'Lau Pa Sat: Where to Eat in Singapore', region: 'Singapore', place: { id: 'PLACE_1' } });
    post(dir, 'sentosa-lau-pa-sat', { title: 'Lau Pa Sat: Where to Eat in Sentosa', region: 'Sentosa', draft: true, place: { id: 'PLACE_1' } });
    assert.equal(twin(dir, 'sentosa-lau-pa-sat'), 'singapore-lau-pa-sat');
  });
});

// The case the place.id check cannot see, and the reason this module exists: a
// post written before it had coordinates carries no id at all.
test('a PLACELESS quarantined post is caught by title + region', () => {
  withDir((dir) => {
    post(dir, 'madrid-el-campero', { title: 'El Campero: Where to Eat in Madrid', region: 'Madrid' });
    post(dir, 'madrid-el-campero-madrid', { title: 'El Campero Madrid in Madrid', region: 'Madrid', draft: true });
    assert.equal(twin(dir, 'madrid-el-campero-madrid'), 'madrid-el-campero');
  });
});

// Both halves of a blocker have to be measured. A quarantine with nothing like
// it on the site must release freely, or the patrol stops repairing anything.
test('an unrelated quarantined post has no twin', () => {
  withDir((dir) => {
    post(dir, 'madrid-el-campero', { title: 'El Campero: Where to Eat in Madrid', region: 'Madrid' });
    post(dir, 'madrid-sobrino-de-botin', { title: 'Sobrino de Botin: Where to Eat in Madrid', region: 'Madrid', draft: true });
    assert.equal(twin(dir, 'madrid-sobrino-de-botin'), null);
  });
});

// Two DRAFTS are not a release hazard: neither is live, so whichever is
// released first becomes the twin the other one then sees.
test('a second draft is not a twin', () => {
  withDir((dir) => {
    post(dir, 'tokyo-a', { title: 'Kissa Sakaiki: Tokyo Travel Guide', region: 'Tokyo', draft: true, place: { id: 'PLACE_2' } });
    post(dir, 'tokyo-b', { title: 'Kissa Sakaiki: Tokyo Travel Guide', region: 'Tokyo', draft: true, place: { id: 'PLACE_2' } });
    assert.equal(twin(dir, 'tokyo-a'), null);
  });
});

// …but only until one of them is released. A patrol clearing both in one pass
// reads an index taken at startup, so the first release has to be recorded or
// the second one publishes the twin the check just prevented.
test('a post released this run becomes a twin for the next one', () => {
  withDir((dir) => {
    post(dir, 'tokyo-a', { title: 'Kissa Sakaiki: Tokyo Travel Guide', region: 'Tokyo', draft: true, place: { id: 'PLACE_2' } });
    post(dir, 'tokyo-b', { title: 'Kissa Sakaiki: Tokyo Travel Guide', region: 'Tokyo', draft: true, place: { id: 'PLACE_2' } });
    const index = liveTwinIndex(dir);
    const fmA = readFrontmatter(readFileSync(join(dir, 'tokyo-a.md'), 'utf8'));
    const fmB = readFrontmatter(readFileSync(join(dir, 'tokyo-b.md'), 'utf8'));
    assert.equal(liveTwinOf('tokyo-a', fmA, index), null);
    noteLive(index, 'tokyo-a', fmA); // tokyo-a goes live
    assert.equal(liveTwinOf('tokyo-b', fmB, index), 'tokyo-a');
  });
});

// A post never matches itself — the live index contains it once it is released,
// and re-running the check must not then report it as its own duplicate.
test('a live post is not its own twin', () => {
  withDir((dir) => {
    post(dir, 'tokyo-solo', { title: 'Kissa Sakaiki: Tokyo Travel Guide', region: 'Tokyo', place: { id: 'PLACE_3' } });
    assert.equal(twin(dir, 'tokyo-solo'), null);
  });
});
