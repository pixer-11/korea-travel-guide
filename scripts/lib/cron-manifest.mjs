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
];
