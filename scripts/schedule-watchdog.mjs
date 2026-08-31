// ─────────────────────────────────────────────────────────────
//  SCHEDULE WATCHDOG — 깃허브가 흘린 크론을 주워 담는다.
//
//  깃허브 예약 실행은 보장이 아니라 "노력"이다. 2026-08-27~28 이틀 동안
//  이 저장소에서 실측된 것만: 레딧 스카우트 미발화(카드 실종), 16:19 발행
//  2일 연속 미발화, 저녁 핀터레스트 미발화, 아침 분석 보고 9시간 지연.
//  스레드(3회 시도)와 발행(publish-watchdog)만 방어가 있었고, 크론이 하나뿐인
//  워크플로는 전부 무방비였다 — 이 감시견이 그 부류를 닫는다.
//
//  원리: 명단의 각 워크플로에 대해 "마지막으로 울렸어야 할 시각"을 계산하고
//  (lib/cron-window.mjs), 그 시각+유예가 지났는데 실행 기록이 없으면 직접
//  workflow_dispatch 로 발화시키고 텔레그램으로 보고한다.
//
//  ⚠️ 구조만으로는 반쪽이다(2026-08-29 실측): 깃허브는 "버린 줄 알았던"
//  크론을 몇 시간 뒤에 기어이 배달하기도 한다 — 구조 12:22 뒤에 지각 원본이
//  13:17(핀 3+3)·15:57(리포트 2번)에 또 왔다. 그래서 상태 장부가 없는
//  워크플로(pinterest·analytics-report·reddit-scout)는 lib/slot-served.mjs
//  슬롯 가드를 달아 지각 원본 스스로 물러나게 했다. 명단 관리 시 규칙:
//  새 워크플로를 명단에 넣으려면 일일 가드/상태 장부/슬롯 가드 중 하나가
//  있어야 한다.
//  이 감시견 자체도 하루 4번 돌므로(전부 누락될 확률은 사실상 0) 자기 자신이
//  같은 병에 걸리는 문제를 확률로 눌렀다.
//
//  publish.yml 은 명단에 있지만 rescue:false 다: 전용 publish-watchdog 이
//  이미 지키고 있어서, 둘이 같은 개를 풀면 이중 발행 경쟁이 생긴다. 명단에
//  둔 이유는 슬롯 가드(guard:'kstDay')가 같은 목록을 읽기 때문이다.
//  주간·월간 크론도 v1 에선
//  제외 — 하루 늦어도 터지지 않는 것들이라, 명단은 "그날 안 돌면 그날의
//  일이 사라지는" 일일 크론으로 한정한다.
//
//    node scripts/schedule-watchdog.mjs          # 판정 + 필요시 발화
//    node scripts/schedule-watchdog.mjs --dry    # 판정만 출력
// ─────────────────────────────────────────────────────────────
import { lastFireBefore } from './lib/cron-window.mjs';
import { MANIFEST } from './lib/cron-manifest.mjs';

const DRY = process.argv.includes('--dry');
const REPO = process.env.GITHUB_REPOSITORY || 'pixer-11/korea-travel-guide';
const TOKEN = process.env.GITHUB_TOKEN;
const GRACE_MIN = 100; // 지각 발화 여지 — 이보다 늦으면 누락으로 판정

// 명단은 lib/cron-manifest.mjs 로 이사했다(2026-08-29) — 슬롯 가드
// (lib/slot-served.mjs)와 같은 목록을 봐야 해서다. 이 파일을 import 하면
// 감시견이 실행돼 버리므로 데이터만 따로 산다.

const gh = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.status === 204 ? null : res.json();
};

async function tg(text) {
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) { console.log('[tg 미설정] ' + text.replace(/\n/g, ' | ')); return; }
  await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch((e) => console.error(`tg failed: ${e.message}`));
}

const now = Date.now();
const rescued = [], pending = [], failures = [];

// rescue:false 항목(publish — 전용 감시견 있음)은 슬롯 가드용일 뿐, 여기서
// 구조하지 않는다.
const RESCUABLE = MANIFEST.filter((w) => w.rescue !== false);

