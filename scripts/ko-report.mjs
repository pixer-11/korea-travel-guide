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
//
// But a finding's EVIDENCE is a quote of the site's own English prose, and the
// quote is the whole point of the line. Testing the raw line blanked exactly the
// findings that carried the most detail: on 2026-09-06 the owner got five
// warnings of which two read "점검 항목 — 실행 로그 확인 필요", because their
// evidence ran to "confirm exact set times, doors, and remaining tickets…".
// So the quote is set aside before the test and marked as a quote in the output;
// what is tested is the framing, which is the part that must be Korean.
const ENGLISH_SENTENCE = /[A-Za-z]{4,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/;

/** `• slug.md · evidence — 설명` → [before, evidence, after], or null when the
 *  line has no evidence span. */
function splitEvidence(line) {
  const m = /^(.*?·\s*)(.+?)(\s+—\s.*)$/.exec(line);
  return m ? [m[1], m[2], m[3]] : null;
}

digest = digest
  .split('\n')
  .map((line) => {
    const parts = splitEvidence(line);
    if (parts) {
      const [before, evidence, after] = parts;
      // Framing must be Korean; the quoted evidence may be the site's English.
      if (!ENGLISH_SENTENCE.test(before + after)) return `${before}「${evidence.trim()}」${after}`;
    } else if (!ENGLISH_SENTENCE.test(line.replace(/\S+\.md/g, ''))) {
      return line;
    }
    return '• 점검 항목 — 실행 로그 확인 필요';
  })
  .join('\n');

console.log(digest);
