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

// 통화 표기의 단일 출처. 세 검사(여기, section-guards, validate-content)가 목록을 따로
// 들고 있던 동안 새 나라의 통화는 어디에도 들어가지 않았다: 이집트를 넣은 날 EGP 는
// 세 곳 모두에 없었고 ARS·PEN·GEL 도 같았다(11-09). 나라를 추가하면 여기에 더한다.
export const CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'VND', 'THB', 'IDR', 'SGD', 'MYR', 'PHP', 'INR', 'TWD', 'HKD', 'CNY', 'RMB',
  'AUD', 'CAD', 'CHF', 'AED', 'TRY', 'UZS', 'KHR', 'MXN', 'MOP', 'MNT', 'GEL', 'NZD', 'PEN', 'ARS', 'EGP',
];
export const CURRENCY_WORDS = [
  'yen', 'won', 'baht', 'yuan', 'ringgit', 'rupiah', 'dong', 'euros?', 'dollars?', 'pesos?', 'rupees?',
  'dirhams?', 'riyals?', 'pounds?', 'liras?', 'riels?', 'soles', 'lari', 'tugriks?', 'tögrög', 'patacas?', "so'm",
];
// "700 Egyptian pounds": 숫자와 단위 사이에 끼는 나라 형용사. 아무 낱말이나 허용하면
// "2 people won" 이 금액이 된다.
export const CURRENCY_ADJECTIVES = [
  'Egyptian', 'Turkish', 'British', 'Mexican', 'Argentine', 'Argentinian', 'Peruvian', 'Philippine', 'Malaysian',
  'Indian', 'Indonesian', 'Thai', 'Vietnamese', 'Japanese', 'South Korean', 'Korean', 'Chinese', 'Georgian',
  'Mongolian', 'Uzbek', 'Cambodian', 'Macanese', 'Emirati', 'UAE', 'US', 'American', 'Australian', 'Canadian',
  'New Zealand', 'Singapore', 'Hong Kong', 'New Taiwan', 'Taiwan', 'Taiwanese',
];

const SYMBOLS = '$€£¥₩₫฿₹₺₱₾₮៛元';
const CURRENCY_SYMBOL = String.raw`[${SYMBOLS}]\s?\d[\d,.]*`;
const CURRENCY_RP = String.raw`\bRp\.?\s?\d[\d,.]*`;
const CURRENCY_WORD = String.raw`\b\d[\d,.]*\s?(?:(?:${CURRENCY_ADJECTIVES.join('|')})\s+)?(?:USD|EUR|GBP|JPY|KRW|VND|THB|IDR|SGD|MYR|PHP|INR|TWD|HKD|CNY|RMB|AUD|CAD|CHF|${CURRENCY_WORDS.join('|')})\b`;
const AMOUNT = new RegExp(`(?:${CURRENCY_SYMBOL}|${CURRENCY_RP}|${CURRENCY_WORD})`, 'gi');

// 코드는 대소문자를 구분해서 본다: TRY·PEN·GEL·MOP 는 소문자로 쓰면 영어 낱말이다.
// 앞표기("AED 20-45", "EGP 700")는 실제로 샜다. "200 LE" 는 뒤에 대문자 낱말이 이어지면
// 뺀다: "2026 LE SSERAFIM" 의 연도가 금액으로 읽힌다. validate-content 도 이 패턴을 쓴다.
const CODES = CURRENCY_CODES.join('|');
export const CODED_AMOUNT_PATTERN = [
  String.raw`\b(?:${CODES}|RM|TL|Rs\.?|L\.E\.|LE)\s?\d[\d,.]*`,
  String.raw`\bS\/\.?\s?\d[\d,.]*`,
  String.raw`\b\d[\d,.]*\s?(?:${CODES}|RM|TL)\b`,
  String.raw`\b\d[\d,.]*\s?L\.?E\.?(?![A-Za-z])(?!\s+[A-Z])`,
].join('|');
const CODED_AMOUNT = new RegExp(CODED_AMOUNT_PATTERN, 'g');

// 액수가 "오늘 낼 돈"이 아닌 경우: 지폐·동전·수집품·역사적 금액.
const NOT_A_PRICE = [
  // "bill" only as a banknote right after the amount ("a $5 bill"): a bare
  // "bill" anywhere in the window also exempted a restaurant bill — "budget a
  // mid-range bill (roughly ฿300–600 per person)" stayed live in five languages
  // through the 09-21 repair (2026-10-05 audit).
  /\b(note|banknote|coin|coins|stamp|currency)\b/i,
  new RegExp(String.raw`[${SYMBOLS}]\s?\d[\d,.]*\s+bills?\b`, 'i'),
  // "built" 는 건설비일 때만: "built for $2 million", "built in 1961 at a cost of
  // $2 million". 맨 "built" 는 "a bowl of phở priced at $100, built with luxury
  // ingredients" 의 메뉴 가격까지 풀어 줬다(09-25).
  /\b(built\s+(?:in\s+\d{3,4}\s+)?for|at\s+a\s+cost\s+of|construction\s+cost|cost the city|restoration|donated|endowment|budget of|funded)\b/i,
];
// 중국어 병음 주소의 Dong/Xi/Nan/Bei — 통화가 아니다.
const PINYIN_STREET = /\d[\d,.]*\s?(?:Dong|Nan|Xi|Bei|Yuan)\s+[A-Z]/;

/**
 * 한 덩어리의 글에서 가격 주장으로 보이는 금액을 뽑는다.
 * @returns {{amount: string, context: string}[]}
 */
export function moneyClaims(text) {
  const src = String(text || '');
  const out = [];
  // 두 정규식이 같은 금액을 볼 수 있다("300 THB"): 앞 건 안에서 시작하면 건너뛴다.
  const found = [...src.matchAll(AMOUNT), ...src.matchAll(CODED_AMOUNT)].sort((a, b) => a.index - b.index);
  let end = 0;
  for (const m of found) {
    const i = m.index;
    if (i < end) continue;
    end = i + m[0].length;
    // Rupiah is written "Rp" — the regex is case-insensitive for the currency
    // words, and so read Argentina's provincial routes RP73 and RP33 as money.
    // Two Salta guides were flagged and sent to the model for repair on every
    // publish, which failed each time: there was no price to take out (10-27).
    if (/^rp/i.test(m[0]) && !m[0].startsWith('Rp')) continue;
    const window = src.slice(Math.max(0, i - 70), i + m[0].length + 40);
    if (PINYIN_STREET.test(src.slice(Math.max(0, i - 4), i + m[0].length + 12))) continue;
    if (NOT_A_PRICE.some((re) => re.test(window))) continue;
    out.push({ amount: m[0], context: window.replace(/\s+/g, ' ').trim() });
  }
  return out;
}
