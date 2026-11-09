// The one list of watchdog-guarded cron workflows — file, human name, crons.
// Lives here (not inside schedule-watchdog.mjs) because two consumers need it:
// the watchdog itself, and lib/slot-served.mjs, which workflows call to ask
// "was my slot already served?". Importing the watchdog would RUN it — its
// body executes at module top level — so the shared data moved out instead.
// If this list disagrees with the workflow files' own cron lines, both
// consumers lie together — so cron-manifest.test.mjs holds every entry to its
// workflow file's actual cron, and fails on any new unguarded daily cron.

// 지각 발화 여지 — 이보다 늦으면 누락으로 판정. 전체를 줄이면 안 된다: refresh·
// alt-photos·indexnow 는 슬롯 가드가 없어 구조와 지각 원본이 겹치면 두 번 돈다.
export const GRACE_MIN = 100;
export const graceFor = (w) => w.graceMin ?? GRACE_MIN;

export const MANIFEST = [
  { file: 'reddit-scout.yml', name: '레딧 스카우트', crons: ['30 11 * * *'], alarmOnly: true },
  { file: 'pinterest.yml', name: '핀터레스트 핀', crons: ['35 23 * * *', '35 11 * * *'], alarmOnly: true },
  // refresh 는 일요일 크론만 FSQ 전수 점검(362요청)+주간 보고를 겸한다. 구조
  // 디스패치가 맨몸으로 나가면 워크플로가 그것을 일요일로 착각하므로, 어느
  // 크론을 놓쳤는지에 따라 full 입력을 달리 준다(평일 구조가 주간 몫을 돌리면
  // 비용도 보고도 이중이 된다 — 08-28 코덱스 심문).
  { file: 'refresh.yml', name: '데이터 리프레시', crons: ['33 20 * * 0', '33 19 * * 1-6'], alarmOnly: true,
    inputsByCron: { '33 20 * * 0': { full: 'true' }, '33 19 * * 1-6': { full: 'false' } } },
  { file: 'threads-daily.yml', name: '스레드 소재·소셜 게시', crons: ['25 22 * * *', '25 23 * * *', '25 1 * * *'] },
  { file: 'indexnow.yml', name: 'IndexNow 제출', crons: ['30 11 * * *', '30 20 * * *'], alarmOnly: true },
  // graceMin: 아침 보고는 깃허브가 4~6시간 늦게 배달해 45일 중 10시 전 도착이
  // 하루뿐이었다(11-08 실측). 100분 유예면 10:47 KST 전엔 구조가 불가능하다.
  // 슬롯 가드가 있어 일찍 구조해도 지각 원본이 스스로 물러난다.
  { file: 'analytics-report.yml', name: '일일 분석 보고', crons: ['7 0 * * *'], graceMin: 30, alarmOnly: true },
  { file: 'alt-photos.yml', name: '새벽 사진 교체 순찰', crons: ['35 19 * * *'], alarmOnly: true },
  // publish 는 전용 publish-watchdog 이 지키므로 총괄 감시견은 건드리지 않는다
  // (rescue:false — 둘이 같은 개를 풀면 이중 발행 경쟁). 슬롯 가드용으로만
  // 여기 있다: guard:'kstDay' = "KST 같은 날에 성공한 다른 실행이 있으면 그날
  // 몫은 끝난 것". 슬롯 창이 아니라 날짜 기준인 이유 — 2026-08-30 새벽 사고:
  // 발행 감시견 자신이 4.6h 지각 배달돼 자정을 넘겨 "오늘(새 날짜) 발행 없음"
  // 으로 오판, 01:20 에 하루 두 번째 배치를 발행했다. 스로틀 실험(5편/일,
  // 09-10 판정)은 날짜당 한 배치가 약속이다.
  // workJob: 그날 몫을 "해낸" 실행의 증거는 conclusion 이 아니라 이 작업의 성공이다.
  // 늦게 와서 가드에 멈춘 실행도 success 로 끝나기 때문(코덱스 2026-09-30).
  { file: 'publish.yml', name: '일일 발행', crons: ['19 7 * * *'], rescue: false, guard: 'kstDay', workJob: 'generate' },
  // 발행 감시견 자신은 크론이 하나뿐인데 아무도 보지 않았다 — 2026-08-30 사고의
  // 뿌리가 여기다(4.6h 지각해 자정을 넘겼고, 아예 증발했다면 발행이 멈춘 것을
  // 알아챌 사람이 없었다). 구조 발화는 안전하다: check-publish-ran 은 슬롯
  // 기준이라 이미 발행된 슬롯에서는 조용히 끝나고, 발행 자체에도 하루 1배치
  // 가드가 있다.
  { file: 'publish-watchdog.yml', name: '발행 감시견', crons: ['30 7 * * *'] },

  // ── alarmOnly (2026-11-09) ─────────────────────────────────────────────
  // 깃허브 예약이 14일 실측 중앙값 4시간 29분 늦고 94%가 1시간을 넘겨서, 아래는
  // 워크플로의 schedule 을 끄고 Cloudflare 알람시계(workers/social-alarm)가
  // 이 시각에 직접 깨운다. 예약을 켜 둔 채 알람만 더하면 가드 없는 작업은 하루
  // 두 번 돌고, 슬롯 가드(schedule 이벤트에서만 켜짐)도 깃허브가 먼저 오면 뒤따르는
  // 디스패치를 막지 못한다. 그래서 시계를 하나만 둔다.
  // 알람시계가 죽으면 깃허브 크론으로도 도는 schedule-watchdog 이 이 명단을 보고
  // 대신 실행한다. 월간(essentials·국가 정보)은 파서 범위 밖이고 몇 시간 늦어도
  // 무해해서 깃허브에 그대로 둔다.
  //
  // 발행 뒤에 돌아야 하는 셋은 시각을 옮겼다. 16:36 시작한 발행이 빌드까지 끝나
  // 사이트에 반영되는 것은 19~20시 KST 다. 예전 17:30 은 깃허브 지각 덕에 우연히
  // 그 뒤에 돌았고, 정시가 되면 어제 사이트를 검사하게 된다.
  { file: 'smoke.yml', name: '실서버 스모크', crons: ['30 11 * * *'], alarmOnly: true },
  // 경고 전달은 하루 한 번, 마지막 회차에. 감시견은 가장 최근 슬롯만 판정하므로
  // 첫 회차에 실으면 알람이 멈춘 날 전달이 통째로 빠진다.
  { file: 'live-checks.yml', name: '실서버 정기 검사', crons: ['45 11 * * *', '20 13 * * *'], alarmOnly: true,
    inputsByCron: { '45 11 * * *': { pass_warnings: 'false' }, '20 13 * * *': { pass_warnings: 'true' } } },
  { file: 'affiliate-status.yml', name: '제휴 상태 점검', crons: ['11 7 * * *'], alarmOnly: true },
  { file: 'visual-audit.yml', name: '사진 시각 감사', crons: ['40 12 * * *'], alarmOnly: true },
  { file: 'newsletter-report.yml', name: '뉴스레터 보고', crons: ['17 23 * * *'], alarmOnly: true },
  // 주간: rescueOnce = 돌다 실패한 실행은 다시 돌리지 않는다. 비싼 감사가 실패할
  // 때마다 하루 네 번 재실행되면 안 된다. 알람으로 돈 실행의 실패는 작업 실패
  // 알림이 알린다(감시견이 GITHUB_TOKEN 으로 구조한 실행에는 workflow_run 이 안
  // 생겨서 그 알림도, 뒤따르는 배포도 없다. 알람이 멈춘 날에만 해당하고, 배포는
  // 깃허브 크론으로 도는 다음 발행이 함께 내보낸다).
  ...[
    ['a11y-check.yml', '접근성 점검', '55 16 * * 2'],
    ['discover-events.yml', '행사 발굴', '37 20 * * 3', '37 20 * * 0'],
    ['full-audit.yml', '주간 전수 감사', '35 18 * * 6'],
    ['gallery-patrol.yml', '본문 사진 순찰', '10 21 * * 6'],
    ['gsc-report.yml', '서치콘솔 보고', '23 22 * * 0'],
    ['index-core-set.yml', '핵심 집합 색인', '41 21 * * 3'],
    ['index-coverage.yml', '색인 현황', '41 21 * * 1'],
    ['link-check.yml', '링크 검사', '25 16 * * 2'],
    ['marketing-review.yml', '주간 마케팅 검토', '25 11 * * 0'],
    ['newsletter-weekly.yml', '주간 뉴스레터', '13 23 * * 6'],
    ['performance-log.yml', '주간 성과 기록', '55 20 * * 0'],
    ['pinterest-analytics.yml', '핀터레스트 주간 분석', '35 0 * * 1'],
    ['workflow-lint.yml', '워크플로 점검', '35 15 * * 2'],
  ].map(([file, name, ...crons]) => ({ file, name, crons, alarmOnly: true, rescueOnce: true })),
];
