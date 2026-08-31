#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  CRON PUNCTUALITY — 예약 작업이 "울렸어야 할 시각"에 실제로 울렸는가.
//
//  2026-08-31, 픽서님: "깃허브 지연이 정확히 맞는건지 확인해보고, 앞으로도
//  이렇게 예약작업들이 안되면 안된다." 그때까지 '깃허브가 늦는다'는 인상이었지
//  숫자가 아니었다. 처음 실측한 결과(14일·26개 일일 워크플로·244회 발화):
//
//      중앙값 44분 지각 · 1시간 초과 44% · 3시간 초과 27% ·
//      6시간 초과 13% · 최악 12.2시간 · 아예 안 온 슬롯 3.2%
//
//  즉 지각은 사고가 아니라 평시다. 이 도구는 그 판정을 재현 가능하게 만든다 —
//  workers/social-alarm 알람시계를 늘린 뒤 정말 나아졌는지 대조하는 자.
//
//  ⚠️ 창의 시작은 "이 파일의 cron 줄이 마지막으로 바뀐 커밋" 이후다. 안 그러면
//     워크플로가 생기기 전 슬롯까지 누락으로 세어 며칠짜리 가짜 지연이 나온다
//     (첫 시도에서 실제로 났다: schedule-watchdog 이 11일 지각한 것으로 보였다).
//  ⚠️ cron 은 줄머리 앵커로만 읽는다 — 주석 처리된 cron 은 의도이지 일정이
//     아니다(2026-08-19 에 그것을 세다가 "하루 2회 도는 중"으로 오독했다).
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
    .map((r) => new Date(r.run_started_at || r.created_at).getTime())
    .filter((t) => t >= start)
    .sort((a, b) => a - b);

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
  const used = new Set();
  const delays = [];
  let missed = 0;
  for (const s of sorted) {
    const hit = fired.find((t) => t >= s - 60e3 && !used.has(t));
    if (hit === undefined) { missed++; continue; }
    used.add(hit);
    delays.push(Math.round((hit - s) / 60e3));
  }
  every.push(...delays);
  const sd = delays.slice().sort((a, b) => a - b);
  rows.push({
    file, days: (Date.now() - start) / 86400e3, slots: sorted.length, ran: delays.length, missed,
    med: sd.length ? sd[Math.floor(sd.length / 2)] : null,
    max: sd.length ? sd[sd.length - 1] : null,
    over60: delays.filter((d) => d > 60).length,
  });
}

rows.sort((a, b) => (b.max ?? -1) - (a.max ?? -1));
console.log(`\n⏱️  예약 크론 정시성 — 최근 ${DAYS}일 (지연 단위: 분)\n`);
console.log('워크플로'.padEnd(30) + '관측일 슬롯 실행 누락 중앙값  최대 >60분');
for (const r of rows) {
  if (r.skip) { console.log(r.file.padEnd(30) + '  — ' + r.skip); continue; }
  console.log(
    r.file.padEnd(30) + String(r.days.toFixed(1)).padStart(5) + String(r.slots).padStart(5) +
    String(r.ran).padStart(5) + String(r.missed).padStart(5) + String(r.med ?? '-').padStart(7) +
    String(r.max ?? '-').padStart(6) + String(r.over60).padStart(6),
  );
}

const ds = every.sort((a, b) => a - b);
if (!ds.length) { console.log('\n표본 없음.'); process.exit(0); }
const pct = (p) => ds[Math.floor(ds.length * p)];
const share = (n) => `${n}회 (${((100 * n) / ds.length).toFixed(1)}%)`;
const slotsTotal = rows.reduce((a, r) => a + (r.slots || 0), 0);
const missedTotal = rows.reduce((a, r) => a + (r.missed || 0), 0);
console.log(`\n발화 ${ds.length}회 — 중앙값 ${pct(0.5)}분 · p75 ${pct(0.75)} · p90 ${pct(0.9)} · 최대 ${ds[ds.length - 1]}분`);
console.log(`1시간 초과 ${share(ds.filter((d) => d > 60).length)} · 3시간 초과 ${share(ds.filter((d) => d > 180).length)} · 6시간 초과 ${share(ds.filter((d) => d > 360).length)}`);
console.log(`아예 안 뜬 슬롯 ${missedTotal} / ${slotsTotal} (${((100 * missedTotal) / slotsTotal).toFixed(1)}%)`);
console.log(`\n대조 기준선 (2026-08-31, 알람시계 확장 직전, 14일):`);
console.log(`  중앙값 44분 · 1시간 초과 44.3% · 3시간 초과 27.5% · 6시간 초과 13.1% · 누락 3.2%`);
