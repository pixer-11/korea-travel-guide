// "결함이 없다" 와 "아무것도 안 봤다" 를 가르는 한 줄.
//
// 검사기가 입력을 못 찾았을 때 초록불을 켜면, 그 초록불은 사이트에 대한 정보가
// 아니라 실행 환경에 대한 정보다. 2026-09-08 하루에 세 번 그 일이 있었다:
// 빈 dist 에서 통과한 링크 감사, 피드를 전부 건너뛴 채 "일치한다"고 한 감사,
// 458장 중 456장을 재지 못하고 ✅ 를 찍은 폭 감사. 셋 다 "새 결함"이 아니라
// 그동안 아무도 보지 않았던 자리였다.
//
// 규칙: 센 것이 0이면 통과를 보고하지 않는다. 이 함수를 쓰면 문구가 한 곳에
// 모이고, scripts/audit-checkers.mjs 가 빈 저장소로 계약을 강제한다.
//
//   requireExamined(files.length, '글', 'src/content/posts 가 비어 있나?');
export function requireExamined(count, what, hint = '') {
  if (count > 0) return;
  console.log(`NOTHING-EXAMINED: ${what} — 볼 것이 하나도 없었다. 이 실행은 아무것도 확인하지 않았으므로 통과가 아니다.${hint ? ` (${hint})` : ''}`);
  process.exit(1);
}
