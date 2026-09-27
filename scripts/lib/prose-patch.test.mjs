import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { paragraphDiff, recordRepair, pruneRecords, patchFor, applyEdits, loadRecords, saveRecords, patchPrompt } from './prose-patch.mjs';

test('paragraphDiff names only the paragraphs that changed', () => {
  const before = 'Intro stays.\n\nAddress is 29 Smith St, a two-minute walk from Chinatown MRT.\n\nOutro stays.';
  const after = 'Intro stays.\n\nIt is a short walk from Chinatown MRT.\n\nOutro stays.';
  assert.deepEqual(paragraphDiff(before, after), {
    removed: ['Address is 29 Smith St, a two-minute walk from Chinatown MRT.'],
    added: ['It is a short walk from Chinatown MRT.'],
  });
  // CRLF and a repeated paragraph do not confuse it.
  assert.deepEqual(paragraphDiff('A\r\n\r\nA\r\n\r\nB', 'A\n\nA\n\nB'), { removed: [], added: [] });
  assert.deepEqual(paragraphDiff('A\n\nA', 'A'), { removed: ['A'], added: [] });
});

test('repairs are kept as separate steps; a break in the chain starts over', () => {
  const r = {};
  recordRepair(r, 'p', 'h1', 'h2', { removed: ['a'], added: ['b'] }, new Date('2026-09-26'));
  recordRepair(r, 'p', 'h2', 'h3', { removed: ['c'], added: ['d'] }, new Date('2026-10-03'));
  assert.deepEqual(r.p.steps.map((s) => [s.from, s.to]), [['h1', 'h2'], ['h2', 'h3']]);
  // The post changed some other way in between: the old steps no longer lead here.
  recordRepair(r, 'p', 'hX', 'hY', { removed: ['e'], added: ['f'] });
  assert.deepEqual(r.p.steps.map((s) => [s.from, s.to]), [['hX', 'hY']]);
});

test('only an unbroken run of steps from the stored hash to the current one qualifies', () => {
  const r = {};
  recordRepair(r, 'p', 'h1', 'h2', { removed: ['a'], added: ['b'] });
  assert.deepEqual(patchFor(r.p, 'h1', 'h2'), { removed: ['a'], added: ['b'] });
  assert.equal(patchFor(r.p, 'h0', 'h2'), null, 'translation older than every step: full translation');
  assert.equal(patchFor(r.p, 'h1', 'h3'), null, 'post changed again after the repair: full translation');
  assert.equal(patchFor(r.p, null, 'h2'), null, 'legacy file without a hash');
  assert.equal(patchFor(undefined, 'h1', 'h2'), null);
  assert.equal(patchFor({ steps: [{ from: 'h1', to: 'h2', removed: [], added: [] }] }, 'h1', 'h2'), null);
  assert.equal(patchFor({ steps: [{ from: 'h1', to: 'h2', removed: ['a'], added: [] }, { from: 'h9', to: 'h3', removed: ['b'], added: [] }] }, 'h1', 'h3'), null, 'gap in the chain');
});

test('two weeks of repairs: caught-up and lagging translations both patch, with the NET change', () => {
  // Week 1 replaces a price paragraph; week 2 deletes that paragraph outright.
  const r = {};
  recordRepair(r, 'p', 'A', 'B', { removed: ['Entry is $12.'], added: ['Entry is about $10.'] });
  recordRepair(r, 'p', 'B', 'C', { removed: ['Entry is about $10.'], added: [] });
  // A translation that caught up to B needs only week 2 (Codex: the merged
  // first version sent it to a full re-translation every week).
  assert.deepEqual(patchFor(r.p, 'B', 'C'), { removed: ['Entry is about $10.'], added: [] });
  // A translation still at A must NOT be shown week 1's price as current text
  // (Codex: the merged version listed it under "as they are now").
  assert.deepEqual(patchFor(r.p, 'A', 'C'), { removed: ['Entry is $12.'], added: [] });
});

