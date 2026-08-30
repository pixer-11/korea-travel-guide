// 워터마크 규칙이 두 비전 프롬프트에 **둘 다** 들어 있는지 지키는 테스트.
//
// 2026-08-30: 푸켓 채식축제에 붙을 뻔한 사진에 `Phuket@photographer.net`
// 워터마크가 박혀 있었다. 비전 게이트는 "이 축제가 맞는가"만 물었지
// "여행 가이드 대문에 걸 만한가"는 묻지 않았다 — 사진은 정확했고, 그래서
// 통과했다. 픽서님 지시: "워터마크 없는걸로 바꿔줘."
//
// 규칙을 상수 하나로 빼는 이유는 **두 게이트가 갈라지는 걸 막기 위해서**다.
// 부착 게이트(verifyHeroImage)와 순찰 감사(auditHeroImage)는 예전에 조항이
// 어긋난 전력이 있다(갤러리 프롬프트에만 있던 3개 조항 — vision-check.mjs
// 주석 참조). 한쪽만 고치면 밤에 걸러낸 걸 새벽에 다시 들여보낸다.
//   node --test scripts/lib/vision-check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { WATERMARK_RULE, HERO_PROMPT_RULES, AUDIT_PROMPT_RULES } from './vision-check.mjs';

test('워터마크 규칙은 무엇을 거를지 구체적으로 말한다', () => {
  assert.match(WATERMARK_RULE, /watermark/i);
  assert.match(WATERMARK_RULE, /REJECT/);
});

test('스톡 사이트 이름·URL 오버레이도 포함한다 — 워터마크는 로고만이 아니다', () => {
  assert.match(WATERMARK_RULE, /url|website|stock|signature|copyright/i);
});

// 진짜 지키려는 것: 두 게이트가 같은 규칙을 쓴다.
test('부착 게이트와 순찰 감사 프롬프트 양쪽에 들어 있다', () => {
  assert.ok(HERO_PROMPT_RULES.includes(WATERMARK_RULE), '부착 게이트에 없다');
  assert.ok(AUDIT_PROMPT_RULES.includes(WATERMARK_RULE), '순찰 감사에 없다');
});

// 반대 방향 — 사진에 우연히 찍힌 글자(간판·현수막·티셔츠)까지 거르면
// 거리 사진이 전멸한다. 규칙은 '덧입힌' 것에 한정돼야 한다.
test('사진 안에 실제로 있는 글자와 덧입힌 표식을 구분하라고 말한다', () => {
  assert.match(WATERMARK_RULE, /overlaid|superimposed|added|added on top|on top of/i);
});
