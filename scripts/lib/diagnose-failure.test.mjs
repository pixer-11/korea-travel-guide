// Fixtures are real lines from real failed runs — the point of this file is
// that the diagnoser keeps recognising the failures we have actually had.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, alertText, lastErrorLine } from './diagnose-failure.mjs';

// Weekly marketing review, run 33319474667, 2026-08-30.
const SPEND_CAP = `2026-08-30T15:23:25.4781878Z BadRequestError: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified API usage limits. You will regain access on 2026-09-01 at 00:00 UTC."},"request_id":"req_011CeZAQzVyb3wrVBkZDwx2S"}
2026-08-30T15:23:25.4904666Z ##[error]Process completed with exit code 1.`;

test('the 08-30 spend cap is named, dated, and marked self-healing', () => {
  const d = diagnose(SPEND_CAP);
  assert.equal(d.id, 'anthropic-usage-limit');
  assert.match(d.cause, /월 사용 한도/);
  assert.match(d.cause, /2026-09-01 00:00 UTC/);
  assert.equal(d.selfHeals, true);
  // The evidence is the line that says what happened, not GitHub's epilogue.
  assert.match(d.evidence, /^BadRequestError: 400/);
});

// Real shape of a run log: GitHub echoes the step's own script in cyan first.
// publish.yml greps for the spend-cap sentence, so the sentence is in EVERY
// publish log; only real output may match.
test('a signature inside an echoed run: script is not a diagnosis', () => {
  const log = '2026-09-01T13:38:54.3738299Z \x1b[36;1m  if grep -qh "reached your specified API usage limits" /tmp/gen.log; then\x1b[0m\n'
    + '2026-09-01T13:40:00.0000000Z Error: ENOENT: no such file or directory, open \'data/x.json\'\n'
    + '2026-09-01T13:40:00.1000000Z ##[error]Process completed with exit code 1.';
  const d = diagnose(log);
  assert.equal(d.id, null, 'the echoed grep line must not read as a spend cap');
  assert.equal(d.evidence, "Error: ENOENT: no such file or directory, open 'data/x.json'");
});

test('the epilogue is evidence only when nothing better exists', () => {
  assert.equal(lastErrorLine('Error: ENOENT boom\n    at readFileSync\n##[error]Process completed with exit code 1.'), 'Error: ENOENT boom');
  assert.equal(lastErrorLine('##[error]Process completed with exit code 7.'), 'Process completed with exit code 7.');
});

test('astro check output with GitHub timestamps is a test failure', () => {
  const log = '2026-09-01T10:00:00.0000000Z Result (312 files):\n2026-09-01T10:00:00.0000001Z - 3 errors\n2026-09-01T10:00:00.0000002Z - 0 warnings';
  assert.equal(diagnose(log).id, 'test-failure');
});

test('the alert says what to do — nothing, when it heals itself', () => {
  const t = alertText('Weekly marketing review', 'https://example/run/1', SPEND_CAP);
  assert.match(t, /⚠️ 자동 작업 실패 — Weekly marketing review/);
  assert.match(t, /원인: Anthropic API 월 사용 한도/);
  assert.match(t, /따로 하실 일은 없습니다/);
  assert.doesNotMatch(t, /이틀 연속 실패하면/, 'the stock advice must not ride along with a known cause');
  assert.match(t, /실행 기록: https:\/\/example\/run\/1/);
});

test('a human-needed cause says so instead', () => {
  const log = '2026-01-01T00:00:00Z remote: Permission to pixer-11/korea-travel-guide.git denied to content-bot.\n##[error]Process completed with exit code 128.';
  const d = diagnose(log);
  assert.equal(d.id, 'git-push-denied');
  assert.equal(d.selfHeals, false);
  assert.match(alertText('X', 'u', log), /사람이 확인해야 하는 종류/);
});

test('an unknown failure keeps the old wording but adds the evidence line', () => {
  const log = '2026-01-01T00:00:00Z something nobody has a signature for\n##[error]Process completed with exit code 7.';
  const d = diagnose(log);
  assert.equal(d.id, null);
  const t = alertText('Mystery job', 'u', log);
  assert.match(t, /이틀 연속 실패하면/);
  assert.match(t, /로그 마지막 오류: Process completed with exit code 7/);
});

test('ANSI colour and timestamps do not hide a match', () => {
  const noisy = '2026-08-30T15:23:25.4781878Z \x1b[31mYou have reached your specified API usage limits.\x1b[0m';
  assert.equal(diagnose(noisy).id, 'anthropic-usage-limit');
});

test('a cap with no reset time still reads as a sentence', () => {
  const d = diagnose('You have reached your specified API usage limits.');
  assert.match(d.cause, /콘솔에 적힌 리셋 시각/);
});

test('signature order: a spend cap inside a run that also timed out is still the cap', () => {
  const log = 'ETIMEDOUT while fetching\nYou have reached your specified API usage limits.\n##[error]exit 1';
  assert.equal(diagnose(log).id, 'anthropic-usage-limit');
});

test('empty or missing logs never throw', () => {
  for (const v of ['', null, undefined]) {
    const d = diagnose(v);
    assert.equal(d.id, null);
    assert.equal(d.evidence, '');
  }
  assert.match(alertText('X', 'u', ''), /작업이 도중에 멈춰서/);
});

test('lastErrorLine takes the LAST error, not the first', () => {
  const log = '##[error]first thing\nnoise\n##[error]final thing';
  assert.equal(lastErrorLine(log), 'final thing');
});
