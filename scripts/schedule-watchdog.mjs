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
//  workflow_dispatch 로 발화시키고 텔레그램으로 보고한다. 명단의 워크플로는
//  전부 상태 장부/커서/일일 가드가 있어 중복 실행이 무해한 것만 골랐다.
//  이 감시견 자체도 하루 4번 돌므로(전부 누락될 확률은 사실상 0) 자기 자신이
//  같은 병에 걸리는 문제를 확률로 눌렀다.
//
//  publish.yml 은 명단에 없다: 전용 publish-watchdog 이 이미 지키고 있고,
//  둘이 같은 개를 풀면 이중 발행 경쟁이 생긴다. 주간·월간 크론도 v1 에선
//  제외 — 하루 늦어도 터지지 않는 것들이라, 명단은 "그날 안 돌면 그날의
//  일이 사라지는" 일일 크론으로 한정한다.
//
//    node scripts/schedule-watchdog.mjs          # 판정 + 필요시 발화
//    node scripts/schedule-watchdog.mjs --dry    # 판정만 출력
// ─────────────────────────────────────────────────────────────
import { lastFireBefore } from './lib/cron-window.mjs';

const DRY = process.argv.includes('--dry');
const REPO = process.env.GITHUB_REPOSITORY || 'pixer-11/korea-travel-guide';
const TOKEN = process.env.GITHUB_TOKEN;
const GRACE_MIN = 100; // 지각 발화 여지 — 이보다 늦으면 누락으로 판정

// file, 사람용 이름, 그 워크플로의 crons (워크플로 파일과 어긋나면 여기가
// 거짓말을 하게 되므로, workflow-lint 의 자동화 감사가 대조한다(추가 예정)).
const MANIFEST = [
  { file: 'reddit-scout.yml', name: '레딧 스카우트', crons: ['30 11 * * *'] },
  { file: 'pinterest.yml', name: '핀터레스트 핀', crons: ['35 23 * * *', '35 11 * * *'] },
  { file: 'refresh.yml', name: '데이터 리프레시', crons: ['33 20 * * 0', '33 19 * * 1-6'] },
  { file: 'threads-daily.yml', name: '스레드 소재·소셜 게시', crons: ['25 22 * * *', '25 23 * * *', '25 1 * * *'] },
  { file: 'indexnow.yml', name: 'IndexNow 제출', crons: ['30 8 * * *', '30 20 * * *'] },
  { file: 'analytics-report.yml', name: '일일 분석 보고', crons: ['7 0 * * *'] },
  { file: 'alt-photos.yml', name: '새벽 사진 교체 순찰', crons: ['35 19 * * *'] },
];

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
const rescued = [], pending = [];

for (const w of MANIFEST) {
  const lastExpected = Math.max(...w.crons.map((c) => lastFireBefore(c, now)));
  const overdueMin = Math.round((now - lastExpected) / 60000);
  // 예정 시각 10분 전부터의 실행을 "그 슬롯의 실행"으로 인정 — 스케줄러가
  // 몇 분 이르게 큐잉하는 경우까지 오탐 없이 담는다. 이벤트 종류는 안 가린다:
  // 사람이 손으로 돌렸어도 그 슬롯의 일은 된 것이다.
  const since = new Date(lastExpected - 10 * 60000).toISOString();
  const runs = await gh(`/actions/workflows/${w.file}/runs?created=${encodeURIComponent('>=' + since)}&per_page=1`);
  const ran = (runs.workflow_runs ?? []).length > 0;
  const verdict = ran ? 'ok' : (overdueMin <= GRACE_MIN ? 'waiting' : 'MISSED');
  console.log(`${w.file}: expected ${new Date(lastExpected).toISOString()} (+${overdueMin}m) → ${verdict}`);
  if (verdict !== 'MISSED') continue;
  if (DRY) { pending.push(w); continue; }
  await gh(`/actions/workflows/${w.file}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  rescued.push(`${w.name} (${overdueMin}분 지각)`);
}

if (rescued.length) {
  await tg(`🐕 스케줄 감시견 — 깃허브가 흘린 예약 실행 ${rescued.length}건을 직접 발화시켰습니다:\n` +
    rescued.map((r) => `· ${r}`).join('\n') +
    `\n(각 작업은 자체 상태 장부가 있어 중복 실행돼도 무해합니다)`);
}
console.log(`${rescued.length} rescued, ${pending.length} would-rescue (dry), ${MANIFEST.length} checked`);
