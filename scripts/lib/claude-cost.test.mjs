import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { claudeUsd, sumRows, costLine, kstDay } from './claude-cost.mjs';

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('prices come from the official table, longer prefix first', () => {
  assert.ok(near(claudeUsd('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }), 24));
  assert.ok(near(claudeUsd('claude-opus-5', { input_tokens: 1e6 }), 5)); // not priced as opus-5-5
  assert.ok(near(claudeUsd('claude-sonnet-5', { input_tokens: 1e6, output_tokens: 1e6 }), 12));
  assert.ok(near(claudeUsd('claude-haiku-4-5-20251001', { output_tokens: 1e6 }), 5)); // dated id
  assert.ok(near(claudeUsd('claude-opus-5-5', { cache_read_input_tokens: 1e6 }), 0.2)); // 0.05x on opus-5-5
  assert.ok(near(claudeUsd('claude-sonnet-5', { cache_creation_input_tokens: 1e6 }), 2.5)); // 1.25x write
});

test('web searches are billed per search on top of tokens ($10 per 1,000)', () => {
  // discover-events runs several searches per call; tokens alone undercounted it (review 2026-09-25).
  assert.ok(near(claudeUsd('claude-sonnet-5', { server_tool_use: { web_search_requests: 100 } }), 1));
  assert.ok(near(claudeUsd('claude-opus-5-5', { input_tokens: 1e6, server_tool_use: { web_search_requests: 4 } }), 4.04));
});

test('a model missing from the table is not given a guessed price', () => {
  assert.equal(claudeUsd('claude-zeta-9', { input_tokens: 10 }), null);
  assert.equal(claudeUsd(undefined, {}), null);
});

test('sums and the Telegram line', () => {
  const rows = [
    { models: { 'claude-opus-5-5': { calls: 2, usd: 0.2, unpriced: 0 } } },
    { models: { 'claude-sonnet-5': { calls: 1, usd: 0.03, unpriced: 0 }, 'claude-zeta-9': { calls: 1, usd: 0, unpriced: 1 } } },
  ];
  const s = sumRows(rows);
  assert.equal(s.calls, 4);
  assert.equal(s.unpriced, 1);
  assert.ok(near(s.usd, 0.23));
  const line = costLine(s, '💸 X');
  assert.match(line, /^💸 X \$0\.23 · 4회 · claude-opus-5-5 2회/);
  assert.match(line, /가격 모름 1회 제외/);
  assert.equal(costLine(sumRows([]), 'x'), '');
});

test('kstDay rolls over at 15:00 UTC', () => {
  assert.equal(kstDay(new Date('2026-09-25T14:59:59Z')), '2026-09-25');
  assert.equal(kstDay(new Date('2026-09-25T15:00:00Z')), '2026-09-26');
});

test('the meter counts SDK calls when the caller takes the result, ignores non-Claude results, writes only when told where', async () => {
  // Stand in for the network BEFORE the meter wraps create, as it would find the SDK.
  const replies = [
    { type: 'message', model: 'claude-opus-5-5', usage: { input_tokens: 1000, output_tokens: 2000 } },
    { type: 'message', model: 'claude-opus-5-5', usage: { input_tokens: 500, output_tokens: 500 } },
    { object: 'chat.completion', usage: { prompt_tokens: 9 } }, // not Claude: must be ignored
  ];
  Anthropic.Messages.prototype.create = function () { return Promise.resolve(replies.shift()); };
  delete process.env.CLAUDE_COST_LEDGER;
  const { meterTally, flushMeter } = await import('./claude-meter.mjs');

  const client = new Anthropic({ apiKey: 'test' });
  const got = [];
  for (let i = 0; i < 3; i++) got.push(await client.messages.create({}));
  assert.equal(got[0].usage.output_tokens, 2000, 'the caller receives the response unchanged');

  const t = meterTally()['claude-opus-5-5'];
  assert.equal(t.calls, 2);
  assert.equal(t.in, 1500);
  assert.equal(t.out, 2500);
  assert.ok(near(t.usd, (1500 * 4 + 2500 * 20) / 1e6));
  assert.equal(Object.keys(meterTally()).length, 1, 'the non-Claude result was not counted');

  assert.equal(flushMeter(), false, 'no ledger named -> nothing written');

  const dir = mkdtempSync(join(tmpdir(), 'meter-'));
  process.env.CLAUDE_COST_LEDGER = join(dir, 'claude-cost.jsonl');
  process.env.GITHUB_RUN_ID = '12345';
  assert.equal(flushMeter(), true);
  const row = JSON.parse(readFileSync(process.env.CLAUDE_COST_LEDGER, 'utf8').trim());
  assert.equal(row.run, '12345');
  assert.equal(row.day, kstDay());
  assert.equal(row.models['claude-opus-5-5'].calls, 2);
  assert.equal(flushMeter(), false, 'a flushed tally is not written twice');
  delete process.env.CLAUDE_COST_LEDGER;
});

test('a call is booked to the KST day it happened, not the day the process ended', async () => {
  const { meterRecord, flushMeter } = await import('./claude-meter.mjs');
  const msg = { type: 'message', model: 'claude-opus-5-5', usage: { input_tokens: 1e6, output_tokens: 0 } };
  meterRecord(msg, new Date('2026-09-25T14:59:00Z')); // 23:59 KST, 25th
  meterRecord(msg, new Date('2026-09-25T15:01:00Z')); // 00:01 KST, 26th
  const dir = mkdtempSync(join(tmpdir(), 'meter-day-'));
  process.env.CLAUDE_COST_LEDGER = join(dir, 'l.jsonl');
  assert.equal(flushMeter(), true);
  const rows = readFileSync(process.env.CLAUDE_COST_LEDGER, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.day).sort(), ['2026-09-25', '2026-09-26']);
  assert.ok(rows.every((r) => near(r.models['claude-opus-5-5'].usd, 4)));
  delete process.env.CLAUDE_COST_LEDGER;
});

test('the meter prints nothing - workflows paste some scripts\' output into Telegram', () => {
  const src = readFileSync(new URL('./claude-meter.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /console\.|process\.(stdout|stderr)\.write/);
});

test('the report: this run, today\'s total, and silence when empty', async () => {
  const { report } = await import('../claude-cost-report.mjs');
  const today = kstDay();
  const rows = [
    { run: '1', day: today, models: { 'claude-opus-5-5': { calls: 18, usd: 1.62, unpriced: 0 } } },
    { run: '2', day: today, models: { 'claude-sonnet-5': { calls: 40, usd: 0.4, unpriced: 0 } } },
    { run: '1', day: '2020-01-01', models: { 'claude-opus-5-5': { calls: 1, usd: 9, unpriced: 0 } } },
  ];
  const out = report(rows, { run: '1' });
  assert.match(out, /💸 이번 작업 Claude 비용 \$10\.62 · 19회/); // run 1 across days
  assert.match(out, /📅 오늘\(KST\) 발행·이벤트 작업 누계 \$2\.02 · 58회/); // today only, honest scope
  assert.equal(report([], { run: '1' }), '');
  // A re-run keeps its run id: attempt 2 must not report attempt 1's spend as its own.
  const reruns = [
    { run: '7', attempt: '1', day: today, models: { 'claude-opus-5-5': { calls: 18, usd: 1.6, unpriced: 0 } } },
    { run: '7', attempt: '2', day: today, models: { 'claude-opus-5-5': { calls: 3, usd: 0.3, unpriced: 0 } } },
  ];
  assert.match(report(reruns, { run: '7', attempt: '2' }), /이번 작업 Claude 비용 \$0\.30 · 3회/);
  assert.match(report(reruns, { run: '7' }), /이번 작업 Claude 비용 \$1\.60 · 18회/); // no attempt = 1
  assert.match(report(rows, { day: '2020-01-01' }), /01-01 Claude 비용 \$9\.00 · 1회/);
});

// ---- wiring: the gates that keep the ledger honest as the repo grows ----

function sdkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...sdkFiles(p)); continue; }
    if (!/\.(mjs|js|ts)$/.test(e.name) || /\.test\./.test(e.name) || e.name === 'claude-meter.mjs') continue;
    if (/from\s+['"]@anthropic-ai\/sdk['"]|import\(\s*['"]@anthropic-ai\/sdk['"]\s*\)/.test(readFileSync(p, 'utf8'))) out.push(p);
  }
  return out;
}

test('every file that imports the SDK also imports the meter', () => {
  const root = new URL('../../', import.meta.url);
  const files = [...sdkFiles(fileURLToPath(new URL('scripts', root))), ...sdkFiles(fileURLToPath(new URL('src', root)))];
  assert.ok(files.length >= 30, `found ${files.length} SDK files - the scan is looking in the wrong place`);
  const missing = files.filter((f) => !/import\s+['"][./]+(lib\/)?claude-meter\.mjs['"]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(missing, [], 'these call Claude without the meter, so their spend is invisible');
});

test('the Claude-writing workflows name the ledger after npm ci, commit it, and never set NODE_OPTIONS via GITHUB_ENV', () => {
  for (const wf of ['publish.yml', 'discover-events.yml']) {
    const y = readFileSync(new URL(`../../.github/workflows/${wf}`, import.meta.url), 'utf8');
    const ci = y.indexOf('run: npm ci');
    const ledger = y.indexOf('CLAUDE_COST_LEDGER=$GITHUB_WORKSPACE/data/claude-cost.jsonl');
    assert.ok(ci > 0 && ledger > ci, `${wf}: ledger path set after npm ci`);
    assert.match(y, /git add[^\n]*data\/claude-cost\.jsonl/, `${wf}: ledger committed`);
  }
  // GitHub rejects NODE_OPTIONS written to $GITHUB_ENV (runner 2.309.0). The first
  // version of this meter relied on it and would never have switched on.
  const wfDir = new URL('../../.github/workflows/', import.meta.url);
  for (const f of readdirSync(wfDir)) {
    const y = readFileSync(new URL(f, wfDir), 'utf8');
    assert.doesNotMatch(y, /NODE_OPTIONS=[^\n]*>>\s*"?\$GITHUB_ENV/, `${f}: NODE_OPTIONS via GITHUB_ENV is blocked by GitHub`);
  }
});

test('discover-events keeps its "no new events" exit: the ledger is committed by its own step', () => {
  // Every run makes Claude calls, so a ledger staged with the content made
  // `git diff --staged --quiet` never true and pushed ledger-only "content" commits.
  const y = readFileSync(new URL('../../.github/workflows/discover-events.yml', import.meta.url), 'utf8');
  const start = y.indexOf('- name: Commit new events');
  const end = y.indexOf('- name: Commit the Claude cost ledger');
  assert.ok(start > 0 && end > start, 'both steps exist, content commit first');
  assert.doesNotMatch(y.slice(start, end), /claude-cost\.jsonl/);
});

test('the ledger is tracked from the start and merges by union', () => {
  // Untracked, the first ledger a job wrote would block a rebase the moment another
  // job committed one (git refuses to overwrite untracked files; autostash skips them).
  assert.ok(existsSync(new URL('../../data/claude-cost.jsonl', import.meta.url)), 'data/claude-cost.jsonl exists in the repo');
  assert.match(readFileSync(new URL('../../.gitattributes', import.meta.url), 'utf8'), /data\/claude-cost\.jsonl\s+merge=union/);
});
