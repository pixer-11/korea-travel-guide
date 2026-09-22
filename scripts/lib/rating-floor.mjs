// 방법론 페이지가 독자에게 한 약속: **평점 4.0 이상인 장소만 싣는다.**
//
// 2026-09-22: 그 약속을 지키는 장치가 없었다. 생성기는 4.0 미만 장소로 글을 쓰지
// 않지만(태어날 때만 본다), 한 번 공개된 뒤 평점이 떨어지면 **아무것도 내리지 않는다**.
// refresh.mjs 가 자동으로 내리는 것은 폐업뿐이었다.
// 그날 드러난 방식이 그 공백을 그대로 보여준다 — 밀토스트 익선점(3.9·리뷰 1,248)은
// `place` 블록 **없이** 태어나 8월 5일부터 공개돼 있었고, 검사기는 **읽을 평점이 없어서**
// 잡지 못했다. 5일 일정표 문턱을 넘기려고 좌표를 붙인 날에야 처음 걸렸다.
//
// 🔁 떨림 방지(hysteresis). 4.0 하나로 양쪽을 다 판정하면 3.99↔4.01 을 오가는 장소가
// 매주 내려갔다 올라간다. 실측: 공개글 1,465편 중 **38편이 4.0~4.09 구간**에 있다 —
// 실재하는 위험이다. 그래서 **내릴 때는 4.0 미만, 되올릴 때는 4.1 이상**을 쓴다.
export const FLOOR = 4.0;      // 이 아래면 내린다
export const RECOVER = 4.1;    // 되올리려면 여기까지 와야 한다

/**
 * 이 글이 평점 기준선을 위반하는가.
 * @param rating 저장된 place.rating
 * @param isHeld 이미 rating 사유로 격리된 초안인가(되올릴지 판정하는 쪽)
 */
export function belowFloor(rating, isHeld = false) {
  if (typeof rating !== 'number' || !(rating > 0)) return false; // 평점이 없으면 판정하지 않는다
  return rating < (isHeld ? RECOVER : FLOOR);
}

// 🔤 한 사유, 두 철자 — 그리고 시스템의 두 반쪽이 각각 하나씩만 알았다(2026-09-22).
// refresh.mjs 는 자동으로 내릴 때 'rating' 을 적었고, 09-16 의 수기 보류는
// 'below-rating-floor' 를 적었다. patrol-target 의 NON_PHOTO_HOLD 는 뒤엣것만
// 알아서, 'rating' 으로 내려간 글은 사진만 좋아지면 사진 순찰이 도로 올렸다
// (09-16 에 tokyo-smith-wollensky 가 내려간 지 여섯 시간 만에 그렇게 부활했다).
// audit-rating-floor 의 해제 판정은 앞엣것만 알아서, 'below-rating-floor' 로 적힌
// 보류는 평점이 회복돼도 영영 풀리지 않았다. 앞으로 쓰는 철자는 하나이고,
// 판정은 이미 디스크에 적힌 것 때문에 둘 다 받는다.
// 'rating' is the canonical spelling because repair-held-posts keys its
// recheck command on it; a hold written under a name that map does not have
// reports '재검사할 도구가 없음' every night and never lifts.
export const HOLD_REASON = 'rating';
export const RATING_HOLD = /(?:^|\+)(?:rating|below-rating-floor)(?:\+|$)/;
/** 이 heldReason 이 평점 사유인가(두 철자 모두). */
export const isRatingHold = (reason) => RATING_HOLD.test(String(reason ?? ''));