test('edits apply only when each find matches exactly once', () => {
  const t = '주소는 스미스 거리 29번지이며 차이나타운역에서 걸어서 2분입니다.\n\n다른 문단입니다.';
  assert.equal(applyEdits(t, [{ find: '주소는 스미스 거리 29번지이며 차이나타운역에서 걸어서 2분입니다.', replace: '차이나타운역에서 가깝습니다.' }]),
    '차이나타운역에서 가깝습니다.\n\n다른 문단입니다.');
  assert.equal(applyEdits(t, []), t, 'no meaning change: nothing to do');
  assert.equal(applyEdits(t, [{ find: '없는 문장', replace: 'x' }]), null);
  assert.equal(applyEdits('가 가', [{ find: '가', replace: '나' }]), null, 'ambiguous find');
  assert.equal(applyEdits(t, [{ find: '', replace: 'x' }]), null);
  assert.equal(applyEdits(t, [{ find: '다른' }]), null, 'replace missing');
  assert.equal(applyEdits(t, 'nope'), null);
  // Deleting a whole paragraph leaves no triple newline behind.
  assert.equal(applyEdits('A\n\nB\n\nC', [{ find: 'B', replace: '' }]), 'A\n\nC');
});

test('records survive a save/load round trip and old ones are pruned', () => {
  const file = pathToFileURL(join(mkdtempSync(join(tmpdir(), 'pp-')), 'p.json'));
  assert.deepEqual(loadRecords(file), {}, 'missing file reads as empty');
  const r = {
    new: { steps: [{ from: 'a', to: 'b', at: '2026-09-26T00:00:00Z', removed: ['x'], added: [] }] },
    old: { steps: [{ from: 'c', to: 'd', at: '2026-07-01T00:00:00Z', removed: ['y'], added: [] }] },
    mixed: { steps: [
      { from: 'e', to: 'f', at: '2026-07-01T00:00:00Z', removed: ['z'], added: [] },
      { from: 'f', to: 'g', at: '2026-09-26T00:00:00Z', removed: ['w'], added: [] },
    ] },
  };
  pruneRecords(r, new Date('2026-09-28'));
  assert.deepEqual(Object.keys(r), ['new', 'mixed']);
  assert.deepEqual(r.mixed.steps.map((s) => s.from), ['f'], 'an old step goes, a recent one stays');
  saveRecords(r, file);
  assert.deepEqual(loadRecords(file), r);
});

test('wiring: the repair records, the audit commits the record, the translator patches only stale files', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const repair = read('scripts/repair-prose.mjs');
  assert.match(repair, /recordRepair\(patches, row\.slug, srcHashOfPostFile\(raw\), srcHashOfPostFile\(next\), paragraphDiff\(body, out\)\)/);
  assert.match(repair, /if \(!DRY && done\) saveRecords\(pruneRecords\(patches\)\)/);
  // The record reaches the publish run only if the audit job commits it, and
  // `git add` of a missing path fails the step — so the file is tracked from birth.
  assert.match(read('.github/workflows/full-audit.yml'), /git add [^\n]*data\/prose-patches\.json/);
  assert.deepEqual(JSON.parse(read('data/prose-patches.json')), JSON.parse(read('data/prose-patches.json')));
  const tr = read('scripts/translate-posts.mjs');
  // Only inside the stale branch: --only/--force name files that are WRONG, and
  // those must be translated in full, not patched.
  const branch = tr.slice(tr.indexOf('if (!FORCE && !ONLY.length) {'), tr.indexOf('jobs.push({ lang, id, data, hash });'));
  assert.match(branch, /const patch = patchFor\(PATCHES\[id\], stored, hash\);/);
  // The batch must send a patch job the PATCH request: sending it translateParams
  // would pay for a full translation, see no edits, and pay again (Codex, 09-28).
  assert.match(tr, /params: j\.patch \? patchParams\(j\.lang, j\) : translateParams\(j\.lang, j\.data\)/);
  // A patched reply goes into translateOne as attempt 1, so every gate runs on it
  // and a failed gate re-translates in full.
  assert.match(tr, /if \(j\.patch\) pre = await patchedReply\(j, pre\);\s*await translateOne\(j\.lang, j\.id, j\.data, j\.hash, 1, pre\);/);
});

test('the patch prompt carries both sides of the change and the whole translation', () => {
  const p = patchPrompt('Korean', 'Use 합니다체.', { removed: ['Old EN.'], added: ['New EN.'] }, '현재 번역 본문');
  assert.match(p, /AS THEY WERE[\s\S]*Old EN\.[\s\S]*AS THEY ARE NOW[\s\S]*New EN\.[\s\S]*CURRENT KOREAN TEXT\n현재 번역 본문$/);
  assert.match(p, /empty edit list/);
});
