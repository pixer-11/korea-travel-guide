#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  CRON PUNCTUALITY — 예약 작업이 "울렸어야 할 시각"에 실제로 울렸는가.
//
//  2026-08-31, 픽서님: "깃허브 지연이 정확히 맞는건지 확인해보고, 앞으로도
//  이렇게 예약작업들이 안되면 안된다." 그때까지 '깃허브가 늦는다'는 인상이었지
//  숫자가 아니었다.
//
//  이 도구가 재는 것은 두 가지이고, 섞으면 원인을 틀린다:
//    A 스케줄러 지연 = created_at − 크론 슬롯   (깃허브가 실행을 만든 시각)
//    B 러너 대기     = run_started_at − created_at (만든 뒤 잡히기까지)
//  실측에서 B 는 전 구간 0분이었다 — 러너가 없어서가 아니라 **깃허브가 실행을
//  늦게 만든다**. 처음엔 run_started_at 만 보고 둘을 뭉뚱그렸다.
//
//  ⚠️ 그리고 이건 만성이 아니라 2026-08-26 에 시작된 국면 전환이다:
//      08-17~25  중앙값 19~35분 · 1시간 초과 ~13%   ← 깃허브의 평시 여유
//      08-26     76분 · 08-27 576분 · 08-28 595분
//      08-29     149분 · 08-30 236분 · 08-31 341분  ← 아직 안 끝났다
//    같은 날 깃허브가 Actions 장애 2건을 공식 선언했다(08-26 15:11~18:01,
//    22:56~00:26 UTC). 그러니 "중앙값 44분"처럼 정상기와 장애기를 한 통에 넣어
//    평균 내지 말 것 — 그건 어느 쪽도 설명하지 못하는 숫자다.
//
//  ⚠️ 창의 시작은 "이 파일의 cron 줄이 마지막으로 바뀐 커밋" 이후다. 안 그러면
//     워크플로가 생기기 전 슬롯까지 누락으로 세어 며칠짜리 가짜 지연이 나온다
//     (첫 시도에서 실제로 났다: schedule-watchdog 이 11일 지각한 것으로 보였다).
//  ⚠️ cron 은 줄머리 앵커로만 읽는다 — 주석 처리된 cron 은 의도이지 일정이
//     아니다(2026-08-19 에 그것을 세다가 "하루 2회 도는 중"으로 오독했다).
//  ⚠️ 실행은 '직전 슬롯'에 붙인다. 앞에서부터 순서대로 붙이면 슬롯 하나가
//     빠질 때 뒤 실행이 그 자리로 당겨져 **지연은 부풀고 누락은 줄어든다**
//     (그 버그로 누락을 3.2%로 봤는데 실제로는 6.7%였다).
//
//  🛑 알람시계 효과를 이 숫자로 판정하지 말 것. 깃허브가 회복하면 A 가 저절로
//     내려가므로, 그걸 알람 덕이라고 읽으면 자기가 자기를 채점하는 셈이다.
//     알람의 성적은 (1) 누락 슬롯이 구조됐는가 (2) 감시견 자신이 정시에 떴는가
//     — 즉 '같은 슬롯 중복실행' 칸에서 읽는다.
//
//    GH_TOKEN=<토큰> node scripts/audit-cron-punctuality.mjs
//    DAYS=30 GH_TOKEN=... node scripts/audit-cron-punctuality.mjs
// ─────────────────────────────────────────────────────────────
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lastFireBefore } from './lib/cron-window.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIR = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const REPO = process.env.GITHUB_REPOSITORY || 'pixer-11/korea-travel-guide';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const DAYS = Number(process.env.DAYS || 14);
const SINCE = Date.now() - DAYS * 86400e3;

if (!TOKEN) {
  console.error('GH_TOKEN 없음 — 인증 없이는 60회/시간 제한에 바로 걸린다.');
  console.error('로컬에서는: GH_TOKEN=$(printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill | grep ^password= | cut -d= -f2)');
  process.exit(1);
}

const gh = async (p) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${p}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'wa-cron-punctuality' },
  });
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return r.json();
};

// 현재 cron 이 성립한 시점. -G 는 POSIX 정규식이라 \s 를 모른다 — 리터럴로 찾는다.
const cronSettledAt = (file) => {
  try {
    const out = execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%aI', '-G', '- cron:', '--', '.github/workflows/' + file], { encoding: 'utf8' }).trim();
    return out ? new Date(out).getTime() : 0;
  } catch {
    return 0;
  }
};

