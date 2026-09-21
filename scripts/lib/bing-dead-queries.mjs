// 빙 노출 중 "사람이 본 흔적이 없는" 덩어리를 떼어낸다.
//
// 2026-09-21 실측. 빙 전체 노출 13,600 중 **10,774(79%)가 검색어 8개**에서 왔고,
// 그 8개의 클릭은 **정확히 0**이었다. 그중 하나는 `马来西亚吉隆坡天后宫` 로
// **3위에서 6,147회** 노출됐다. 페이지는 멀쩡하다 — 중국어 질의에 중국어 페이지가
// 뜨고 제목도 `天后宫：吉隆坡旅游指南（4.6★）` 이다. 3위에서 6천 번 보이고 한 번도
// 안 눌리는 일은 사람에게 일어나지 않는다.
//
// 같은 검색어들을 뺀 나머지 중국어 109개는 노출 350에 클릭 88 — **CTR 25%** 다.
// 즉 문제는 중국어도 제목도 아니고, 저 덩어리가 실수요가 아니라는 것이다.
//
// 이게 왜 중요한가: 리포트가 "5위 안 검색어 222개(노출 8,579) — 제목이 값을 하는
// 자리는 여기뿐" 이라고 말하는데, 그 8,579 중 7,900 이 이 죽은 검색어였다. 제목을
// 고쳐도 0 은 0 이다. 방문자 수에 붙인 봇 가드(lib/bot-surge.mjs)와 같은 부류의
// 왜곡이 빙 쪽에 남아 있었다.

/** 노출이 크면서 사실상 한 번도 안 눌린 검색어. */
export function isDeadQuery(row) {
  const imp = row?.Impressions ?? 0;
  const clicks = row?.Clicks ?? 0;
  // 250 미만에서 클릭 0 은 그냥 흔한 일이라 건드리지 않는다.
  if (imp < 250) return false;
  // 정확히 0 이 아니라 CTR 0.1% 이하로 본다 — 6,000 노출을 클릭 한 번이 되살리면 안 된다.
  return clicks * 1000 <= imp;
}

const HAN = /[一-鿿]/, KANA = /[぀-ヿ]/, HANGUL = /[가-힯]/;

/** 검색어의 언어권. 일본어 판정이 먼저다 — 일본어 질의에도 한자가 들어간다. */
export function queryLang(q) {
  const s = String(q || '');
  if (KANA.test(s)) return '일본어';
  if (HANGUL.test(s)) return '한국어';
  if (HAN.test(s)) return '중국어';
  return '라틴';
}

/**
 * 빙 검색어 목록을 "실질"과 "죽은 것"으로 가르고 언어별 성적을 낸다.
 */
export function bingSplit(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const dead = all.filter(isDeadQuery);
  const live = all.filter((r) => !isDeadQuery(r));
  const sum = (a) => a.reduce((s, x) => ({
    imp: s.imp + (x.Impressions ?? 0), clicks: s.clicks + (x.Clicks ?? 0),
  }), { imp: 0, clicks: 0 });
  const byLang = new Map();
  for (const r of live) {
    const k = queryLang(r.Query);
    const a = byLang.get(k) || { imp: 0, clicks: 0 };
    a.imp += r.Impressions ?? 0; a.clicks += r.Clicks ?? 0;
    byLang.set(k, a);
  }
  const l = sum(live), d = sum(dead);
  return {
    live: { ...l, n: live.length, ctr: l.imp ? l.clicks / l.imp : 0 },
    dead: { ...d, n: dead.length },
    byLang: [...byLang.entries()]
      .map(([lang, a]) => ({ lang, ...a, ctr: a.imp ? a.clicks / a.imp : 0 }))
      .sort((a, b) => b.ctr - a.ctr),
    // 제목·설명이 값을 하는 자리 = 5위 안이면서 죽지 않은 것.
    pageOne: live.filter((x) => (x.AvgImpressionPosition ?? 99) <= 5),
  };
}
