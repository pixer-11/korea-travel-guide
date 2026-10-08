// Runs every live check in this folder against one base URL, one after the
// other, and says which failed (2026-10-01, owner: "검증할 때마다 오류가 새로
// 생기잖아" — the checks written by hand for each redesign now run twice a day
// from live-checks.yml instead of only on the day they were written).
//
//   node scripts/live/run-all.mjs [base]        (default: the live site)
//
// Writes, for the workflow's Telegram step:
//   $LIVE_OUT/summary.txt — one line per check, ✓/✗, and every ✗ line it printed;
//   $LIVE_OUT/warn.txt    — WARN lines (country data gaps): reported, never failing.
// Exit code 1 when any check failed. No AI, no paid API: a headless browser
// with the analytics endpoints blocked (lib.mjs).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] || process.env.LIVE_BASE || 'https://wanderatlasguides.com';
const OUT = process.env.LIVE_OUT || path.join(os.tmpdir(), 'wa-live');
fs.mkdirSync(OUT, { recursive: true });

// Cheapest first, so a dead site fails fast; the sweeps last.
const CHECKS = [
  ['analytics-silence.mjs', '검사가 방문자 통계에 안 잡히는지'],
  ['country-coverage.mjs', '나라별 허브 데이터(경고만)'],
  ['header-nav.mjs', '상단 메뉴'],
  ['home-v3.mjs', '홈 v3(사진 벽·3갈래 선택기·연휴·나라 사진)×5개 언어'],
  ['regressions-2026-10-01.mjs', '10-01 회귀 묶음'],
  ['audit-2026-10-05.mjs', '10-05 전수검증 회귀(깨진 글자·헤더·별칭 허브·분석·팝업·제목·가입 Origin)'],
  ['events-now.mjs', '이벤트 진행 중'],
  ['hubs-checklist-itinerary.mjs', '허브·체크리스트·일정'],
  ['my-trip.mjs', '내 여행'],
  ['essentials-topics.mjs', '필수정보 주제 6종'],
  ['topics-mobile.mjs', '주제 페이지 모바일'],
  ['redesigns-2026-10-02.mjs', '10-01/02 개편 페이지 8종×5개 언어'],
  ['mobile-sweep.mjs', '페이지 종류 33개×5개 언어 휴대폰 넘침'],
  ['wtg-photos.mjs', '언제 갈까 나라 사진'],
  ['affiliate-surfaces.mjs', '제휴 링크 위치(짐보관·명소·호주)'],
  ['esim-pages.mjs', 'eSIM 나라 페이지(추천기·내 폰 확인·체크리스트·SubID)×5개 언어'],
  ['flights-page.mjs', '항공권 페이지(목적지 칩·월별 띠·기본 출발지·가격 미표기)×5개 언어'],
  ['essentials-hub.mjs', '필수정보 허브'],
  ['checklist.mjs', '체크리스트'],
  ['essentials-countries.mjs', '나라별 필수정보 전수'],
  ['events-pages.mjs', '이벤트 페이지 전수'],
  ['itineraries.mjs', '일정 페이지 전수'],
];
const TIMEOUT = 20 * 60_000;

function run(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(DIR, file), BASE], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    const timer = setTimeout(() => { out += `\n✗ timed out after ${TIMEOUT / 60_000} min`; child.kill('SIGKILL'); }, TIMEOUT);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, out, secs: Math.round((Date.now() - t0) / 1000) }); });
  });
}

const summary = [];
const warns = [];
let failed = 0;
for (const [file, label] of CHECKS) {
  console.log(`\n### ${file} (${label})`);
  const r = await run(file);
  const bad = r.code !== 0;
  if (bad) failed++;
  summary.push(`${bad ? '✗' : '✓'} ${label} (${r.secs}s)`);
  if (bad) {
    // The check's own failure lines; a crash prints none, so keep its last lines.
    const lines = r.out.split('\n').filter((l) => /✗|FAIL|Error|problems [1-9]/.test(l)).slice(0, 8);
    const tail = lines.length ? lines : r.out.trim().split('\n').slice(-4);
    for (const l of tail) summary.push(`   ${l.trim().slice(0, 220)}`);
  }
  for (const l of r.out.split('\n')) if (l.startsWith('WARN ')) warns.push(l.slice(5).trim());
}

const head = `${CHECKS.length - failed}/${CHECKS.length} 통과 · ${BASE}`;
console.log(`\n${head}\n${summary.join('\n')}`);
fs.writeFileSync(path.join(OUT, 'summary.txt'), `${head}\n${summary.join('\n')}\n`);
fs.writeFileSync(path.join(OUT, 'warn.txt'), warns.join('\n'));
if (failed) process.exitCode = 1;
