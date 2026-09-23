// 2026-09-23: this tool appended `draft: true` before the closing fence, on the
// assumption that a live post has no draft key. Posts from the publish pipeline
// carry an explicit `draft: false`, so every firing produced a duplicate key and
// js-yaml refused the whole file. These run the REAL script — the defect lived
// in the write path, which no pure-function test would ever have touched.
//   node --test scripts/requarantine-mismatches.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

const SCRIPT = join(process.cwd(), 'scripts', 'requarantine-mismatches.mjs');
const HERO = 'https://upload.wikimedia.org/wikipedia/commons/5/5c/Small_shop.jpg';
const NL = '\n';

function post({ draft } = {}) {
  const lines = ['---', 'title: A small shop', 'category: hidden-gem', 'region: Dubai', 'heroImage:', `  url: ${HERO}`];
  if (draft !== undefined) lines.push(`draft: ${draft}`);
  lines.push("updatedDate: '2026-09-22'", '---', '', 'Body.', '');
  return lines.join(NL);
}

function run(files, verdict) {
  const root = mkdtempSync(join(tmpdir(), 'requarantine-'));
  const posts = join(root, 'posts');
  mkdirSync(posts);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(posts, name), text, 'utf8');
  const store = join(root, 'visual-audit.json');
  const rows = {};
  for (const slug of Object.keys(files).map((f) => f.replace(/\.md$/, ''))) {
    rows[`${slug}\x01${HERO}`] = { slug, verdict, reason: 'hero is only 612px wide', at: '2026-09-22T22:25:21Z' };
  }
  writeFileSync(store, JSON.stringify(rows), 'utf8');
  const out = execFileSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, REQUARANTINE_POSTS: posts, REQUARANTINE_STORE: store },
  });
  const read = (name) => readFileSync(join(posts, name), 'utf8');
  return { out, read, done: () => rmSync(root, { recursive: true, force: true }) };
}

const frontmatter = (raw) => raw.split(NL + '---')[0].replace(/^---\n/, '');
const draftLines = (raw) => frontmatter(raw).split(NL).filter((l) => /^draft:/.test(l));

test('explicit `draft: false` becomes ONE `draft: true` — the 09-23 shape', () => {
  const r = run({ 'a.md': post({ draft: false }) }, 'MISMATCH');
  const raw = r.read('a.md');
  r.done();
  assert.deepEqual(draftLines(raw), ['draft: true'], 'exactly one draft key, set to true');
  // The failure was a parse error, so parse it the way the pipeline does.
  assert.doesNotThrow(() => yaml.load(frontmatter(raw)));
  assert.equal(yaml.load(frontmatter(raw)).draft, true);
});

test('a post with no draft key at all still gets quarantined — the 08-08 shape', () => {
  const r = run({ 'a.md': post() }, 'MISMATCH');
  const raw = r.read('a.md');
  r.done();
  assert.deepEqual(draftLines(raw), ['draft: true']);
});

test('the rest of the frontmatter and the body survive untouched', () => {
  const before = post({ draft: false });
  const r = run({ 'a.md': before }, 'MISMATCH');
  const after = r.read('a.md');
  r.done();
  assert.equal(after.replace('draft: true', 'draft: false'), before);
});

test('a MATCH verdict leaves the post live — the enforcer must not over-block', () => {
  const before = post({ draft: false });
  const r = run({ 'a.md': before }, 'MATCH');
  const after = r.read('a.md');
  r.done();
  assert.equal(after, before);
});

test('an already-held post is left alone — nothing to re-assert', () => {
  const before = post({ draft: true });
  const r = run({ 'a.md': before }, 'MISMATCH');
  const after = r.read('a.md');
  r.done();
  assert.equal(after, before);
});
