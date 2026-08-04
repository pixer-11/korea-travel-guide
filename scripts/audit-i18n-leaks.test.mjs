// audit-i18n-leaks 회귀 테스트.
//
// 이 검사기는 "영어가 새어나왔는가"를 정규식 목록으로 판정한다. 정규식이 어딘가를
// 거치며 백슬래시를 하나 잃으면 문법은 멀쩡한 채 아무것도 매칭하지 않게 되고,
// 검사기는 영원히 "✅ 누출 없음"을 보고한다 — 통과 보고가 곧 고장 신호와
// 구별되지 않는 상태. 그래서 규칙마다 "잡아야 하는 HTML"을 하나씩 박아둔다.
// 언어별 예외(스페인어의 AM/PM·h/min)도 함께 고정한다.
//
//   node scripts/audit-i18n-leaks.test.mjs
import { leaksIn, RULES, stripScripts } from './audit-i18n-leaks.mjs';

const page = (inner) => `<!doctype html><html><body><main>${inner}</main></body></html>`;

const cases = [];
const t = (name, fn) => cases.push([name, fn]);
const hits = (html, lang) => leaksIn(page(html), lang);

// ── 규칙마다 최소 하나의 실증 ────────────────────────────────
t('klook link left on the en-US locale', () =>
  hits('<a href="https://www.klook.com/en-US/city/1-seoul/">예약</a>', 'ko').includes('klook-en-US')
    ? null : 'klook-en-US did not fire');

t('affiliate strip heading untranslated', () =>
  hits('<h2>Tickets &amp; tours for Seoul</h2>', 'ja').includes('tickets-tours')
    ? null : 'tickets-tours did not fire');

t('price chip still says Free', () =>
  hits('<span class="price">Free</span>', 'zh').includes('price-Free')
    ? null : 'price-Free did not fire');

t('English time units in CJK pages', () =>
  hits('<span>~2.5 h</span>', 'ko').includes('time-unit')
    ? null : 'time-unit did not fire');

t('AM/PM range in CJK pages', () =>
  hits('<td>9–5 PM</td>', 'ja').includes('am-pm')
    ? null : 'am-pm did not fire');

for (const [id, html] of [
  ['ui-where-to-stay', '<h2>Where to stay in Busan</h2>'],
  ['ui-plan-your-trip', '<h2>Plan your trip</h2>'],
  ['ui-getting-there', '<h3>Getting there</h3>'],
  ['ui-all-destinations', '<a>All destinations</a>'],
  ['ui-when-to-go', '<a>When to go</a>'],
]) {
  t(`${id} fires on its own copy`, () =>
    hits(html, 'ko').includes(id) ? null : `${id} did not fire`);
}

// ── 언어별 예외: 스페인어는 AM/PM과 h/min을 정상적으로 쓴다 ──
t('Spanish keeps AM/PM without being flagged', () =>
  hits('<td>9–5 PM</td>', 'es').includes('am-pm') ? 'am-pm should skip Spanish' : null);
t('Spanish keeps h/min without being flagged', () =>
  hits('<span>~2.5 h</span>', 'es').includes('time-unit') ? 'time-unit should skip Spanish' : null);

// ── JSON-LD는 영어로 남는 것이 정상 ──────────────────────────
t('schema.org payload is not a leak', () => {
  const html = page('<script type="application/ld+json">{"name":"Plan your trip","price":"Free"}</script><h1>서울 여행</h1>');
  return leaksIn(html, 'ko').length === 0 ? null : `flagged inside <script>: ${leaksIn(html, 'ko')}`;
});
t('stripScripts removes the script body but keeps the page', () => {
  const out = stripScripts('<p>본문</p><script>var a = "Free";</script><p>끝</p>');
  return !out.includes('Free') && out.includes('본문') && out.includes('끝') ? null : `got: ${out}`;
});

// ── 제대로 번역된 페이지는 조용해야 한다 ─────────────────────
t('a properly localized page is clean', () => {
  const out = hits('<h1>부산 여행 가이드</h1><h2>어디에 묵을까</h2><span>무료</span><td>오전 9시–오후 5시</td>', 'ko');
  return out.length === 0 ? null : `false positives: ${out.join(', ')}`;
});

// ── 규칙이 통째로 사라지는 사고 방지 ─────────────────────────
t('every rule is still present and reachable', () => {
  if (RULES.length < 10) return `only ${RULES.length} rules left — did a rule get dropped?`;
  const dead = RULES.filter((r) => !r.langs || r.langs.length === 0).map((r) => r.id);
  return dead.length ? `rules applying to no language: ${dead.join(', ')}` : null;
});

let fail = 0;
for (const [name, fn] of cases) {
  let err;
  try { err = fn(); } catch (e) { err = `threw: ${e.message}`; }
  console.log(`${err ? 'FAIL' : 'PASS'}  ${name}${err ? ' — ' + err : ''}`);
  if (err) fail++;
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
process.exit(fail ? 1 : 0);
