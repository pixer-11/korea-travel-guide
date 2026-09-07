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
  // "Nothing to summarise" and "the check died" look identical from here, and
  // only one of them is good news. A validator that prints its own tick and then
  // exits non-zero — or is killed — produced 이상 없음 and a zero exit from this
  // reporter (reproduced 2026-09-07 through the real subprocess wrapper). Read
  // the child's verdict, not just its words.
  if (run.status !== 0 || run.signal) {
    const how = run.signal ? `신호 ${run.signal}로 중단` : `종료코드 ${run.status}`;
    // Still exit 0: the contract at the top of this file is that a notifier
    // never fails the job. What was wrong was the WORDS, not the code — the
    // owner was told 이상 없음 about a check that had failed.
    console.log(`점검이 실패로 끝났는데 요약할 내용이 없어요 (${target}, ${how}) — 실행 로그를 확인해 주세요.`);
    process.exit(0);
  }
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

// Some diagnoses are ABOUT English, and quote it on purpose: '"Plan your trip"
// 제목이 영어' says that heading was left untranslated. The guard read those three
// quoted words as a leak and replaced the whole line with "점검 항목 — 실행 로그
// 확인 필요", so the owner learned a problem existed and lost which one it was.
// Quoted English is evidence; only unquoted English is a leak.
// Straight single quotes are NOT treated as quotation here. They are apostrophes
// far more often than they are quotes, and pairing them swallowed the sentence
// between two contractions: "owner's alert has real English prose and it's bad"
// became "owner s bad", which no longer looks like English, so the untranslated
// line went out to the owner intact. The diagnoses that legitimately quote
// English all use double quotes.
const withoutQuotes = (s) => s.replace(/"[^"]*"|「[^」]*」/g, ' ');
const leaksEnglish = (s) => ENGLISH_SENTENCE.test(withoutQuotes(s));

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
      if (!leaksEnglish(before + after)) return `${before}「${evidence.trim()}」${after}`;
    } else if (!leaksEnglish(line.replace(/\S+\.md/g, ''))) {
      return line;
    }
    return '• 점검 항목 — 실행 로그 확인 필요';
  })
  .join('\n');

console.log(digest);
