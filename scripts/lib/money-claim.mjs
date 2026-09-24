// 글에 적힌 "돈 액수"를 찾는다 — 모델 호출 없이, 정규식만으로.
//
// 왜 이게 결정적으로 가능한가. 우리가 장소에 대해 받는 가격 데이터는 구글의
// priceLevel(1~4) 하나뿐이다. 금액은 **한 번도** 주어지지 않는다. 그러니 본문·
// quickAnswer·FAQ 에 적힌 통화 금액은 정의상 전부 모델이 지어낸 것이다. 사실과
// 대조할 필요조차 없다 — 출처가 존재할 수 없다.
//
// 이 검사가 있는 이유는 비용이다. 지어낸 사실을 잡을 수 있는 유일한 장치가 주 1회
// 모델 감사(full-content-audit)뿐이라, 틀린 글은 최대 7일간 라이브였고 확인은 글당
// 모델 호출이었다. 이 부류만큼은 공짜·즉시로 내린다(2026-09-21).
//
// 일부러 좁게 짠다. 오늘 내야 할 돈이 아닌 액수 — 지폐·동전·역사적 건설비 — 는
// 사실이지 가격 주장이 아니므로 통과시킨다. 한자 병음 주소의 "9 Dong Da Zhi Jie"
// 가 베트남 동(VND)으로 잡히던 오탐도 여기서 막는다.

const CURRENCY_SYMBOL = String.raw`[$€£¥₩₫฿]\s?\d[\d,.]*`;
const CURRENCY_RP = String.raw`\bRp\.?\s?\d[\d,.]*`;
const CURRENCY_WORD = String.raw`\b\d[\d,.]*\s?(?:USD|EUR|GBP|JPY|KRW|VND|THB|IDR|SGD|MYR|PHP|INR|TWD|HKD|CNY|RMB|AUD|CAD|CHF|yen|won|baht|rupiah|dong|ringgit|peso|pesos|rupee|rupees|euro|euros|dollar|dollars|pound|pounds|lira|dirham|dirhams|riyal|riyals)\b`;
const AMOUNT = new RegExp(`(?:${CURRENCY_SYMBOL}|${CURRENCY_RP}|${CURRENCY_WORD})`, 'gi');

// 액수가 "오늘 낼 돈"이 아닌 경우: 지폐·동전·수집품·역사적 금액.
const NOT_A_PRICE = [
  /\b(note|banknote|bill|coin|coins|stamp|currency)\b/i,
  // "built" 는 건설비일 때만: "built for $2 million", "built in 1961 at a cost of
  // $2 million". 맨 "built" 는 "a bowl of phở priced at $100, built with luxury
  // ingredients" 의 메뉴 가격까지 풀어 줬다(09-25).
  /\b(built\s+(?:in\s+\d{3,4}\s+)?for|at\s+a\s+cost\s+of|construction\s+cost|cost the city|restoration|donated|endowment|budget of|funded)\b/i,
];
// 중국어 병음 주소의 Dong/Xi/Nan/Bei — 통화가 아니다.
const PINYIN_STREET = /\d[\d,.]*\s?(?:Dong|Nan|Xi|Bei)\s+[A-Z]/;

/**
 * 한 덩어리의 글에서 가격 주장으로 보이는 금액을 뽑는다.
 * @returns {{amount: string, context: string}[]}
 */
export function moneyClaims(text) {
  const src = String(text || '');
  const out = [];
  for (const m of src.matchAll(AMOUNT)) {
    const i = m.index;
    const window = src.slice(Math.max(0, i - 70), i + m[0].length + 40);
    if (PINYIN_STREET.test(src.slice(Math.max(0, i - 4), i + m[0].length + 12))) continue;
    if (NOT_A_PRICE.some((re) => re.test(window))) continue;
    out.push({ amount: m[0], context: window.replace(/\s+/g, ' ').trim() });
  }
  return out;
}
