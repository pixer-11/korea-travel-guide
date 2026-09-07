// ─────────────────────────────────────────────────────────────
//  The link-destination gate, tested in BOTH directions.
//
//  It shipped with the same defect it exists to catch: run against an empty or
//  wrong dist it printed a tick and exited 0 (found 2026-09-07). A gate that
//  passes on no input is worse than no gate — it is a green light nobody earned.
//  So: it must FAIL on an empty build, FAIL on a broken switcher, and PASS on a
//  healthy one. All three, or the guard is not a guard.
// ─────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = 'scripts/audit-link-destinations.mjs';
const run = (dir) => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

const page = (root, url, html) => {
  const dir = join(root, ...url.split('/').filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
};

// A site big enough to be a site: the floor is 50 built pages.
function siteWith(root, toolHtml) {
  for (let i = 0; i < 60; i++) page(root, `/filler-${i}/`, '<html><body>ok</body></html>');
  page(root, '/tools/x/', toolHtml);
  page(root, '/ko/tools/x/', '<html><body>ko</body></html>');
}

const fresh = () => mkdtempSync(join(tmpdir(), 'linkdest-'));

test('an empty build is a failure, not a pass', () => {
  const dir = fresh();
  try {
    const r = run(dir);
    assert.equal(r.status, 1, `empty dist must fail, got ${r.status}: ${r.stdout}`);
    assert.match(r.stdout, /Refusing to report a pass/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a switcher that drops the reader at the locale root is caught', () => {
  const dir = fresh();
  try {
    siteWith(dir, '<html><body><a href="/ko/">한국어</a></body></html>');
    const r = run(dir);
    assert.equal(r.status, 1, `broken switcher must fail: ${r.stdout}`);
    assert.match(r.stdout, /LINK-DESTINATION: \/tools\/x\/ — the 한국어 button drops the reader/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a switcher that keeps the path passes', () => {
  const dir = fresh();
  try {
    siteWith(dir, '<html><head><link rel="alternate" hreflang="ko" href="https://wanderatlasguides.com/ko/tools/x/">'
      + '</head><body><a href="/ko/tools/x/">한국어</a></body></html>');
    const r = run(dir);
    assert.equal(r.status, 0, `healthy site must pass: ${r.stdout}`);
    assert.match(r.stdout, /✓ link destinations/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an hreflang pointing at a page that was never built is caught', () => {
  const dir = fresh();
  try {
    siteWith(dir, '<html><head><link rel="alternate" hreflang="ja" href="https://wanderatlasguides.com/ja/tools/x/">'
      + '</head><body>no switcher</body></html>');
    const r = run(dir);
    assert.equal(r.status, 1, `dangling hreflang must fail: ${r.stdout}`);
    assert.match(r.stdout, /hreflang ja points at \/ja\/tools\/x\/, which was not built/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing dist is a failure, not "nothing to do"', () => {
  const r = run(join(tmpdir(), 'linkdest-does-not-exist-9f2a'));
  assert.equal(r.status, 1, `missing dist must fail, got ${r.status}: ${r.stdout}`);
  assert.match(r.stdout, /^LINK-DESTINATION: dist not found/m);
});

// ── the holes Codex found on 2026-09-07, each reproduced first ────────────
const A = (href, label) => `<a href="${href}" lang="x" hreflang="x" class="topbar-lang">${label}</a>`;

test('sibling templates are not collapsed into one sampled shape', () => {
  const dir = fresh();
  try {
    // Five tool pages, as the real site has. Only the last one is broken. Under
    // the old allowlist shaping all five became /tools/*/, two were sampled, and
    // a broken fifth went unseen.
    for (let i = 0; i < 60; i++) page(dir, `/filler-${i}/`, '<html><body>ok</body></html>');
    for (const t of ['best-time', 'esim', 'when-to-go', 'widget']) {
      page(dir, `/tools/${t}/`, '<html><body>ok</body></html>');
      page(dir, `/ko/tools/${t}/`, '<html><body>ko</body></html>');
    }
    page(dir, '/tools/whats-closed/', `<html><body>${A('/ko/', '한국어')}</body></html>`);
    page(dir, '/ko/tools/whats-closed/', '<html><body>ko</body></html>');

    const r = run(dir);
    assert.equal(r.status, 1, `the fifth tool must be sampled: ${r.stdout}`);
    assert.match(r.stdout, /\/tools\/whats-closed\/ — the 한국어 button drops the reader/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the English button is checked too', () => {
  const dir = fresh();
  try {
    for (let i = 0; i < 60; i++) page(dir, `/filler-${i}/`, '<html><body>ok</body></html>');
    page(dir, '/about/', '<html><body>en</body></html>');
    // A Korean page whose English button dumps the reader on the homepage.
    page(dir, '/ko/about/', `<html><body>${A('/', 'English')}</body></html>`);
    const r = run(dir);
    assert.equal(r.status, 1, `English switcher must be checked: ${r.stdout}`);
    assert.match(r.stdout, /\/ko\/about\/ — the English button drops the reader/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a label wrapped in a span is still found', () => {
  const dir = fresh();
  try {
    siteWith(dir, `<html><body><a href='/ko/'><span>한국어</span></a></body></html>`);
    const r = run(dir);
    assert.equal(r.status, 1, `wrapped label must not be skipped: ${r.stdout}`);
    assert.match(r.stdout, /the 한국어 button drops the reader/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a switcher pointing at another domain is caught', () => {
  const dir = fresh();
  try {
    siteWith(dir, `<html><body>${A('https://evil.example/ko/tools/x/', '한국어')}</body></html>`);
    const r = run(dir);
    assert.equal(r.status, 1, `off-site href must be caught: ${r.stdout}`);
    assert.match(r.stdout, /points off-site, at https:\/\/evil\.example/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unparseable alternate is reported, not skipped', () => {
  const dir = fresh();
  try {
    siteWith(dir, '<html><head><link rel="alternate" hreflang="ko" href="https://[broken">'
      + '</head><body>x</body></html>');
    const r = run(dir);
    assert.equal(r.status, 1, `unparseable href must be caught: ${r.stdout}`);
    assert.match(r.stdout, /is not a usable URL/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
