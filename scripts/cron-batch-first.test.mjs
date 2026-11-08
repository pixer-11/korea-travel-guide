// Four cron-only Claude jobs send their first attempts through the Batches API
// at half price (2026-11-08). The saving is only free if the output cannot
// change, so what is held here is the shape: the batch and the direct call are
// built from one request, and anything the batch did not return still goes
// direct. The scripts run on import, so their wiring is read, not called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// One key per job spells both ends: what the batch is sent under and what the
// reply is read back with. If they part, every reply is paid for and never found,
// and the post is asked again at full price, so the run costs about 150% and
// nothing else changes for anything to notice.
const JOBS = [
  { file: 'scripts/full-content-audit.mjs', params: 'editorParams', key: 'p.slug', reply: (k) => `editorCheck(p, editorReplies.get(${k}) ?? null)` },
  { file: 'scripts/repair-prose.mjs', params: 'repairParams', key: 'row.slug', reply: (k) => `repair(body.trim(), live, fm.title, firsts.get(${k}) ?? null)` },
  { file: 'scripts/build-essentials.mjs', params: 'researchParams', key: 'c.name', reply: (k) => `research(c.name, baseline, firsts.get(${k}) ?? null)` },
  { file: 'scripts/translate-essentials.mjs', params: 'translateParams', key: 'jobId(j)', reply: (k) => `translateOne(j.lang, j.slug, j.data, j.hash, firsts.get(${k}) ?? null)` },
];

const WRONG_ID = 'the batch is not sent under the key its reply is read with';
const NO_REPLY = 'the batch reply never reaches the caller';

function wiringProblems(src, { params, key, reply }) {
  const found = [];
  if (!/from '\.\/lib\/claude-batch\.mjs'/.test(src)) found.push('does not use the shared batch runner');
  if (!new RegExp(`params: ${params}\\(`).test(src)) found.push('the batch does not use the shared request');
  if (!new RegExp(`\\|\\| await client\\.messages\\.create\\(${params}\\(`).test(src)) found.push('a reply the batch did not return has no direct path');
  if (!src.includes(`id: ${key}, params: ${params}(`)) found.push(WRONG_ID);
  if (!src.includes(reply(key))) found.push(NO_REPLY);
  // Exactly the one request builder: a second inline request is how the two drift.
  if ((src.match(/client\.messages\.create\(/g) ?? []).length !== 1) found.push('more than one direct request in the file');
  return found;
}

for (const job of JOBS) {
  test(`${job.file}: batch first, direct for the rest, one shared request`, () => {
    assert.deepEqual(wiringProblems(read(job.file), job), []);
  });
}

test('the check sees a job that batches a different request, or drops the direct path', () => {
  const job = JOBS[3];
  const src = read(job.file);
  const drifted = src.replace(`params: ${job.params}(j.lang, j.data)`, 'params: { model: MODEL }');
  assert.ok(wiringProblems(drifted, job).includes('the batch does not use the shared request'));
  const noDirect = src.replace(`reply || await client.messages.create(${job.params}(langCode, data))`, 'reply');
  assert.ok(wiringProblems(noDirect, job).includes('a reply the batch did not return has no direct path'));
});

test('the check sees a batch sent under one key and read back under another', () => {
  for (const job of JOBS) {
    const src = read(job.file);
    const sentElsewhere = src.replace(`id: ${job.key}, params: ${job.params}(`, () => `id: other, params: ${job.params}(`);
    assert.ok(wiringProblems(sentElsewhere, job).includes(WRONG_ID), `${job.file}: a changed batch id went unnoticed`);
    const readElsewhere = src.replace(job.reply(job.key), () => job.reply('other'));
    assert.ok(wiringProblems(readElsewhere, job).includes(NO_REPLY), `${job.file}: a changed lookup key went unnoticed`);
  }
});

const hasFlag = (step) => step.env?.ESSENTIALS_BATCH === '1' || step.env?.ESSENTIALS_BATCH === 1;

test('only the monthly refresh turns the essentials batch on', () => {
  const steps = yaml.load(read('.github/workflows/refresh-essentials.yml')).jobs.essentials.steps;
  for (const script of ['build-essentials.mjs', 'translate-essentials.mjs']) {
    const step = steps.find((s) => s.run?.includes(script));
    assert.ok(step && hasFlag(step), `refresh-essentials runs ${script} without ESSENTIALS_BATCH`);
  }
  // A new country's guide is written inside the publish job, which budgets its
  // own 360 minutes; a batch and its cancel wait there could outrun the job.
  assert.doesNotMatch(read('.github/workflows/publish.yml'), /ESSENTIALS_BATCH/);
  for (const f of ['scripts/build-essentials.mjs', 'scripts/translate-essentials.mjs']) {
    assert.match(read(f), /process\.env\.ESSENTIALS_BATCH === '1'\s*\n\s*\? await runBatch/);
  }
});

test('repair-prose picks its batch from the same rows, stopping at the same limit', () => {
  const src = read('scripts/repair-prose.mjs');
  assert.match(src, /if \(asks\.length >= LIMIT\) break;/);
  assert.match(src, /const found = await candidate\(row\);/);
  assert.match(src, /if \(done >= LIMIT\) break;/);
  // The one job that copies its replies into a map of its own: a third place the key could part.
  assert.ok(src.includes('firsts.set(id, msg)'), 'repair-prose no longer files a reply under the id it came back with');
});
