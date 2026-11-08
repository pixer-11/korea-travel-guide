// Where the daily publish tells build-check to deploy decides when the posts go
// live and what state they go live in. Too late and they wait behind a 63-77
// minute audit build (live around 20:00 KST, measured 2026-11-04..07). Too early
// and the first deploy carries posts the repair pushes have not fixed yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const WF = fileURLToPath(new URL('../.github/workflows/publish.yml', import.meta.url));
const load = () => yaml.load(readFileSync(WF, 'utf8'));

const isHandoff = (s) => /^\s*gh workflow run build-check\.yml\b/m.test(s.run ?? '');
const pushes = (s) => /git-push-retry\.sh|git push\b/.test(s.run ?? '');
const addsSite = (s) => /git add [^\n]*\b(src|public)\//.test(s.run ?? '');
const isAuditBuild = (s) => s.name === 'Build site for output audits';

function handoffProblems(doc) {
  const found = [];
  const { generate } = doc.jobs;
  const steps = generate.steps;
  const at = steps.flatMap((s, i) => (isHandoff(s) ? [i] : []));
  if (at.length !== 1) return [`expected one hand-off step, found ${at.length}`];
  const [i] = at;
  const step = steps[i];
  if (i > steps.findIndex(isAuditBuild)) found.push('after the audit build');
  const lastSitePush = steps.reduce((n, s, k) => (pushes(s) && addsSite(s) ? k : n), -1);
  if (i < lastSitePush) found.push('before the last push of site content');
  if (generate.permissions?.actions !== 'write') found.push('generate has no actions: write');
  if (generate.permissions?.contents !== 'write') found.push('generate lost contents: write');
  if (step['continue-on-error'] !== true) found.push('a failed hand-off would skip the audits');
  // Scan-hero-widths can quarantine a post and its step tolerates a failed push.
  if (!/git-push-retry\.sh[\s\S]*gh workflow run/.test(step.run)) found.push('an unpushed commit would miss this deploy');
  if (!/workflow_dispatch/.test(step.if ?? '') || !/github-actions\[bot\]/.test(step.if ?? '')) found.push('fires for a run that already gets workflow_run');
  for (const [name, job] of Object.entries(doc.jobs)) {
    if (name !== 'generate' && (job.steps ?? []).some(isHandoff)) found.push(`second hand-off in job ${name}`);
  }
  return found;
}

// Move the hand-off step to just before the step that matches `where`.
function movedBefore(where) {
  const doc = load();
  const steps = doc.jobs.generate.steps;
  const [step] = steps.splice(steps.findIndex(isHandoff), 1);
  steps.splice(steps.findIndex(where), 0, step);
  return doc;
}

test('the real workflow hands off once, after the repairs and before the audit build', () => {
  assert.deepEqual(handoffProblems(load()), []);
});

test('a hand-off behind the audit build is refused', () => {
  const doc = movedBefore((s) => s.name === 'Notify Telegram');
  assert.ok(handoffProblems(doc).includes('after the audit build'));
});

test('a hand-off before the repair pushes is refused', () => {
  const doc = movedBefore((s) => s.name === 'Verify photo identity against Commons');
  assert.ok(handoffProblems(doc).includes('before the last push of site content'));
});

test('a later push of site content is refused: the deploy would not carry it', () => {
  const doc = load();
  doc.jobs.generate.steps.push({ name: 'late', run: 'git add src/content/posts\nbash scripts/git-push-retry.sh' });
  assert.ok(handoffProblems(doc).includes('before the last push of site content'));
});

test('the ledgers pushed after the hand-off are not site content', () => {
  const steps = load().jobs.generate.steps;
  const after = steps.slice(steps.findIndex(isHandoff) + 1).filter(pushes);
  assert.deepEqual(after.map((s) => s.name), ['Commit the issue ledger', 'Commit the Claude cost ledger']);
  assert.ok(!after.some(addsSite));
});

test('the job permission and the failure handling are both required', () => {
  const noPerm = load();
  delete noPerm.jobs.generate.permissions;
  assert.ok(handoffProblems(noPerm).includes('generate has no actions: write'));
  const fatal = load();
  delete fatal.jobs.generate.steps.find(isHandoff)['continue-on-error'];
  assert.ok(handoffProblems(fatal).includes('a failed hand-off would skip the audits'));
});

test('the hand-off pushes a stranded commit before it signals', () => {
  const doc = load();
  const step = doc.jobs.generate.steps.find(isHandoff);
  step.run = step.run.split('\n').filter((l) => !l.includes('git-push-retry')).join('\n');
  assert.ok(handoffProblems(doc).includes('an unpushed commit would miss this deploy'));
});

test('a second dispatch job, the old arrangement, is refused', () => {
  const doc = load();
  doc.jobs['deploy-handoff'] = { steps: [{ run: 'gh workflow run build-check.yml --ref main' }] };
  assert.ok(handoffProblems(doc).includes('second hand-off in job deploy-handoff'));
});