const CRON_LINE = /^\s+- cron:\s*['"]?([^'"#\n]+?)['"]?\s*(?:#.*)?$/gm;

const files = (await readdir(DIR)).filter((f) => f.endsWith('.yml'));
const rows = [];
const every = [];

for (const file of files) {
  const src = await readFile(DIR + file, 'utf8');
  const crons = [...src.matchAll(CRON_LINE)].map((m) => m[1].trim());
  if (!crons.length) continue;

  // +1h: 크론이 바뀐 직후 첫 슬롯은 배달 여유를 준다
  const start = Math.max(SINCE, cronSettledAt(file) + 3600e3);
  if (Date.now() - start < 2 * 86400e3) { rows.push({ file, skip: '최근 변경 — 표본 부족' }); continue; }

  let runs;
  try { runs = (await gh(`/actions/workflows/${file}/runs?event=schedule&per_page=100`)).workflow_runs || []; }
  catch (e) { rows.push({ file, skip: e.message }); continue; }

  const fired = runs
    .map((r) => ({ created: new Date(r.created_at).getTime(), started: new Date(r.run_started_at || r.created_at).getTime() }))
    .filter((r) => r.created >= start)
    .sort((a, b) => a.created - b.created);

  const slots = new Set();
  let unsupported = null;
  for (const c of crons) {
    try {
      let cur = Date.now();
      for (let i = 0; i < 400; i++) {
        const s = lastFireBefore(c, cur);
        if (s < start) break;
        slots.add(s);
        cur = s;
      }
    } catch { unsupported = c; }
  }
  // cron-window 는 이 저장소의 일일/주간 꼴만 안다. 월간·연간은 표본이 1~2회라
  // 지각 통계에 의미가 없으므로 조용히 제외한다.
  if (unsupported && !slots.size) { rows.push({ file, skip: `주간/월간 제외 (${unsupported})` }); continue; }

  const sorted = [...slots].sort((a, b) => a - b);
  // 실행마다 '직전 슬롯'을 찾는다(슬롯마다 실행을 찾지 않는다) — 빠진 슬롯이
  // 뒤 실행을 끌어당기지 않게 하는 유일한 방향이다.
  const served = new Set();
  const delays = [];
  let extra = 0;
  for (const r of fired) {
    const slot = sorted.filter((s) => s <= r.created + 60e3).pop();
    if (slot === undefined) continue;      // 첫 슬롯보다 이른 실행
    if (served.has(slot)) { extra++; continue; } // 구조 발화 또는 지각 원본의 중복 배달
    served.add(slot);
    delays.push({ sched: Math.round((r.created - slot) / 60e3), queue: Math.round((r.started - r.created) / 60e3) });
  }
  const missed = sorted.filter((s) => !served.has(s)).length;
  every.push(...delays);
  const sd = delays.map((d) => d.sched).sort((a, b) => a - b);
  rows.push({
    file, days: (Date.now() - start) / 86400e3, slots: sorted.length, ran: delays.length, missed, extra,
    med: sd.length ? sd[Math.floor(sd.length / 2)] : null,
    max: sd.length ? sd[sd.length - 1] : null,
    over60: sd.filter((d) => d > 60).length,
  });
}

rows.sort((a, b) => (b.max ?? -1) - (a.max ?? -1));
console.log(`\n⏱️  예약 크론 정시성 — 최근 ${DAYS}일 (지연 단위: 분)\n`);
console.log('워크플로'.padEnd(30) + '관측일 슬롯 실행 누락 중복 중앙값  최대 >60분');
for (const r of rows) {
  if (r.skip) { console.log(r.file.padEnd(30) + '  — ' + r.skip); continue; }
  console.log(
    r.file.padEnd(30) + String(r.days.toFixed(1)).padStart(5) + String(r.slots).padStart(5) +
    String(r.ran).padStart(5) + String(r.missed).padStart(5) + String(r.extra).padStart(5) +
    String(r.med ?? '-').padStart(7) + String(r.max ?? '-').padStart(6) + String(r.over60).padStart(6),
  );
}

if (!every.length) { console.log('\n표본 없음.'); process.exit(0); }
const stat = (pick, label) => {
  const d = every.map(pick).sort((a, b) => a - b);
  const p = (q) => d[Math.floor(d.length * q)];
  const over = d.filter((x) => x > 60).length;
  console.log(`${label}: 중앙값 ${p(0.5)}분 · p75 ${p(0.75)} · p90 ${p(0.9)} · 최대 ${d[d.length - 1]} · 1h초과 ${over}회(${((100 * over) / d.length).toFixed(1)}%)`);
};
const slotsTotal = rows.reduce((a, r) => a + (r.slots || 0), 0);
const missedTotal = rows.reduce((a, r) => a + (r.missed || 0), 0);
const extraTotal = rows.reduce((a, r) => a + (r.extra || 0), 0);
console.log(`\n표본 ${every.length}회 · 슬롯 ${slotsTotal} · 누락 ${missedTotal} (${((100 * missedTotal) / slotsTotal).toFixed(1)}%) · 같은 슬롯 중복 ${extraTotal}\n`);
stat((d) => d.sched, 'A 스케줄러 지연 (created − 크론)');
stat((d) => d.queue, 'B 러너 대기     (started − created)');

console.log(`\n대조 기준선 (2026-08-31 밤, 알람시계 확장 직전):`);
console.log(`  평시(08-17~25) A 중앙값 19~35분 · 1h초과 약 13%`);
console.log(`  장애기(08-26~31) A 중앙값 76 → 576 → 595 → 149 → 236 → 341분 · 1h초과 거의 100%`);
console.log(`  B 러너 대기는 전 구간 0분 — 원인은 실행기가 아니라 스케줄러다.`);
console.log(`  누락 6.7% (17/252) · 깃허브 Actions 장애 2건 공식 선언일 = 08-26`);
