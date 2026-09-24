// data/visual-audit.json — one format, and proof that it stops losing verdicts.
//   node --test scripts/lib/visual-audit-store.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serializeAuditStore, VISUAL_AUDIT_PATH } from './visual-audit-store.mjs';

const SEP = '\u0001';
const row = (slug, verdict = 'MISMATCH') => ({ slug, verdict, reason: `r-${slug}`, at: '2026-09-24T00:00:00.000Z' });

test('keys come out sorted, rows untouched, one-space indent, trailing newline', () => {
  const store = {
    [`zeta${SEP}u`]: row('zeta'),
    [`alpha${SEP}u`]: { verdict: 'MATCH', slug: 'alpha', at: 'x' }, // inner order kept as given
  };
  const text = serializeAuditStore(store);
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.indexOf('alpha') < text.indexOf('zeta'), 'top-level keys sorted');
  assert.match(text, /^\{\n "alpha\\u0001u": \{\n  "verdict": "MATCH",\n  "slug": "alpha"/, 'one-space indent, inner order as given');
  assert.deepEqual(JSON.parse(text), store, 'same data');
});

test('serializing twice changes nothing — a no-op write is a no-op diff', () => {
  const once = serializeAuditStore({ [`b${SEP}u`]: row('b'), [`a${SEP}u`]: row('a') });
  assert.equal(serializeAuditStore(JSON.parse(once)), once);
});

// The committed file itself. A writer that bypasses the shared serializer
// reshuffles or reindents all ~20,600 lines; this turns the Tests workflow red
// on that push instead of letting it become the next bot's merge conflict.
test('the committed data/visual-audit.json is in the one format', () => {
  const raw = readFileSync(VISUAL_AUDIT_PATH, 'utf8').replace(/\r\n/g, '\n'); // Windows checkouts add CR
  assert.equal(raw, serializeAuditStore(JSON.parse(raw)),
    'data/visual-audit.json was written by something that bypasses scripts/lib/visual-audit-store.mjs');
});

// ── The reason this module exists: two bots, one night, remote-first rebase ──
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'va-store-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('config', 'core.autocrlf', 'false');
  return { dir, git, done: () => rmSync(dir, { recursive: true, force: true }) };
}

// Base has 40 verdicts; bot A and bot B each add one on the same night, A
// pushes first, B rebases onto A with git-push-retry's -X ours. Returns the
// slugs that survive in B's result.
function twoBots(write, keyA, keyB) {
  const r = repo();
  try {
    const base = {};
    for (let i = 0; i < 40; i++) base[`m${String(i).padStart(2, '0')}${SEP}u`] = row(`m${i}`);
    const f = join(r.dir, 'v.json');
    write(f, base); r.git('add', '.'); r.git('commit', '-qm', 'base');
    r.git('checkout', '-qb', 'botA');
    write(f, { ...base, [keyA]: row('A') }); r.git('commit', '-qam', 'A');
    r.git('checkout', '-q', 'main'); r.git('checkout', '-qb', 'botB');
    write(f, { ...base, [keyB]: row('B') }); r.git('commit', '-qam', 'B');
    try { r.git('rebase', '-X', 'ours', 'botA'); } catch { /* a conflict -X could not settle */ }
    const got = JSON.parse(readFileSync(f, 'utf8'));
    return [keyA, keyB].filter((k) => k in got);
  } finally { r.done(); }
}

const appendAtEnd = (f, s) => writeFileSync(f, JSON.stringify(s, null, 1) + '\n'); // what all 12 writers did
const shared = (f, s) => writeFileSync(f, serializeAuditStore(s));

test('OLD way (append at the end): the later bot’s verdict is dropped by the remote-first rebase', () => {
  const kept = twoBots(appendAtEnd, `apple${SEP}u`, `mango${SEP}u`);
  assert.deepEqual(kept, [`apple${SEP}u`], 'reproduces the loss this module exists to stop');
});

test('NEW way (sorted): both bots’ verdicts survive the same rebase', () => {
  const kept = twoBots(shared, `apple${SEP}u`, `mango${SEP}u`);
  assert.deepEqual(kept, [`apple${SEP}u`, `mango${SEP}u`]);
});
