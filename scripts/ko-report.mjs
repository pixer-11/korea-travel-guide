#!/usr/bin/env node
// Run a validator and print its findings in Korean, for Telegram.
//
//   node scripts/ko-report.mjs scripts/validate-itineraries.mjs
//
// Workflows call this instead of piping the validator's stdout straight into a
// message body. The validator keeps its English developer output; only the
// owner-facing copy is translated, in one place, so a new message format in any
// validator cannot put English in the owner's chat.
//
// Always exits 0: this produces a notification, and a notifier that can fail the
// job would turn "we found a content problem" into "the build is broken".

import { spawnSync } from 'node:child_process';
import { koDigest, koStatLine } from './lib/issue-ko.mjs';

// --stat renders a batch job's one-line English RESULT summary instead of
// running a validator: node scripts/ko-report.mjs --stat "BACKFILL RESULT: …"
if (process.argv[2] === '--stat') {
  console.log(koStatLine(process.argv.slice(3).join(' ')));
  process.exit(0);
}

const target = process.argv[2];
if (!target) {
  console.log('점검 대상이 지정되지 않았어요 — 실행 로그를 확인해 주세요.');
  process.exit(0);
}

const run = spawnSync(process.execPath, [target, ...process.argv.slice(3)], {
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

const out = `${run.stdout || ''}\n${run.stderr || ''}`.trim();

if (run.error) {
  console.log(`점검을 실행하지 못했어요 (${target}) — 실행 로그를 확인해 주세요.`);
  process.exit(0);
}
if (!out) {
  console.log('점검 결과가 비어 있어요 — 실행 로그를 확인해 주세요.');
  process.exit(0);
}

let digest = koDigest(out);
if (!digest) {
  console.log('이상 없음.');
  process.exit(0);
}

// Last line of defence. If a translated line still carries an English sentence,
// send the Korean summary WITHOUT it rather than dropping the item — the owner
// still learns the count and where to look, and no English goes out.
digest = digest
  .split('\n')
  .map((line) => (/[A-Za-z]{4,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(line) ? '• 점검 항목 — 실행 로그 확인 필요' : line))
  .join('\n');

console.log(digest);
