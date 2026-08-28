// ─────────────────────────────────────────────────────────────
//  HOTELLOOK 링크 — 한 곳에서 조립한다.
//
//  같은 URL이 PostArticle·StickyBook·PlanTrip 세 곳에 복붙돼 있었고
//  (2026-08-28 감사), 셋 다 날짜가 없어 독자가 "빈 검색폼"에 착지했다 —
//  94클릭 0예약의 유력 용의자 중 하나. 날짜를 프리필하면 가격이 보이는
//  결과 페이지에 착지한다:
//    · 이벤트 글: 행사 시작일 체크인(그 날짜의 그 도시가 곧 검색 의도)
//    · 그 외: 오늘+30일 체크인, 2박 (사이트는 매일 재빌드되므로 항상 신선)
//  language= 유지 — 빼면 5개 언어 독자 전원이 영어 booking.com에 떨어진다.
// ─────────────────────────────────────────────────────────────

const DAY = 86400e3;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);

export function hotellookUrl({ submarker, lang, destination, eventStart, now = Date.now() }) {
  const start = eventStart && Date.parse(eventStart) > now
    ? Date.parse(eventStart)
    : now + 30 * DAY;
  const qs = new URLSearchParams({
    marker: `754088.${submarker}`,
    language: lang,
    destination,
    checkIn: ymd(start),
    checkOut: ymd(start + 2 * DAY),
  });
  return `https://search.hotellook.com/?${qs}`;
}
