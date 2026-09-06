// The Korean report's last line of defence used to blank any line containing an
// English sentence. A finding's evidence IS English — it quotes the site's own
// prose — so the guard erased exactly the findings that carried the most detail:
// on 2026-09-06 two of five content warnings reached the owner as
// "점검 항목 — 실행 로그 확인 필요" and told him nothing.
//
// These tests pin both directions: a Korean line keeps its English quote (marked
// as a quote), and a line whose FRAMING is untranslated is still replaced.
//
//   node --test scripts/ko-report.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The guard lives inline in ko-report.mjs (it runs a validator as a subprocess,
// so importing the module would run one). Lift the two pieces out by source and
// exercise them exactly as written — a copy would drift from what ships.
const SRC = readFileSync(new URL('./ko-report.mjs', import.meta.url), 'utf8');
const ENGLISH_SENTENCE = new RegExp(
  /const ENGLISH_SENTENCE = \/(.+?)\/;/.exec(SRC)[1],
);
const SPLIT = new RegExp(/const m = \/(.+?)\/\.exec\(line\);/.exec(SRC)[1]);

function guard(line) {
  const m = SPLIT.exec(line);
  if (m) {
    const [, before, evidence, after] = m;
    if (!ENGLISH_SENTENCE.test(before + after)) return `${before}「${evidence.trim()}」${after}`;
  } else if (!ENGLISH_SENTENCE.test(line.replace(/\S+\.md/g, ''))) {
    return line;
  }
  return '• 점검 항목 — 실행 로그 확인 필요';
}

test('a Korean finding keeps its English evidence, marked as a quote', () => {
  const line = '• paris-plk-stade-de-france-concerts.md · confirm exact set times, doors, and remaining tickets on PLK\'s official — 점검 필요 (코드 ENDED-EVENT-ADVICE)';
  const out = guard(line);
  assert.match(out, /「confirm exact set times/);
  assert.match(out, /점검 필요/);
  assert.notEqual(out, '• 점검 항목 — 실행 로그 확인 필요');
});

test('the short evidence that used to survive still survives', () => {
  const line = '• hanoi-ho-chi-minh-city-miss-world-2026.md · at the time of writing — 점검 필요 (코드 ENDED-EVENT-ADVICE)';
  assert.match(guard(line), /「at the time of writing」/);
});

test('a line whose framing is untranslated is still replaced', () => {
  const line = '• some-post.md — ended 2026-09-05 but the prose still says something';
  assert.equal(guard(line), '• 점검 항목 — 실행 로그 확인 필요');
});

test('a plain Korean line passes through untouched', () => {
  const line = '• 사진 12장이 표지와 맞지 않아요';
  assert.equal(guard(line), line);
});

test('a slug alone does not count as English', () => {
  const line = '• taipei-itzy-tunnel-vision-world-tour-taipei.md — 끝난 행사인데 본문이 아직 예정처럼 쓰여 있어요';
  assert.equal(guard(line), line);
});
