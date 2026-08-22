import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the field-salvage block in reddit-scout.mjs (keep the two in step).
function salvage(j) {
  const TAG = /<\/?(answer_ko|why_ko|answer_en|answer|why)\b[^>]*>/gi;
  const hasTag = (s) => /<\/?(answer_ko|why_ko|answer_en|answer|why)\b/i.test(String(s || ''));
  const lift = (field) => (String(j.why_ko || '') + '\n' + String(j.answer_ko || '')).match(new RegExp(`<${field}>([\\s\\S]*?)(?:<\\/${field}>|$)`, 'i'))?.[1]?.trim();
  if (!j.answer_ko || hasTag(j.answer_ko)) j.answer_ko = lift('answer_ko') || j.answer_ko;
  if (!j.why_ko || hasTag(j.why_ko)) j.why_ko = lift('why_ko') || j.why_ko;
  for (const k of ['why_ko', 'answer_ko', 'answer_en']) {
    j[k] = String(j[k] ?? '').replace(TAG, '').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (!j.answer_ko && j.why_ko.length > 240) {
    const [first, ...rest] = j.why_ko.split(/\n+/);
    j.why_ko = first; j.answer_ko = rest.join('\n').trim();
  }
  if (!j.answer_ko) j.answer_ko = '(한국어 번역이 오지 않았습니다 — 위 영어 답변 참고)';
  return j;
}

test('08-22 실제 카드 모양 — why_ko에 태그째 들어온 답변을 answer_ko로 건져낸다', () => {
  const j = salvage({
    verdict: 'OK', answer_en: 'For Kyushu after Fukuoka, swap in Kurokawa Onsen.',
    why_ko: '에디터가 규슈를 실제로 여행했고 현실적 조언을 제공.</answer_ko>\n<answer_ko>후쿠오카 이후 규슈 일정이라면 구로카와 온천을 추천합니다.</answer_ko>',
    answer_ko: undefined,
  });
  assert.equal(j.why_ko, '에디터가 규슈를 실제로 여행했고 현실적 조언을 제공.');
  assert.equal(j.answer_ko, '후쿠오카 이후 규슈 일정이라면 구로카와 온천을 추천합니다.');
  assert.ok(!/</.test(j.why_ko + j.answer_ko), 'no stray tags');
});

test('정상 응답은 그대로', () => {
  const j = salvage({ verdict: 'OK', answer_en: 'Go early.', why_ko: '적합함.', answer_ko: '일찍 가세요.' });
  assert.deepEqual([j.why_ko, j.answer_ko], ['적합함.', '일찍 가세요.']);
});

test('번역이 아예 없으면 undefined 대신 한국어 안내 문구', () => {
  const j = salvage({ verdict: 'OK', answer_en: 'Go early.', why_ko: '적합함.' });
  assert.equal(j.answer_ko, '(한국어 번역이 오지 않았습니다 — 위 영어 답변 참고)');
  assert.ok(!String(j.answer_ko).includes('undefined'));
});
