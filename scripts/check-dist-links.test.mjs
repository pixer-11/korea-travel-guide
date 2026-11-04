// check-dist-links: the link-check workflow's crawl, without a server (2026-11-04).
// Both directions are pinned — what it must catch, and what it must leave alone —
// because a resolver that calls everything present can only ever report "clean".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDist } from './check-dist-links.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-dist-links.mjs');

function site(files) {
  const dir = mkdtempSync(join(tmpdir(), 'distlinks-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

const broken = (dir) => [...checkDist(dir).seen].filter(([, s]) => !s.ok).map(([p]) => p).sort();

test('missing pages, files and srcset candidates are caught', () => {
  const dir = site({
    'index.html': `<a href="/posts/gone/">x</a><a href="https://wanderatlasguides.com/ko/missing/">y</a>
      <img src="/img/nope.webp" srcset="/img/a.webp 400w, /img/b.webp 800w"><a href="sub">rel</a>`,
    'img/a.webp': '',
  });
  try {
    assert.deepEqual(broken(dir), ['/img/b.webp', '/img/nope.webp', '/ko/missing/', '/posts/gone/', '/sub']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('what serve answers 200 for is left alone', () => {
  const dir = site({
    'index.html': `<a href="/posts/a/">a</a><a href="/posts/a">slashless</a><a href="/about">clean url</a>
      <a href="/%EC%84%9C%EC%9A%B8/">encoded</a><a href="/posts/a/?x=1&amp;y=2#top">query</a>
      <link rel="stylesheet" href="/_astro/s.css"><a href="#top">hash</a><a href="mailto:a@b.c">mail</a>
      <a href="https://example.com/x">off-site</a><a href="/go/klook/?to=1">worker</a><img src="/og/abc.webp">
      <a href="/api/subscribe">api</a><a href="/preferences/">prefs</a>
      <script>el.innerHTML = \`<a href="\${t.dataset.checklist}">\`;</script><!-- <a href="/commented/"> -->`,
    'posts/index.html': '',
    'posts/a/index.html': '<a href="../">up</a><a href="b/">rel</a>',
    'posts/a/b/index.html': '',
    'about.html': '',
    '서울/index.html': '',
    '_astro/s.css': '',
  });
  try {
    assert.deepEqual(broken(dir), []);
    assert.ok(checkDist(dir).seen.size >= 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Codex review (11-04): everything linkinator reads, not only quoted href/src.
test('unquoted, poster/cite/data, <base>, meta refresh and tight srcset are all read', () => {
  const dir = site({
    'index.html': `<a href=/u1/>u</a><video poster="/v.jpg"></video><blockquote cite="/c/"></blockquote>
      <object data='/o.svg'></object><meta http-equiv="refresh" content="0; url=/moved/">
      <img srcset="/s1.webp 1x,/s2.webp 2x"><script type="module" src="/missing.js"></script>`,
    'b/index.html': '<base href="/other/"><a href="gone">g</a><a href="ok">k</a>',
    'other/ok/index.html': '',
    'emptydir/x.txt': '',
    'd/index.html': '<a href="/emptydir/">dir</a><a href="/about/">about</a>',
    'about.html': '',
  });
  try {
    assert.deepEqual(broken(dir), ['/c/', '/emptydir/', '/missing.js', '/moved/', '/o.svg', '/other/gone', '/s1.webp', '/s2.webp', '/u1/', '/v.jpg']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the command writes the crawl-shaped csv, one BROKEN row per linking page', () => {
  const dir = site({
    'index.html': '<a href="/gone/">g</a>',
    'x/index.html': '<a href="/gone/">g</a><a href="/">home</a>',
  });
  try {
    const csv = execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const rows = csv.trim().split('\n');
    assert.equal(rows[0], 'url,status,state,parent');
    assert.equal(rows.filter((r) => r.includes(',404,BROKEN,')).length, 2);
    assert.ok(rows.includes('https://wanderatlasguides.com/,200,OK,https://wanderatlasguides.com/x/'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an empty dist is a failure, not a clean report', () => {
  const dir = site({ 'robots.txt': '' });
  try {
    assert.throws(() => execFileSync(process.execPath, [SCRIPT, dir], { stdio: 'ignore' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
