#!/usr/bin/env node
// Remind the owner, in Telegram, when the index-coverage experiment is due.
//
// The throttle set on 2026-08-27 is judged on a date fixed in advance
// (data/index-coverage-baseline.json). An experiment whose result nobody goes to
// collect is the same as one never run, and the collecting step needs a human:
// GSC's API does not expose coverage, so only the owner can export it.
//
// Silent until the date, silent once judged. The reminder stops itself when the
// baseline gains a `judgedOn` — which is what recording the verdict looks like —
// so this can sit on a yearly cron without ever becoming noise.
//
//   node scripts/remind-index-verdict.mjs         # send if due
//   node scripts/remind-index-verdict.mjs --dry   # print what it would send
import { readFileSync } from 'node:fs';
import { telegram } from './lib/gsc.mjs';

const BASELINE = 'data/index-coverage-baseline.json';
const dry = process.argv.includes('--dry');

const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
const today = new Date().toISOString().slice(0, 10);

if (b.verdict.judgedOn) {
  console.log(`이미 판정됨 (${b.verdict.judgedOn}) — 알림 없음.`);
  process.exit(0);
}
if (today < b.verdict.judgeOn) {
  console.log(`판정일 ${b.verdict.judgeOn} 전 (오늘 ${today}) — 알림 없음.`);
  process.exit(0);
}

const text = [
  '🗓️ 색인 판정일입니다 — 발행 스로틀 실험 결과를 받을 차례',
  '',
  `${b.throttleStartedOn}에 발행량을 하루 330 → 25 URL로 줄였습니다. 판정일은 ${b.verdict.judgeOn}.`,
  '',
  `그때 기준값: 색인 ${b.latest.indexed} · 미색인 ${b.latest.notIndexed} (${b.latest.date})`,
  `직전 한 달 추세: 색인 ${b.slopePerDay.indexed}/일(사실상 정지) · 미색인 +${b.slopePerDay.notIndexed}/일`,
  '',
  '📥 할 일 (2분)',
  '1. Search Console → 색인 생성 → 페이지 → 오른쪽 위 "내보내기"',
  '2. 내려받은 zip을 클로드에게 주면 끝. 또는 직접:',
  '   node scripts/judge-index-coverage.mjs "<내려받은 zip>"',
  '',
  '🎯 볼 것은 미색인이 아니라 **색인**입니다.',
  `색인이 ${b.latest.indexed}에서 움직였는지가 유일하게 명확한 신호입니다 —`,
  '미색인이 줄어도 구글이 페이지를 버린 것일 수 있습니다.',
  '',
  `판정 기준은 결과를 보기 전(${b.capturedOn})에 ${BASELINE} 에 적어뒀습니다.`,
].join('\n');

console.log(text);
if (!dry) await telegram(text);