for (const w of RESCUABLE) {
  // 여러 크론 중 "마지막으로 울렸어야 할 슬롯"과 그것이 어느 크론이었는지를
  // 같이 기억한다 — 구조 디스패치에 슬롯별 입력(inputsByCron)을 실어야 해서다.
  let lastExpected = -Infinity, missedCron = null;
  for (const c of w.crons) {
    const t = lastFireBefore(c, now);
    if (t > lastExpected) { lastExpected = t; missedCron = c; }
  }
  const overdueMin = Math.round((now - lastExpected) / 60000);
  // 예정 시각 10분 전부터의 실행을 "그 슬롯의 실행"으로 인정 — 스케줄러가
  // 몇 분 이르게 큐잉하는 경우까지 오탐 없이 담는다. 이벤트 종류는 안 가린다:
  // 사람이 손으로 돌렸어도 그 슬롯의 일은 된 것이다.
  const since = new Date(lastExpected - 10 * 60000).toISOString();
  // Per-entry, not per-run: a single 404/500 used to throw out of the whole
  // loop, so one bad name in the roster left every LATER workflow unchecked —
  // silently, since the job then just failed. Report the entry and continue.
  let runs;
  try {
    runs = await gh(`/actions/workflows/${w.file}/runs?created=${encodeURIComponent('>=' + since)}&per_page=5`);
  } catch (e) {
    console.error(`${w.file}: 조회 실패 — ${e.message.slice(0, 120)} (건너뛰고 계속)`);
    failures.push(`${w.name}: 조회 실패`);
    continue;
  }
  // 실행 "기록"이 아니라 "그 슬롯의 일이 되었는가"를 본다: 아직 도는 중이면
  // 된 셈이고, 끝난 기록은 success 만 인정한다. 체크아웃에서 죽은 failure/
  // cancelled 기록이 감시견을 안심시키면 그날치 일이 조용히 사라진다(08-28
  // 코덱스 심문).
  //
  // ⚠️ 중복 방지 수준은 명단 안에서도 고르지 않다(2026-08-31 코덱스 감사로
  // 확인). 슬롯 가드가 있는 것: pinterest·analytics-report·reddit-scout.
  // 일일 스탬프: threads-daily. KST 하루 가드: publish. 그러나 refresh·
  // alt-photos·indexnow 는 아무 가드가 없어서, 구조 발화와 지각 원본이 겹치면
  // refresh 는 커서를 한 번 더 돌려 Places 예산을 더 쓰고 alt-photos 는 같은
  // 백로그를 병렬로 읽는다. 그래도 구조는 계속한다 — 그날 일이 통째로 빠지는
  // 쪽이 더 비싸기 때문이다. 가드를 붙이는 것이 다음 작업이다.
  const ran = (runs.workflow_runs ?? []).some((r) =>
    r.status !== 'completed' || r.conclusion === 'success');
  const verdict = ran ? 'ok' : (overdueMin <= GRACE_MIN ? 'waiting' : 'MISSED');
  console.log(`${w.file}: expected ${new Date(lastExpected).toISOString()} (+${overdueMin}m) → ${verdict}`);
  if (verdict !== 'MISSED') continue;
  if (DRY) { pending.push(w); continue; }
  const inputs = w.inputsByCron?.[missedCron];
  try {
    await gh(`/actions/workflows/${w.file}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main', ...(inputs ? { inputs } : {}) }),
    });
    rescued.push(`${w.name} (${overdueMin}분 지각)`);
  } catch (e) {
    console.error(`${w.file}: 구조 발화 실패 — ${e.message.slice(0, 120)}`);
    failures.push(`${w.name}: 구조 발화 실패`);
  }
}

if (rescued.length) {
  await tg(`🐕 스케줄 감시견 — 깃허브가 흘린 예약 실행 ${rescued.length}건을 직접 발화시켰습니다:\n` +
    rescued.map((r) => `· ${r}`).join('\n') +
    `\n(지각 원본이 뒤늦게 와도 일일 가드·슬롯 가드가 중복을 막습니다)`);
}
if (failures.length) {
  await tg(`🐕 스케줄 감시견 — 확인/구조에 실패한 항목이 있습니다:\n` +
    failures.map((f) => `· ${f}`).join('\n') +
    `\n(감시가 그만큼 비어 있다는 뜻입니다 — 반복되면 명단·권한을 확인해 주세요.)`);
  process.exitCode = 1;
}
console.log(`${rescued.length} rescued, ${pending.length} would-rescue (dry), ${RESCUABLE.length} checked, ${failures.length} unreadable`);
