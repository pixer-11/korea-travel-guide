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
  assert.match(branch, /const found = patchFor\(PATCHES\[id\], stored, hash\);/);
  assert.match(branch, /const patch = found && patchIsCheaper\(found, docOf\(data\)\) \? found : null;/);
  // 2026-10-06: the ended-event rewrite records its change too, and the two
  // workflows it runs in commit the record (it is translated the NEXT day).
  const ended = read('scripts/repair-ended-event-editorial.mjs');
  assert.match(ended, /recordRepair\(patches, slug, srcHashOfPostFile\(curRaw\), srcHashOfPostFile\(nextRaw\),\s*fieldDiff\(/);
  assert.match(ended, /if \(!DRY && patchesDirty\) saveRecords\(pruneRecords\(patches\)\)/);
  for (const wf of ['publish.yml', 'alt-photos.yml']) assert.match(read(`.github/workflows/${wf}`), /git add [^\n]*data\/prose-patches\.json/, wf);
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

test('cleanRepairOutput strips the echoed prompt separator and refuses new fences', async () => {
  const { cleanRepairOutput } = await import('./prose-patch.mjs');
  const body = '## Why go\n\nText here.\n\n---\n\nMore.';
  // The 2026-10-03 shape: the separator echoed as the first line.
  assert.deepEqual(cleanRepairOutput('---\n## Why go\n\nText here.\n\n---\n\nMore.', body), { out: '## Why go\n\nText here.\n\n---\n\nMore.' });
  // A fence the article already had is kept.
  assert.deepEqual(cleanRepairOutput(body, body), { out: body });
  // A new one anywhere else is refused.
  assert.ok('reason' in cleanRepairOutput('## Why go\n---\nText here.\n\n---\n\nMore.', body));
});

// 2026-10-06: the ended-event rewrite edits the description, Quick Answer and
// FAQ answers as well as the body. Patches now work on all of them as one
// marked text; anything that disturbs a marker falls back to full translation.
test('docOf and fieldsOf round-trip every translatable field', async () => {
  const { docOf, fieldsOf } = await import('./prose-patch.mjs');
  const f = { description: '설명', quickAnswer: '한 줄 답', faq: [{ q: '언제?', a: '10월.' }, { q: '어디?', a: '광장.\n두 줄.' }], body: '첫 문단.\n\n## 제목\n\n둘째 문단.' };
  assert.deepEqual(fieldsOf(docOf(f), 2), f);
  assert.deepEqual(fieldsOf(docOf({ ...f, faq: [] }), 0), { ...f, faq: [] });
});

test('fieldsOf refuses a doc whose markers or FAQ shape were disturbed', async () => {
  const { docOf, fieldsOf } = await import('./prose-patch.mjs');
  const f = { description: 'd', quickAnswer: 'q', faq: [{ q: 'Q1', a: 'A1' }], body: 'b' };
  const doc = docOf(f);
  assert.equal(fieldsOf(doc, 2), null, 'wrong FAQ count');
  assert.equal(fieldsOf(doc.replace('@@QUICK ANSWER@@\n\n', ''), 1), null, 'a marker removed');
  assert.equal(fieldsOf(doc.replace('Q: Q1\nA: A1', 'A1 only'), 1), null, 'Q/A prefixes lost');
  assert.equal(fieldsOf('stray\n\n' + doc, 1), null, 'text before the first marker');
  assert.equal(fieldsOf(doc.replace(/\nb$/, '\n'), 1), null, 'empty body');
});

test('a description/FAQ/body change is patched end to end', async () => {
  const { docOf, fieldsOf } = await import('./prose-patch.mjs');
  const enBefore = { description: 'Tickets go on sale soon.', quickAnswer: 'It runs in May.', faq: [{ q: 'When?', a: 'May 2026, dates TBA.' }], body: 'Intro.\n\nBook early.' };
  const enAfter = { description: 'Tickets were sold through the venue.', quickAnswer: 'It ran in May.', faq: [{ q: 'When?', a: 'It was set for May 2026.' }], body: 'Intro.\n\nIt was set for May.' };
  const diff = paragraphDiff(docOf(enBefore), docOf(enAfter));
  // markers and the unchanged intro are not part of the change
  assert.ok(diff.removed.every((p) => !p.startsWith('@@')) && !diff.removed.includes('Intro.'));
  assert.equal(diff.removed.length, 4); assert.equal(diff.added.length, 4);
  const ko = { title: 't', description: '곧 판매.', quickAnswer: '5월 개최.', faq: [{ q: '언제?', a: '2026년 5월, 미정.' }], body: '소개.\n\n일찍 예약.' };
  const edits = [{ find: '곧 판매.', replace: '공연장에서 판매되었다.' }, { find: '5월 개최.', replace: '5월에 열렸다.' }, { find: '2026년 5월, 미정.', replace: '2026년 5월로 예정되어 있었다.' }, { find: '일찍 예약.', replace: '5월로 예정되어 있었다.' }];
  const out = fieldsOf(applyEdits(docOf(ko), edits), 1);
  assert.deepEqual(out, { description: '공연장에서 판매되었다.', quickAnswer: '5월에 열렸다.', faq: [{ q: '언제?', a: '2026년 5월로 예정되어 있었다.' }], body: '소개.\n\n5월로 예정되어 있었다.' });
  // an edit that eats a marker is refused, so the caller translates in full
  assert.equal(fieldsOf(applyEdits(docOf(ko), [{ find: '곧 판매.\n\n@@QUICK ANSWER@@', replace: '판매.' }]), 1), null);
});

test('the recorded hashes match the file on disk whatever its line endings', async () => {
  const { srcHashOfPostFile } = await import('./src-hash.mjs');
  const raw = '---\ntitle: T\ndescription: D\nquickAnswer: Q\nfaq:\n  - q: A?\n    a: B.\n---\nBody one.\n\nBody two.\n';
  assert.equal(srcHashOfPostFile(raw), srcHashOfPostFile(raw.replace(/\n/g, '\r\n')));
});

// Measured 2026-10-06: patching a rewrite of most of the page wrote twice the
// output tokens of a full translation. Small repairs patch; big ones do not.
test('a patch is used only while it is cheaper than a full translation', async () => {
  const { patchIsCheaper, docOf } = await import('./prose-patch.mjs');
  const body = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} of the guide, with a sentence or two of ordinary length in it.`).join('\n\n');
  const doc = docOf({ description: 'd', quickAnswer: 'q', faq: [], body });
  const one = { removed: ['Paragraph 3 of the guide, with a sentence or two of ordinary length in it.'], added: ['Paragraph 3, reworded.'] };
  assert.equal(patchIsCheaper(one, doc), true);
  const most = { removed: body.split('\n\n').slice(0, 26), added: body.split('\n\n').slice(0, 26).map((p) => p + ' Past tense now.') };
  assert.equal(patchIsCheaper(most, doc), false);
  assert.equal(patchIsCheaper(one, ''), false);
});

// Codex, 10-06 — three ways a patch could have shipped a wrong translation.
test('a sentence swapped between fields is still recorded as a change', async () => {
  const { fieldDiff, paragraphDiff, docOf } = await import('./prose-patch.mjs');
  const a = { description: 'Tickets were priced at 20 dollars.', quickAnswer: 'Doors were listed as 6pm.', faq: [], body: 'One.\n\nTwo.' };
  const b = { description: 'Doors were listed as 6pm.', quickAnswer: 'Tickets were priced at 20 dollars.', faq: [], body: 'One.\n\nTwo changed.' };
  // the old pooled diff lost the swap…
  assert.equal(paragraphDiff(docOf(a), docOf(b)).removed.length, 1);
  // …the field-tagged one keeps it
  const d = fieldDiff(a, b);
  assert.equal(d.removed.length, 3);
  assert.ok(d.removed.some((p) => p.startsWith('[DESCRIPTION]')) && d.removed.some((p) => p.startsWith('[QUICK ANSWER]')));
});

test('a FAQ section carrying a second Q/A pair is refused', async () => {
  const { docOf, fieldsOf } = await import('./prose-patch.mjs');
  const doc = docOf({ description: 'd', quickAnswer: 'q', faq: [{ q: '¿Cuándo?', a: 'A las seis.' }], body: 'b' });
  assert.equal(fieldsOf(doc.replace('A las seis.', 'A las seis.\nQ: ¿Otra?\nA: Otra respuesta.'), 1), null);
});

test('the translator refuses a patch that empties the description or Quick Answer', async () => {
  const { readFileSync } = await import('node:fs');
  const tr = readFileSync(new URL('../translate-posts.mjs', import.meta.url), 'utf8');
  assert.match(tr, /for \(const k of \['description', 'quickAnswer'\]\) \{\s*if \(String\(job\.data\?\.\[k\] \?\? ''\)\.trim\(\) && !fields\[k\]\) throw/);
});
