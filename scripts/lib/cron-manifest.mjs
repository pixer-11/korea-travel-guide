// The one list of watchdog-guarded cron workflows — file, human name, crons.
// Lives here (not inside schedule-watchdog.mjs) because two consumers need it:
// the watchdog itself, and lib/slot-served.mjs, which workflows call to ask
// "was my slot already served?". Importing the watchdog would RUN it — its
// body executes at module top level — so the shared data moved out instead.
// If this list disagrees with the workflow files' own cron lines, both
// consumers lie together; workflow-lint's cross-check is still "추가 예정".
export const MANIFEST = [
  { file: 'reddit-scout.yml', name: '레딧 스카우트', crons: ['30 11 * * *'] },
  { file: 'pinterest.yml', name: '핀터레스트 핀', crons: ['35 23 * * *', '35 11 * * *'] },
  // refresh 는 일요일 크론만 FSQ 전수 점검(362요청)+주간 보고를 겸한다. 구조
  // 디스패치가 맨몸으로 나가면 워크플로가 그것을 일요일로 착각하므로, 어느
  // 크론을 놓쳤는지에 따라 full 입력을 달리 준다(평일 구조가 주간 몫을 돌리면
  // 비용도 보고도 이중이 된다 — 08-28 코덱스 심문).
  { file: 'refresh.yml', name: '데이터 리프레시', crons: ['33 20 * * 0', '33 19 * * 1-6'],
    inputsByCron: { '33 20 * * 0': { full: 'true' }, '33 19 * * 1-6': { full: 'false' } } },
  { file: 'threads-daily.yml', name: '스레드 소재·소셜 게시', crons: ['25 22 * * *', '25 23 * * *', '25 1 * * *'] },
  { file: 'indexnow.yml', name: 'IndexNow 제출', crons: ['30 8 * * *', '30 20 * * *'] },
  { file: 'analytics-report.yml', name: '일일 분석 보고', crons: ['7 0 * * *'] },
  { file: 'alt-photos.yml', name: '새벽 사진 교체 순찰', crons: ['35 19 * * *'] },
  // publish 는 전용 publish-watchdog 이 지키므로 총괄 감시견은 건드리지 않는다
  // (rescue:false — 둘이 같은 개를 풀면 이중 발행 경쟁). 슬롯 가드용으로만
  // 여기 있다: guard:'kstDay' = "KST 같은 날에 성공한 다른 실행이 있으면 그날
  // 몫은 끝난 것". 슬롯 창이 아니라 날짜 기준인 이유 — 2026-08-30 새벽 사고:
  // 발행 감시견 자신이 4.6h 지각 배달돼 자정을 넘겨 "오늘(새 날짜) 발행 없음"
  // 으로 오판, 01:20 에 하루 두 번째 배치를 발행했다. 스로틀 실험(5편/일,
  // 09-10 판정)은 날짜당 한 배치가 약속이다.
  { file: 'publish.yml', name: '일일 발행', crons: ['19 7 * * *'], rescue: false, guard: 'kstDay' },
  // 발행 감시견 자신은 크론이 하나뿐인데 아무도 보지 않았다 — 2026-08-30 사고의
  // 뿌리가 여기다(4.6h 지각해 자정을 넘겼고, 아예 증발했다면 발행이 멈춘 것을
  // 알아챌 사람이 없었다). 구조 발화는 안전하다: check-publish-ran 은 슬롯
  // 기준이라 이미 발행된 슬롯에서는 조용히 끝나고, 발행 자체에도 하루 1배치
  // 가드가 있다.
  { file: 'publish-watchdog.yml', name: '발행 감시견', crons: ['30 10 * * *'] },
];
