// ─────────────────────────────────────────────────────────────
//  호텔 링크 — 사이트의 모든 "숙소 찾기" 버튼이 여기서 조립된다.
//
//  2026-09-23까지는 Hotellook(search.hotellook.com)이었다. 그 프로그램은
//  **2025-10-20에 문을 닫았고**, 닫힌 뒤에도 Booking.com으로 넘겨주는 건
//  "2025년에 꾸준히 수익을 낸 링크"뿐이다(Travelpayouts FAQ). 이 계정은
//  2026-07 가입이라 그 조건에 들 수 없다 → 수수료 적립이 확인되지 않는다.
//  게다가 실측으로 두 가지가 더 깨져 있었다(curl 재현, 09-23):
//    · adults 가 없으면 중간 경유지가 checkin/checkout 을 버렸다 — 날짜 프리필 무효
//    · destination=Aberdeen → "Aberdeen, United Kingdom" (홍콩 애버딘 글)
//
//  그래서 **이미 수익이 추적되는 Klook**(같은 /go/klook 릴레이, SubID 포함)의
//  검색으로 보낸다. "도시 국가 hotels" 검색은 실제 호텔 목록을 보여준다
//  (09-24 Firecrawl 확인: "Hong Kong hotels" → 호텔 5곳, klook.com/hotels/detail/…).
//  날짜는 Klook 검색이 받지 않으므로 넘기지 않는다 — 날짜 붙은 검색이 필요해지면
//  Trip.com(Travelpayouts, 5.5%·쿠키 30일) 연결 뒤 여기 한 곳만 바꾸면 된다.
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.submarker  어느 버튼인지 (post_top, sticky_bar …) → SubID `hotel_<submarker>`
 * @param {string} opts.locale     klookLocale(lang) 결과 (en-US, ko, ja, es, zh-CN)
 * @param {string} opts.place      도시 이름(영문). 나라 허브에서는 나라 이름.
 * @param {string} [opts.country]  나라 이름(영문). 동명 도시를 가르는 유일한 단서.
 */
export function hotelUrl({ submarker, locale, place, country }) {
  const parts = [place, country]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    // 나라 허브는 place 와 country 가 같다 — "Japan Japan hotels" 가 되지 않게.
    .filter((s, i, a) => a.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
  const query = `${parts.join(' ')} hotels`;
  const to = `https://www.klook.com/${locale}/search/?query=${encodeURIComponent(query)}`;
  const sub = `hotel_${String(submarker).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  return `/go/klook?to=${encodeURIComponent(to)}&sub_id=${sub}`;
}
